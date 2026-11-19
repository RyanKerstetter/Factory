import { BELT_LENGTH, type BeltShape, type Direction } from '../../../../packages/shared/src/index.ts'

// Where an item `pos` along a belt is drawn, in tiles. A straight belt carries along its middle from its back edge to
// its front edge. A belt turning a corner carries round a quarter circle from the middle of its side edge to the middle
// of its front edge. Below 0 (an item drawn on its way in from the belt behind, between two ticks) the path carries on
// straight back the way the item came.

type Point = { x: number; y: number }

// On a belt facing east, with its middle at 0,0 and its edges at ±0.5.
export function beltLocalPoint(shape: BeltShape, pos: number): Point {
  const t = pos / BELT_LENGTH
  if (shape === 'straight') return { x: -0.5 + t, y: 0 }
  // Fed from the left (the top, facing east): round the top right corner. From the right: the same, mirrored.
  const side = shape === 'left' ? 1 : -1
  if (t <= 0) return { x: 0, y: side * (-0.5 + t) }
  const angle = Math.PI - (Math.PI / 2) * Math.min(1, t)
  return { x: 0.5 + 0.5 * Math.cos(angle), y: side * (-0.5 + 0.5 * Math.sin(angle)) }
}

// Turns a point on a belt facing east to face `dir` (a quarter turn clockwise for each step).
export function rotatePoint(point: Point, dir: Direction): Point {
  switch (dir) {
    case 0:
      return point
    case 1:
      return { x: -point.y, y: point.x }
    case 2:
      return { x: -point.x, y: -point.y }
    case 3:
      return { x: point.y, y: -point.x }
  }
}

export function beltPoint(belt: { x: number; y: number; dir: Direction; shape: BeltShape }, pos: number): Point {
  const local = rotatePoint(beltLocalPoint(belt.shape, pos), belt.dir)
  return { x: belt.x + 0.5 + local.x, y: belt.y + 0.5 + local.y }
}
