import type Konva from 'konva'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Image as KImage, Layer, Line, Rect, Stage } from 'react-konva'
import { getPageBitmap } from '@/lib/ocrService'
import { readOf, useActiveFile, useActivePage, useApp, viewEngine } from '@/state/store'
import type { OcrLine } from '@/ocr/engine'

const NO_LINES: OcrLine[] = []

const MAX_ZOOM = 8

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
            {lines.map((l, i) => (
              <Line
                key={i}
                points={l.box.flat()}
                closed
                stroke={hoveredLine === i ? '#2563eb' : 'rgba(37,99,235,0.55)'}
                strokeWidth={hoveredLine === i ? stroke * 2 : stroke}
                fill={hoveredLine === i ? 'rgba(37,99,235,0.18)' : 'rgba(37,99,235,0.06)'}
                onMouseEnter={() => useApp.getState().hoverLine(i)}
                onMouseLeave={() => useApp.getState().hoverLine(null)}
                onClick={() => useApp.getState().setFocusLine(i)}
                onTap={() => useApp.getState().setFocusLine(i)}
              />
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  )
}
