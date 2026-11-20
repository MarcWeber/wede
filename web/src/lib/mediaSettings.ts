import { useEffect, useState } from 'react'
import { apiBase } from '../api'

export type ImageViewMode = 'tab-viewer' | 'external'
export type PdfViewMode = 'tab-pdf-js' | 'tab-choose' | 'external'

export interface MediaSettings {
  image: ImageViewMode
  pdf: PdfViewMode
}

// Config defaults supplied by the backend (wede.config.json). These are only
// the initial values; each browser may override them in Settings.
export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  image: 'tab-viewer',
  pdf: 'tab-pdf-js',
}

export const MEDIA_SETTINGS_KEY = 'wede_media_view'
const SETTINGS_EVENT = 'wede:media-settings'

// The server-provided defaults are merged over the built-in ones once fetched.
const serverDefaults: MediaSettings = { ...DEFAULT_MEDIA_SETTINGS }
let defaultsPromise: Promise<void> | null = null

export function normalizeImageViewMode(value: unknown): ImageViewMode | undefined {
  return value === 'tab-viewer' || value === 'external' ? value : undefined
}

export function normalizePdfViewMode(value: unknown): PdfViewMode | undefined {
  return value === 'tab-pdf-js' || value === 'tab-choose' || value === 'external' ? value : undefined
}

function readOverrides(): Partial<MediaSettings> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(MEDIA_SETTINGS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<MediaSettings> = {}
    const image = normalizeImageViewMode(parsed.image)
    const pdf = normalizePdfViewMode(parsed.pdf)
    if (image) out.image = image
    if (pdf) out.pdf = pdf
    return out
  } catch {
    return {}
  }
}

/** Effective settings: the browser override wins over the config default. */
export function effectiveMediaSettings(): MediaSettings {
  const overrides = readOverrides()
  return {
    image: overrides.image ?? serverDefaults.image,
    pdf: overrides.pdf ?? serverDefaults.pdf,
  }
}

function loadServerDefaults(): Promise<void> {
  if (defaultsPromise) return defaultsPromise
  defaultsPromise = fetch(`${apiBase()}/ui-config`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { view_image?: unknown; view_pdf?: unknown } | null) => {
      const image = normalizeImageViewMode(data?.view_image)
      const pdf = normalizePdfViewMode(data?.view_pdf)
      if (image) serverDefaults.image = image
      if (pdf) serverDefaults.pdf = pdf
    })
    .catch(() => { /* keep built-in defaults */ })
  return defaultsPromise
}

/** Persist a per-browser override and notify every mounted consumer. */
export function writeMediaSettings(patch: Partial<MediaSettings>): void {
  if (typeof localStorage === 'undefined') return
  const next = { ...readOverrides(), ...patch }
  try {
    localStorage.setItem(MEDIA_SETTINGS_KEY, JSON.stringify(next))
  } catch { /* ignore quota/private-mode errors */ }
  window.dispatchEvent(new Event(SETTINGS_EVENT))
}

export function useMediaSettings(): [MediaSettings, (patch: Partial<MediaSettings>) => void] {
  const [settings, setSettings] = useState<MediaSettings>(effectiveMediaSettings)

  useEffect(() => {
    let cancelled = false
    const onChange = () => {
      if (!cancelled) setSettings(effectiveMediaSettings())
    }
    window.addEventListener(SETTINGS_EVENT, onChange)
    void loadServerDefaults().then(onChange)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_EVENT, onChange)
    }
  }, [])

  return [settings, writeMediaSettings]
}
