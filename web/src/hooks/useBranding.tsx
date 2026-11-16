/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const FALLBACK = 'wede'
const BrandingContext = createContext<string>(FALLBACK)

/** Product name shown in the UI; server-side `branding` config wins. */
export function useBranding(): string {
  return useContext(BrandingContext)
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState(FALLBACK)

  useEffect(() => {
    let cancelled = false
    fetch('/api/branding')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { branding?: unknown } | null) => {
        if (cancelled) return
        const value = typeof data?.branding === 'string' ? data.branding.trim() : ''
        if (value) setBranding(value)
      })
      .catch(() => { /* keep the fallback */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    document.title = `${branding} | Web Development Environment`
  }, [branding])

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>
}
