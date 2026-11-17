export type UiOrientation = 'portrait' | 'landscape'

export interface UiScaleAxis {
  x: number
  y: number
}

export interface UiScale {
  portrait: UiScaleAxis
  landscape: UiScaleAxis
}

export const DEFAULT_UI_SCALE: UiScale = {
  portrait: { x: 1, y: 1 },
  landscape: { x: 1, y: 1 },
}

const UI_SCALE_KEY = 'wede_ui_scale'

export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0.5, value))
}

export function orientationFor(width: number, height: number): UiOrientation {
  return width > height ? 'landscape' : 'portrait'
}

function normalizeAxis(raw: Partial<UiScaleAxis> | undefined): UiScaleAxis {
  return {
    x: clampUiScale(raw?.x ?? 1),
    y: clampUiScale(raw?.y ?? 1),
  }
}

export function normalizeUiScale(raw: Partial<UiScale> | null | undefined): UiScale {
  return {
    portrait: normalizeAxis(raw?.portrait),
    landscape: normalizeAxis(raw?.landscape),
  }
}

export function readUiScale(): UiScale {
  try {
    const raw = localStorage.getItem(UI_SCALE_KEY)
    if (raw) return normalizeUiScale(JSON.parse(raw) as Partial<UiScale>)
  } catch { /* ignore */ }
  return { ...DEFAULT_UI_SCALE, portrait: { ...DEFAULT_UI_SCALE.portrait }, landscape: { ...DEFAULT_UI_SCALE.landscape } }
}

export function writeUiScale(scale: UiScale): void {
  try { localStorage.setItem(UI_SCALE_KEY, JSON.stringify(scale)) } catch { /* ignore */ }
}

export function elementScale(el: HTMLElement | null | undefined, axis: 'x' | 'y'): number {
  if (!el) return 1
  const rect = el.getBoundingClientRect()
  const layout = axis === 'x' ? el.offsetWidth : el.offsetHeight
  const visual = axis === 'x' ? rect.width : rect.height
  return layout > 0 && visual > 0 ? visual / layout : 1
}
