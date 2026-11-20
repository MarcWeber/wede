export type SwipeDirection =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'up-right'
  | 'down-right'
  | 'up-left'
  | 'down-left'

export interface SwipeOptions {
  minDistance?: number
  diagonalMinDistance?: number
}

export interface SwipeResult {
  direction: SwipeDirection
  dx: number
  dy: number
  distance: number
}

const DEFAULT_MIN_DISTANCE = 18
const DEFAULT_DIAGONAL_MIN_DISTANCE = 24

export function detectSwipe(dx: number, dy: number, options: SwipeOptions = {}): SwipeResult | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null

  const distance = Math.hypot(dx, dy)
  const minDistance = options.minDistance ?? DEFAULT_MIN_DISTANCE
  if (distance < minDistance) return null

  const ax = Math.abs(dx)
  const ay = Math.abs(dy)

  if (ay === 0) {
    return { direction: dx < 0 ? 'left' : 'right', dx, dy, distance }
  }
  if (ax === 0) {
    return { direction: dy < 0 ? 'up' : 'down', dx, dy, distance }
  }

  const diagonal = ax > ay / 2 && ay > ax / 2
  if (diagonal) {
    const diagonalMinDistance = options.diagonalMinDistance ?? DEFAULT_DIAGONAL_MIN_DISTANCE
    if (distance < diagonalMinDistance) return null
    const direction: SwipeDirection = dy < 0
      ? (dx > 0 ? 'up-right' : 'up-left')
      : (dx > 0 ? 'down-right' : 'down-left')
    return { direction, dx, dy, distance }
  }

  if (ay > ax) {
    return { direction: dy < 0 ? 'up' : 'down', dx, dy, distance }
  }
  return { direction: dx < 0 ? 'left' : 'right', dx, dy, distance }
}
