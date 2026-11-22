/* simple 2d related definitions and utilites
 * alternatives: https://github.com/toji/gl-matrix/tree/master/src and others
 * optimized for size and simplicity
 * more complex stuff like polygons, intersections, distances etc probably should go into an additional file
 */

export type D2 = [number, number] // 2 dimensions vector or point
export type Line = [D2, D2]
export type RectTLBR = [D2, D2] // topleft, bottomright

export const n = () => [0, 0]
export const not_null = (v: D2) => v[0] == 0 && v[1] == 0 && undefined // usage not_null(v) ?? [other]
export const add = (a: D2, b: D2): D2 => [a[0] + b[0], a[1] + b[1]]
export const sub = (a: D2, b: D2): D2 => [a[0] - b[0], a[1] - b[1]]
export const scale = (p: D2, s: number): D2 => [p[0] * s, p[1] * s]
export const length = (p: D2) => Math.hypot(p[0], p[1])
export const abs = (p: D2) => [Math.abs(p[1]), Math.abs(p[0])]
// [0,0] yields [inf, inf]
export const normalize = (p: D2): D2 => scale(p, 1 / length(p))
export type Orientation = 'portrait' | 'landscape'
export const orientation = (p: D2): Orientation => (Math.abs(p[1]) > Math.abs(p[0]) ? 'portrait' : 'landscape')

// useful to find on mobile the longer side eg to place a menu
// scale(normalize(longer_side([w,h])), 40)
export const longer_side = (p: D2): D2 => {
  const a = abs(p)
  return a[0] > a[1] ? [a[0], 0] : [0, a[1]]
}

// // Dot product of two vectors
// export const dot = (a: D2, b: D2) =>
//   a[0] * b[0] + a[1] * b[1]
//
// // 2D cross product (returns scalar z-component)
// export const cross = (a: D2, b: D2) =>
//   a[0] * b[1] - a[1] * b[0]
//

//
// // Normalize a vector to unit length

// // Squared distance (avoids sqrt for comparisons)
//
// // Midpoint of two points
// export const midpoint = (p1: D2, p2: D2): D2 =>
//   [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
//
// // Linear interpolation between two points
// export const lerp = (p1: D2, p2: D2, t: number): D2 =>
//   [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]
//
// // Vector from p1 to p2
// export const vector = (p1: D2, p2: D2): D2 =>
//   [p2[0] - p1[0], p2[1] - p1[1]]
//
//
// // Angle of a vector in radians (from positive x-axis)
// export const angle = (p: D2) =>
//   Math.atan2(p[1], p[0])
//
// // Angle from p1 to p2 in radians
// export const angleBetween = (p1: D2, p2: D2) =>
//   Math.atan2(p2[1] - p1[1], p2[0] - p1[0])
//
// // Rotate a point around the origin by radians
// export const rotate = (p: D2, radians: number): D2 => {
//   const cos = Math.cos(radians)
//   const sin = Math.sin(radians)
//   return [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos]
// }
//
// // Rotate a point around a center by radians
// export const rotateAround = (p: D2, center: D2, radians: number): D2 => {
//   const cos = Math.cos(radians)
//   const sin = Math.sin(radians)
//   const dx = p[0] - center[0]
//   const dy = p[1] - center[1]
//   return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos]
// }
//
// // Translate a point by a vector
// export const translate = (p: D2, v: D2): D2 =>
//   [p[0] + v[0], p[1] + v[1]]
//
// // Check if two points are equal (within epsilon)
// export const equals = (p1: D2, p2: D2, epsilon = 1e-10) =>
//   Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon
//
// // Check if three points are collinear
// export const collinear = (a: D2, b: D2, c: D2, epsilon = 1e-10) =>
//   Math.abs(cross(vector(a, b), vector(a, c))) < epsilon
//
// // Distance from a point to a line segment
// export const pointToSegmentDistance = (p: D2, a: D2, b: D2) => {
//   const segLenSq = distanceSq(a, b)
//   if (segLenSq === 0) return distance(p, a)
//   let t = dot(vector(a, p), vector(a, b)) / segLenSq
//   t = Math.max(0, Math.min(1, t))
//   const projection = lerp(a, b, t)
//   return distance(p, projection)
// }
//
// // Projection of point p onto line segment ab (clamped to segment)
// export const projectOnSegment = (p: D2, a: D2, b: D2): D2 => {
//   const segLenSq = distanceSq(a, b)
//   if (segLenSq === 0) return [...a]
//   let t = dot(vector(a, p), vector(a, b)) / segLenSq
//   t = Math.max(0, Math.min(1, t))
//   return lerp(a, b, t)
// }
//
// // Check if two line segments intersect
// export const segmentsIntersect = (a1: D2, a2: D2, b1: D2, b2: D2) => {
//   const d1 = cross(vector(b1, b2), vector(b1, a1))
//   const d2 = cross(vector(b1, b2), vector(b1, a2))
//   const d3 = cross(vector(a1, a2), vector(a1, b1))
//   const d4 = cross(vector(a1, a2), vector(a1, b2))
//
//   if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
//       ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
//     return true
//   }
//
//   // Check collinear cases
//   const epsilon = 1e-10
//   if (Math.abs(d1) < epsilon && projectOnSegment(a1, b1, b2) === a1) return true
//   if (Math.abs(d2) < epsilon && projectOnSegment(a2, b1, b2) === a2) return true
//   if (Math.abs(d3) < epsilon && projectOnSegment(b1, a1, a2) === b1) return true
//   if (Math.abs(d4) < epsilon && projectOnSegment(b2, a1, a2) === b2) return true
//
//   return false
// }
//
// // Intersection point of two infinite lines (returns null if parallel)
// export const lineIntersection = (
//   a1: D2, a2: D2, b1: D2, b2: D2,
// ): D2 | null => {
//   const d = cross(vector(a1, a2), vector(b1, b2))
//   if (Math.abs(d) < 1e-10) return null // Parallel
//   const t = cross(vector(b1, a1), vector(b1, b2)) / d
//   return lerp(a1, a2, t)
// }
//
// // Check if a point is inside an axis-aligned bounding box
// export const inBoundingBox = (
//   p: D2, min: D2, max: D2,
// ) =>
//   p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1]
//
// // Bounding box of two points
// export const boundingBox = (p1: D2, p2: D2): [D2, D2] => [
//   [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1])],
//   [Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])],
// ]
//
// // Clamp a point to an axis-aligned bounding box
// export const clampToBox = (p: D2, min: D2, max: D2): D2 => [
//   Math.max(min[0], Math.min(max[0], p[0])),
//   Math.max(min[1], Math.min(max[1], p[1])),
// ]
