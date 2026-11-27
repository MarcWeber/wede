// Shared gesture geometry used by DragHint and the tab strips.
//
// The gesture model is deliberately small:
//   - `chosen_by_mouse` actions are predicates (horizontal strip scrolling).
//   - `button` actions are direction targets rendered around the start point.
//   - `rest` is drag & drop.
// Mouse and touch share the same direction/translation rules; touch only adds
// a nudge toward the centre so the thumb does not cover the labels.
//
// Visual translation:
//   - mobile: move the button/cursor overlay toward the screen centre.
//   - desktop: translate only as much as needed to keep every button visible.
// The actual drag coordinates are never changed; only the overlay is shifted.

import { type D2, length, normalize, orientation, scale, sub } from './2dspace'

export interface Point2D {
  x: number
  y: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface Bounds {
  left: number
  right: number
  top: number
  bottom: number
}

export const SWIPE_Y_ACCURACY = 15

// Base gesture unit. Directional buttons win within 5*D of the start; a
// directionless drag becomes a tab drag at 3*D, while a drag along a button
// direction only takes over past the button cap.
export const D = 15
export const MAX_BUTTON_DISTANCE = 14 * D
export const TAB_DRAG_THRESHOLD = 3 * D

const toD2 = (p: Point2D): D2 => [p.x, p.y]
const fromD2 = (p: D2): Point2D => ({ x: p[0], y: p[1] })

// A strip gesture is a horizontal scroll when its vertical deviation stays
// small relative to the horizontal travel.
export function is_x_scroll(dx: number, dy: number, yAccuracy = SWIPE_Y_ACCURACY): boolean {
  return Math.abs(dy) - Math.abs(dx) / 40 < yAccuracy
}

// Mobile overlay translation: point toward the centre of the screen. When the
// gesture starts exactly in the centre, prefer down in portrait and right in
// landscape so there is always a usable direction.
export function toward_center_translation(start: Point2D, viewport: ViewportSize, distance = 60): Point2D {
  const centre: D2 = [viewport.width / 2, viewport.height / 2]
  const v = sub(centre, toD2(start))
  if (length(v) === 0) {
    const axis: D2 = orientation([viewport.width, viewport.height]) === 'portrait' ? [0, 1] : [1, 0]
    return fromD2(scale(axis, distance))
  }
  return fromD2(scale(normalize(v), distance))
}

// Desktop overlay translation: the smallest shift that keeps the supplied
// bounds inside the viewport.
export function fit_translation(bounds: Bounds, viewport: ViewportSize, padding = 8): Point2D {
  let dx = 0
  let dy = 0
  if (bounds.left < padding) dx = padding - bounds.left
  else if (bounds.right > viewport.width - padding) dx = viewport.width - padding - bounds.right
  if (bounds.top < padding) dy = padding - bounds.top
  else if (bounds.bottom > viewport.height - padding) dy = viewport.height - padding - bounds.bottom
  return { x: dx, y: dy }
}
