import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ExternalLink, Image as ImageIcon, Maximize2, Package, ZoomIn, ZoomOut } from 'lucide-react'
import { useMediaSettings } from '../lib/mediaSettings'
import { MediaLinkPreview } from './MediaPreview'

const MIN_SCALE = 0.5
const MAX_SCALE = 8

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

interface ImagePreviewProps {
  dataUrl?: string
  filename?: string
  size?: number
  href?: string
}

interface Pointer {
  x: number
  y: number
}

interface Gesture {
  startScale: number
  startX: number
  startY: number
  startDist: number
  startMid: Pointer
}

export function ImagePreview({ dataUrl, filename, size, href }: ImagePreviewProps) {
  const [{ image: imageMode }] = useMediaSettings()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const stateRef = useRef({ scale, x, y })

  useEffect(() => {
    stateRef.current = { scale, x, y }
  }, [scale, x, y])

  const pointers = useRef(new Map<number, Pointer>())
  const gesture = useRef<Gesture | null>(null)

  const reset = useCallback(() => {
    setScale(1)
    setX(0)
    setY(0)
  }, [])

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const s = stateRef.current
    const next = clamp(s.scale * factor, MIN_SCALE, MAX_SCALE)
    const k = next / s.scale
    const el = containerRef.current
    const rect = el?.getBoundingClientRect()
    const cx = rect && clientX != null ? clientX - rect.left - rect.width / 2 : 0
    const cy = rect && clientY != null ? clientY - rect.top - rect.height / 2 : 0
    setScale(next)
    setX(cx - (cx - s.x) * k)
    setY(cy - (cy - s.y) * k)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const s = stateRef.current
    if (pointers.current.size === 1) {
      gesture.current = { startScale: s.scale, startX: s.x, startY: s.y, startDist: 0, startMid: { x: e.clientX, y: e.clientY } }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = {
        startScale: s.scale,
        startX: s.x,
        startY: s.y,
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return

    if (pointers.current.size === 1) {
      const p = [...pointers.current.values()][0]
      setX(g.startX + (p.x - g.startMid.x))
      setY(g.startY + (p.y - g.startMid.y))
      return
    }

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const nextScale = clamp(g.startScale * (dist / (g.startDist || dist)), MIN_SCALE, MAX_SCALE)
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const mx = mid.x - rect.left - rect.width / 2
      const my = mid.y - rect.top - rect.height / 2
      const smx = g.startMid.x - rect.left - rect.width / 2
      const smy = g.startMid.y - rect.top - rect.height / 2
      const k = nextScale / g.startScale
      setScale(nextScale)
      setX(mx - (smx - g.startX) * k)
      setY(my - (smy - g.startY) * k)
    }
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 1) {
      const p = [...pointers.current.values()][0]
      const s = stateRef.current
      gesture.current = { startScale: s.scale, startX: s.x, startY: s.y, startDist: 0, startMid: { x: p.x, y: p.y } }
    } else if (pointers.current.size === 0) {
      gesture.current = null
    }
  }

  if (imageMode === 'external' && href) {
    return <MediaLinkPreview icon={ImageIcon} href={href} filename={filename} size={size} />
  }

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary text-[11px] shrink-0">
        <ImageIcon className="w-3.5 h-3.5 text-text-muted shrink-0" />
        <span className="font-medium text-text-secondary truncate">{filename}</span>
        {size != null && <span className="text-text-muted opacity-60 shrink-0">{formatBytes(size)}</span>}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1 text-accent hover:underline shrink-0"
            title="Open in external tab"
          >
            ext tab <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing"
        style={{
          backgroundImage:
            'repeating-conic-gradient(var(--c-bg-hover) 0% 25%, var(--c-bg-secondary) 0% 50%)',
          backgroundSize: '20px 20px',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={(e) => {
          if (scale > 1.01) reset()
          else zoomAt(2, e.clientX, e.clientY)
        }}
      >
        <img
          src={dataUrl}
          alt={filename}
          className="max-w-full max-h-full object-contain will-change-transform"
          style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
          draggable={false}
          data-collab-image
        />

        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full border border-border bg-bg-elevated/90 backdrop-blur px-2 py-1 shadow-lg"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button type="button" title="Zoom out" onClick={() => zoomAt(0.8)} className="p-1 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-hover">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="min-w-10 text-center text-[10px] font-mono text-text-secondary">{Math.round(scale * 100)}%</span>
          <button type="button" title="Zoom in" onClick={() => zoomAt(1.25)} className="p-1 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-hover">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button type="button" title="Fit image" onClick={reset} className="p-1 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-hover">
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

interface BinaryNoticeProps {
  filename?: string
  size?: number
}

export function BinaryNotice({ filename, size }: BinaryNoticeProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-bg-primary p-6 select-none">
      <div className="w-14 h-14 rounded-2xl bg-bg-hover border border-border flex items-center justify-center mb-4">
        <Package className="w-7 h-7 text-text-muted opacity-40" />
      </div>
      <p className="text-[13px] font-semibold text-text-secondary mb-1">{filename}</p>
      <p className="text-[11px] text-text-muted">Binary file — cannot be displayed as text</p>
      {size != null && (
        <p className="text-[11px] text-text-muted mt-0.5">{formatBytes(size)}</p>
      )}
    </div>
  )
}
