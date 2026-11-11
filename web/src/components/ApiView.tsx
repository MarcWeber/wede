import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useApiClient } from '../hooks/useApiClient'
import ApiClient from './ApiClient'
import type { AuthFetch } from '../types'

interface ApiInstanceProps {
  workspaceId: string | null
  authFetch: AuthFetch
  readOnly: boolean
}

// Each instance owns its own useApiClient state, so several API clients can be
// open at once without sharing the request editor. It is a flat shell tab in
// IDE; ApiView (the nested-strip version) is kept only for backwards import.
export function ApiInstance({ workspaceId, authFetch, readOnly }: ApiInstanceProps) {
  const api = useApiClient(workspaceId, authFetch)
  return <ApiClient api={api} authFetch={authFetch} readOnly={readOnly} />
}

export interface ApiViewProps {
  workspaceId: string | null
  authFetch: AuthFetch
  readOnly: boolean
  // Increment to add a new instance (the menu's swipe-right gesture).
  addSignal: number
}

// ApiView — the API client tab. Like terminals, it holds several instances with
// a small tab strip; the menu adds one on swipe-right or with +.
export default function ApiView({ workspaceId, authFetch, readOnly, addSignal }: ApiViewProps) {
  const [ids, setIds] = useState<number[]>([1])
  const [active, setActive] = useState(1)
  const nextId = useRef(2)

  const add = () => {
    const id = nextId.current++
    setIds((prev) => [...prev, id])
    setActive(id)
  }

  useEffect(() => {
    if (addSignal === 0) return
    const id = nextId.current++
    setIds((prev) => [...prev, id])
    setActive(id)
  }, [addSignal])

  const close = (id: number) => {
    setIds((prev) => {
      const next = prev.filter((x) => x !== id)
      if (active === id) setActive(next[next.length - 1] ?? 0)
      return next
    })
  }

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      <div className="flex items-center bg-bg-tertiary border-b border-border overflow-x-auto shrink-0 compact-touch" style={{ scrollbarWidth: 'none' }}>
        {ids.map((id, i) => (
          <div key={id} onClick={() => setActive(id)}
            className={`flex items-center gap-1.5 px-3 h-9 border-r border-border shrink-0 cursor-pointer transition-colors ${
              active === id ? 'bg-bg-primary text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
            }`}>
            <span className="text-[12px] font-medium">API {i + 1}</span>
            {ids.length > 1 && (
              <button onClick={(e) => { e.stopPropagation(); close(id) }}
                className="p-0.5 rounded text-text-muted hover:text-red hover:bg-bg-hover" title="Close">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button onClick={add}
          className="flex items-center justify-center w-8 h-9 shrink-0 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="New API client">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {ids.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted">
            <span className="text-[12px]">No API clients open</span>
            <button onClick={add} className="px-3 py-1.5 rounded-md text-[12px] bg-accent text-white hover:bg-accent-hover">
              New API client
            </button>
          </div>
        ) : ids.map((id) => (
          <div key={id} className="h-full" style={{ display: active === id ? 'block' : 'none' }}>
            <ApiInstance workspaceId={workspaceId} authFetch={authFetch} readOnly={readOnly} />
          </div>
        ))}
      </div>
    </div>
  )
}
