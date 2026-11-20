// RemoteCursors — renders collaborators' semantic cursor locations across the
// app. Targets arrive as line/column, image/page points, or panel fractions and
// are decoded against the local DOM, so they survive desktop/mobile layouts and
// UI scaling. Off-screen targets are clamped to the pane edge with a direction
// arrow, which also tells the viewer which way to scroll to keep following.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, MousePointer2 } from 'lucide-react'
import type { PresenceMember, CollabPointer } from '../types'
import { pointerLabel } from '../lib/collabPointer'
import { decodeCollabPointer, type PointerDirection } from '../lib/collabPointerDom'
import { useMobile } from '../hooks/useMobile'

export interface RemoteCursorsProps {
  pointers: Record<string, CollabPointer> | null | undefined
  roster: PresenceMember[]
  onJump?: (pointer: CollabPointer) => void
}

const DIRECTION_ICON = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
} as const

function EdgeArrow({ direction, color, small }: { direction: PointerDirection; color: string; small?: boolean }) {
  const Icon = DIRECTION_ICON[direction]
  return (
    <span
      className={`flex items-center justify-center rounded-full shadow-md ${small ? 'w-4 h-4' : 'w-5 h-5'}`}
      style={{ backgroundColor: color }}
    >
      <Icon className={`text-white ${small ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} strokeWidth={3} />
    </span>
  )
}

export default function RemoteCursors({ pointers, roster, onJump }: RemoteCursorsProps) {
  const [, setTick] = useState(0)
  const isMobile = useMobile()

  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    return () => {
      window.removeEventListener('resize', bump)
      window.removeEventListener('scroll', bump, true)
    }
  }, [])

  const byId: Record<string, PresenceMember> = {}
  for (const m of roster) byId[m.id] = m
  const entries = Object.entries(pointers || {}).flatMap(([id, pointer]) => {
    const member = byId[id]
    if (!member) return []
    const decoded = decodeCollabPointer(pointer)
    if (!decoded) return []
    return [{ id, member, pointer, decoded }]
  })
  if (entries.length === 0) return null

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden">
      {entries.map(({ id, member, pointer, decoded }) => {
        const color = member.color || '#888888'
        const label = pointerLabel(pointer)
        const title = `${member.username || 'anon'} — ${label}`
        return (
          <button
            key={id}
            type="button"
            data-testid="remote-cursor"
            data-user={member.username || member.id}
            data-x={decoded.x}
            data-y={decoded.y}
            data-offscreen={decoded.offscreen ? (decoded.direction || 'true') : 'false'}
            title={title}
            onClick={() => onJump?.(pointer)}
            className="absolute pointer-events-auto flex items-start gap-1 bg-transparent border-0 p-0 text-left"
            style={{
              left: decoded.x,
              top: decoded.y,
              transform: decoded.offscreen ? 'translate(-50%, -50%)' : 'translate(-2px, -2px)',
            }}
          >
            {decoded.offscreen && decoded.direction ? (
              <EdgeArrow direction={decoded.direction} color={color} small={isMobile} />
            ) : (
              <MousePointer2 className={`drop-shadow-sm ${isMobile ? 'w-3 h-3' : 'w-4 h-4'}`} style={{ color, fill: color }} />
            )}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
