import { useCallback, useEffect, useState } from 'react'
import { orientationFor, readUiScale, writeUiScale, type UiOrientation, type UiScale } from '../lib/uiScale'

export function useUiScale() {
  const [scale, setScale] = useState<UiScale>(readUiScale)
  const [orientation, setOrientation] = useState<UiOrientation>(() => orientationFor(window.innerWidth, window.innerHeight))

  useEffect(() => {
    const update = () => setOrientation(orientationFor(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  const updateScale = useCallback((next: UiScale) => {
    setScale(next)
    writeUiScale(next)
  }, [])

  return { scale, orientation, active: scale[orientation], updateScale }
}
