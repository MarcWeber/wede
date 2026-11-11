// useDesktopMode — picks the initial layout mode and lets the user override it.
//
// The default is derived from the viewport aspect ratio: a landscape window
// (width > height) gets the desktop layout (sidebar + docked terminal), a
// portrait window gets the compact tab layout. This covers desktops/laptops,
// tablets and DeX in landscape, and phones in portrait, without trying to
// classify every device. The user can flip it any time from the hamburger menu
// or Settings; the choice is persisted.

import { useCallback, useState } from 'react'

const STORAGE_KEY = 'wede_desktop_mode'

export function detectDesktopMode(): boolean {
  try {
    return window.innerWidth > window.innerHeight
  } catch {
    return true
  }
}

function loadDesktopMode(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === '1') return true
    if (saved === '0') return false
  } catch { /* ignore */ }
  return detectDesktopMode()
}

export function useDesktopMode() {
  const [desktopMode, setDesktopModeState] = useState<boolean>(loadDesktopMode)

  const setDesktopMode = useCallback((v: boolean) => {
    setDesktopModeState(v)
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }, [])

  return { desktopMode, setDesktopMode }
}
