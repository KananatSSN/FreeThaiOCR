import type Konva from 'konva'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Image as KImage, Layer, Line, Rect, Stage } from 'react-konva'
import { useTranslation } from 'react-i18next'
import { CONF_STYLE, confLevel, type ConfLevel, pct } from '@/lib/confidence'
import { getPageBitmap } from '@/lib/ocrService'
import { readOf, useActiveFile, useActivePage, useApp, viewEngine } from '@/state/store'
import type { OcrLine } from '@/ocr/engine'
import type { Word } from '@/ocr/layout'

const NO_LINES: OcrLine[] = []

const MAX_ZOOM = 8

/** A line's words; a line without word boxes counts as one word. */
const wordsOf = (l: OcrLine): Word[] => (l.words?.length ? l.words : [{ text: l.text, confidence: l.confidence, box: l.box }])

function Legend() {
  const { t } = useTranslation()
  const levels: ConfLevel[] = ['high', 'mid', 'low']
  return (
    <div data-testid="confidence-legend" className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
      <span className="font-medium text-foreground">{t('confidence.legend')}</span>
      {levels.map((k) => (
        <span key={k} className="flex items-center gap-1.5 tabular-nums">
          <span
            className="inline-block size-3 rounded-[3px] border-[1.5px]"
            style={{ borderColor: CONF_STYLE[k].stroke, background: CONF_STYLE[k].fill, borderStyle: CONF_STYLE[k].dash ? 'dashed' : 'solid' }}
          />
          {t(`confidence.${k}`)}
        </span>
      ))}
    </div>
  )
}

interface View {
  scale: number
  x: number
  y: number
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/** The current page as a bitmap the viewer owns (cache evictions can't blank it). */
function usePageImage(index: number, docKey: string | undefined) {
  const [loaded, setLoaded] = useState<{ index: number; docKey: unknown; bmp: ImageBitmap } | null>(null)
  useEffect(() => {
    let alive = true
    let mine: ImageBitmap | null = null
    if (!docKey) return
    getPageBitmap(docKey, index)
      .then((b) => createImageBitmap(b))
      .then((b) => {
        if (alive) setLoaded({ index, docKey, bmp: (mine = b) })
        else b.close()
      })
      .catch(() => {})
    return () => {
      alive = false
      mine?.close()
    }
  }, [index, docKey])
  // A bitmap for another page (or document) is never shown, even for a frame.
  return loaded && loaded.index === index && loaded.docKey === docKey ? loaded.bmp : null
}

export interface ViewerHandle {
  zoomBy(f: number): void
  fit(): void
}

export function PageViewer({ onReady }: { onReady?: (h: ViewerHandle) => void }) {
  const file = useActiveFile()
  const fileId = file?.id
  const current = useApp((s) => s.current)
  const page = useActivePage()
  const hoveredLine = useApp((s) => s.hoveredLine)
  const [wrapRef, size] = useSize<HTMLDivElement>()
  const img = usePageImage(current, fileId)
  const pageSize = file?.meta?.sizes[current] ?? { width: 1, height: 1 }
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const stageRef = useRef<Konva.Stage>(null)
  const pinch = useRef<{ dist: number; center: { x: number; y: number } } | null>(null)

  const fit = useCallback(() => {
    if (!size.width || !size.height) return
    const s = Math.min(size.width / pageSize.width, size.height / pageSize.height) * 0.96
    setView({ scale: s, x: (size.width - pageSize.width * s) / 2, y: (size.height - pageSize.height * s) / 2 })
  }, [size.width, size.height, pageSize.width, pageSize.height])

  // Refit on page change and when the container first gets a size.
  const fittedFor = useRef<string>('')
  useEffect(() => {
    const key = `${fileId}:${current}:${pageSize.width}x${pageSize.height}:${size.width > 0}`
    if (size.width && fittedFor.current !== key) {
      fittedFor.current = key
      fit()
    }
  }, [fileId, current, pageSize.width, pageSize.height, size.width, fit])

  const zoomAt = useCallback((factor: number, at: { x: number; y: number }) => {
    setView((v) => {
      const minScale = Math.min(size.width / pageSize.width, size.height / pageSize.height) * 0.25
      const scale = Math.min(MAX_ZOOM, Math.max(minScale, v.scale * factor))
      const k = scale / v.scale
      return { scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }
    })
  }, [size.width, size.height, pageSize.width, pageSize.height])

  useEffect(() => {
    onReady?.({ zoomBy: (f) => zoomAt(f, { x: size.width / 2, y: size.height / 2 }), fit })
  }, [onReady, zoomAt, fit, size.width, size.height])

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const p = stageRef.current?.getPointerPosition()
    if (!p) return
    if (e.evt.ctrlKey || e.evt.metaKey) {
      // Trackpad pinch (ctrlKey) or Ctrl/Cmd + wheel: zoom around the pointer.
      zoomAt(Math.exp(-e.evt.deltaY * 0.01), p)
    } else {
      setView((v) => ({ ...v, x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY }))
    }
  }

  // Two-finger pinch zoom + pan on touch screens.
  const onTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const t = e.evt.touches
    if (t.length !== 2) return
    e.evt.preventDefault()
    const rect = stageRef.current!.container().getBoundingClientRect()
    const a = { x: t[0].clientX - rect.left, y: t[0].clientY - rect.top }
    const b = { x: t[1].clientX - rect.left, y: t[1].clientY - rect.top }
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const prev = pinch.current
    pinch.current = { dist, center }
    if (!prev) return
    setView((v) => {
      const minScale = Math.min(size.width / pageSize.width, size.height / pageSize.height) * 0.25
      const scale = Math.min(MAX_ZOOM, Math.max(minScale, v.scale * (dist / prev.dist)))
      const k = scale / v.scale
      return {
        scale,
        x: center.x - (prev.center.x - v.x) * k,
        y: center.y - (prev.center.y - v.y) * k,
      }
    })
  }

  // The lines of the engine whose tab is open.
  const engine = useApp(viewEngine)
  const lines = (page && readOf(page, engine).result?.lines) || NO_LINES
  const stroke = 1.5 / view.scale
  const showConf = useApp((s) => s.showConfidence)
  // The word under the pointer (or last tapped), for its score label.
  // Kept with the lines it belongs to, so a new page or a re-read drops it.
  const [tipAt, setTipAt] = useState<{ lines: OcrLine[]; line: number; word: number } | null>(null)
  const tip = tipAt && tipAt.lines === lines && showConf ? tipAt : null
  const tipWord = tip && lines[tip.line] ? wordsOf(lines[tip.line])[tip.word] : undefined
  const setTip = (t: { line: number; word: number } | null) => setTipAt(t && { lines, ...t })
  const hover = (line: number | null, word?: number) => {
    useApp.getState().hoverLine(line)
    setTip(line === null || word === undefined ? null : { line, word })
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none overflow-hidden bg-muted/60" style={{ cursor: 'grab' }}>
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable
          onDragEnd={(e) => {
            if (e.target === stageRef.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }))
          }}
          onWheel={onWheel}
          onTouchMove={onTouchMove}
          onTouchEnd={() => {
            pinch.current = null
          }}
        >
          <Layer>
            <Rect name="page" width={pageSize.width} height={pageSize.height} fill="#fff" shadowColor="#000" shadowBlur={12 / view.scale} shadowOpacity={0.15} />
            {img && <KImage name="page" image={img} width={pageSize.width} height={pageSize.height} />}
          </Layer>
          <Layer>
            {lines.map((l, i) => {
              const on = hoveredLine === i
              return (
                <Line
                  key={i}
                  points={l.box.flat()}
                  closed
                  // With confidence on, the line is only an outline when hovered; its words carry the colour.
                  stroke={showConf ? (on ? '#2563eb' : 'transparent') : on ? '#2563eb' : 'rgba(37,99,235,0.55)'}
                  strokeWidth={on ? stroke * 2 : stroke}
                  fill={on ? 'rgba(37,99,235,0.12)' : showConf ? 'rgba(0,0,0,0.001)' : 'rgba(37,99,235,0.06)'}
                  onMouseEnter={() => hover(i)}
                  onMouseLeave={() => hover(null)}
                  onClick={() => useApp.getState().setFocusLine(i)}
                  onTap={() => useApp.getState().setFocusLine(i)}
                />
              )
            })}
            {showConf &&
              lines.map((l, i) =>
                wordsOf(l).map((w, k) => {
                  const st = CONF_STYLE[confLevel(w.confidence)]
                  const on = tip?.line === i && tip.word === k
                  return (
                    <Line
                      key={`${i}.${k}`}
                      points={w.box.flat()}
                      closed
                      stroke={st.stroke}
                      strokeWidth={on ? stroke * 2 : stroke}
                      dash={st.dash?.map((d) => d / view.scale)}
                      fill={st.fill}
                      onMouseEnter={() => hover(i, k)}
                      onMouseLeave={() => hover(null)}
                      onClick={() => useApp.getState().setFocusLine(i)}
                      onTap={() => {
                        setTip({ line: i, word: k })
                        useApp.getState().setFocusLine(i)
                      }}
                    />
                  )
                }),
              )}
          </Layer>
        </Stage>
      )}
      {tipWord && tipWord.box.length > 0 && (
        <div
          data-testid="confidence-tip"
          className="pointer-events-none absolute z-10 flex max-w-64 items-center gap-2 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md"
          style={{
            left: Math.max(4, view.x + Math.min(...tipWord.box.map((p) => p[0])) * view.scale),
            top: view.y + Math.min(...tipWord.box.map((p) => p[1])) * view.scale - 6,
            transform: 'translateY(-100%)',
          }}
        >
          <span className="truncate">{tipWord.text}</span>
          <span className="font-semibold tabular-nums" style={{ color: CONF_STYLE[confLevel(tipWord.confidence)].stroke.replace(/[\d.]+\)$/, '1)') }}>
            {pct(tipWord.confidence)}
          </span>
        </div>
      )}
      {showConf && lines.length > 0 && <Legend />}
    </div>
  )
}
