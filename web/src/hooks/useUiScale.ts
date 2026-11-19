import { useCallback, useEffect, useState } from 'react'
import { orientationFor, readUiScale, readUiScaleEnabled, writeUiScale, writeUiScaleEnabled, type UiOrientation, type UiScale } from '../lib/uiScale'

export function useUiScale() {
  const [scale, setScale] = useState<UiScale>(readUiScale)
  const [enabled, setEnabledState] = useState<boolean>(readUiScaleEnabled)
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

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next)
    writeUiScaleEnabled(next)
  }, [])

  const profile = scale[orientation]
  const isSet = profile.x !== 1 || profile.y !== 1
  return {
    scale,
    orientation,
    active: enabled ? profile : { x: 1, y: 1 },
    isSet,
    enabled,
    setEnabled,
    updateScale,
  }
}
