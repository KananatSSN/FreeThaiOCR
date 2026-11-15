import type Konva from 'konva'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Group, Image as KImage, Label, Layer, Line, Rect, Stage, Tag, Text, Transformer } from 'react-konva'
import { getPageBitmap, ocrBox } from '@/lib/ocrService'
import { type RegionBox, useActiveFile, useActivePage, useApp } from '@/state/store'

const MIN_BOX = 8 // page px
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
  const mode = useApp((s) => s.mode)
  const selectedBox = useApp((s) => s.selectedBox)
  const hoveredLine = useApp((s) => s.hoveredLine)
  const [wrapRef, size] = useSize<HTMLDivElement>()
  const img = usePageImage(current, fileId)
  const pageSize = file?.meta?.sizes[current] ?? { width: 1, height: 1 }
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const boxRefs = useRef(new Map<string, Konva.Rect>())
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

  // Attach the transformer to the selected box.
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const node = selectedBox ? boxRefs.current.get(selectedBox) : undefined
    tr.nodes(node && mode === 'box' ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedBox, mode, page?.boxes])

  // Delete / Backspace removes the selected box (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      const s = useApp.getState()
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedBox && s.activeId) {
        s.removeBox(s.activeId, s.current, s.selectedBox)
        e.preventDefault()
      }
      if (e.key === 'Escape') s.selectBox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toPage = (p: { x: number; y: number }) => ({ x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale })
  const clampX = (x: number) => Math.min(Math.max(x, 0), pageSize.width)
  const clampY = (y: number) => Math.min(Math.max(y, 0), pageSize.height)

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

  const onPointerDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const touches = (e.evt as TouchEvent).touches
    if (touches && touches.length > 1) {
      setDraft(null)
      return
    }
    const onEmpty = e.target === e.target.getStage() || e.target.name() === 'page'
    if (!onEmpty) return
    useApp.getState().selectBox(null)
    if (mode !== 'box') return
    const p = stageRef.current?.getPointerPosition()
    if (!p) return
    const q = toPage(p)
    if (q.x < 0 || q.y < 0 || q.x > pageSize.width || q.y > pageSize.height) return
    setDraft({ x0: q.x, y0: q.y, x1: q.x, y1: q.y })
  }

  const onPointerMove = () => {
    if (!draft) return
    const p = stageRef.current?.getPointerPosition()
    if (!p) return
    const q = toPage(p)
    setDraft({ ...draft, x1: clampX(q.x), y1: clampY(q.y) })
  }

  const onPointerUp = () => {
    if (!draft) return
    const x = Math.min(draft.x0, draft.x1)
    const y = Math.min(draft.y0, draft.y1)
    const w = Math.abs(draft.x1 - draft.x0)
    const h = Math.abs(draft.y1 - draft.y0)
    setDraft(null)
    if (w < MIN_BOX || h < MIN_BOX) return
    const s = useApp.getState()
    if (!s.activeId) return
    const box = s.addBox(s.activeId, s.current, { x, y, w, h })
    void ocrBox(s.activeId, s.current, box.id)
  }

  // Two-finger pinch zoom + pan on touch screens.
  const onTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const t = e.evt.touches
    if (t.length !== 2) {
      onPointerMove()
      return
    }
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

  const commitBox = (b: RegionBox, node: Konva.Rect) => {
    const sx = node.scaleX()
    const sy = node.scaleY()
    node.scale({ x: 1, y: 1 })
    let x = clampX(node.x())
    let y = clampY(node.y())
    const w = Math.max(MIN_BOX, Math.min(node.width() * sx, pageSize.width - x))
    const h = Math.max(MIN_BOX, Math.min(node.height() * sy, pageSize.height - y))
    x = Math.min(x, pageSize.width - w)
    y = Math.min(y, pageSize.height - h)
    node.position({ x, y })
    const s = useApp.getState()
    if (!s.activeId) return
    s.patchBox(s.activeId, s.current, b.id, { x, y, w, h })
    void ocrBox(s.activeId, s.current, b.id)
  }

  const lines = page?.result?.lines ?? []
  const stroke = 1.5 / view.scale
  const boxes = page?.boxes ?? []
  const cursor = mode === 'box' ? 'crosshair' : 'grab'
  const draftRect = useMemo(
    () => draft && { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) },
    [draft],
  )

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none overflow-hidden bg-muted/60" style={{ cursor }}>
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable={mode === 'pan'}
          onDragEnd={(e) => {
            if (e.target === stageRef.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }))
          }}
          onWheel={onWheel}
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
          onMouseMove={onPointerMove}
          onTouchMove={onTouchMove}
          onMouseUp={onPointerUp}
          onTouchEnd={() => {
            pinch.current = null
            onPointerUp()
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
                listening={mode === 'pan'}
                onMouseEnter={() => useApp.getState().hoverLine(i)}
                onMouseLeave={() => useApp.getState().hoverLine(null)}
                onClick={() => useApp.getState().setFocusLine(i)}
                onTap={() => useApp.getState().setFocusLine(i)}
              />
            ))}
            {boxes.map((b) => {
              const selected = b.id === selectedBox
              const color = b.status === 'error' ? '#dc2626' : '#ea580c'
              return (
                <Group key={b.id}>
                  <Rect
                    ref={(node) => {
                      if (node) boxRefs.current.set(b.id, node)
                      else boxRefs.current.delete(b.id)
                    }}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    stroke={color}
                    strokeWidth={selected ? 2.5 : 2}
                    dash={b.status === 'running' ? [6, 4] : undefined}
                    fill={selected ? 'rgba(234,88,12,0.10)' : 'rgba(234,88,12,0.04)'}
                    strokeScaleEnabled={false}
                    draggable={mode === 'box'}
                    onMouseDown={(e) => {
                      e.cancelBubble = true
                      useApp.getState().selectBox(b.id)
                    }}
                    onTouchStart={(e) => {
                      e.cancelBubble = true
                      useApp.getState().selectBox(b.id)
                    }}
                    onDragEnd={(e) => commitBox(b, e.target as Konva.Rect)}
                    onTransformEnd={(e) => commitBox(b, e.target as Konva.Rect)}
                  />
                  <Label x={b.x} y={b.y} scaleX={1 / view.scale} scaleY={1 / view.scale} offsetY={22} listening={false}>
                    <Tag fill={color} cornerRadius={4} />
                    <Text text={String(b.n)} fontSize={13} fontStyle="bold" padding={4} fill="#fff" />
                  </Label>
                </Group>
              )
            })}
            {draftRect && (
              <Rect x={draftRect.x} y={draftRect.y} width={draftRect.w} height={draftRect.h} stroke="#ea580c" strokeWidth={stroke * 1.5} dash={[6 / view.scale, 4 / view.scale]} fill="rgba(234,88,12,0.08)" listening={false} />
            )}
            <Transformer
              ref={trRef}
              rotateEnabled={false}
              keepRatio={false}
              ignoreStroke
              anchorSize={10}
              borderStroke="#ea580c"
              anchorStroke="#ea580c"
              boundBoxFunc={(oldB, newB) => (newB.width < MIN_BOX * view.scale || newB.height < MIN_BOX * view.scale ? oldB : newB)}
            />
          </Layer>
        </Stage>
      )}
    </div>
  )
}
