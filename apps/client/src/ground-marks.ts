import { BOSS_HALL_RADIUS, SUB, type IsSolid, type LichSpell } from '../../../packages/shared/src/index.ts'
import type { GroundMark } from './render3d/frame.ts'

// The shapes game.ts has painted on the ground (see GroundMark), worked out from what they show: the frost lich calling
// up its archers, and the debug view's hitboxes. All in tiles. (Frost, poison and blizzards are soft clouds instead: see
// clouds.ts. A skeleton's attacks and the player's own charging show nothing on the ground: they are read from poses,
// sounds and timing.)

type Point = { x: number; y: number }

// A circle as a polygon.
export function circle(x: number, y: number, radius: number, points = 40): Point[] {
  return Array.from({ length: points }, (_, i) => ({ x: x + Math.cos((i / points) * Math.PI * 2) * radius, y: y + Math.sin((i / points) * Math.PI * 2) * radius }))
}

// The frost lich casting at x, y: where the archers it calls up will come, drawn out, filling as the cast comes
// (`progress`). (A blizzard coming is a cloud: see clouds.ts. Nothing is drawn round the lich itself: its staff raised
// is plain enough.)
export function castMarks(x: number, y: number, spell: LichSpell, progress: number): GroundMark[] {
  if (spell !== 'summon') return []
  return [{ polygons: [circle(x, y, BOSS_HALL_RADIUS - 1.8)], color: 0x9a7ad8, fill: 0, stroke: 0.4 + 0.5 * progress }]
}

// The debug view's hitboxes: each body's round space (`half` units from its middle, in its colour), and the solid parts
// of what stands on the ground within `reach` tiles of `around`, as the player walks into them.
export function hitboxMarks(bodies: ReadonlyArray<{ x: number; y: number; half: number; color: number }>, solid: IsSolid | undefined, around: Point, reach: number): GroundMark[] {
  const marks: GroundMark[] = bodies.map((body) => ({ polygons: [circle(body.x, body.y, body.half / SUB)], color: body.color, fill: 0.15, stroke: 0.9 }))
  const boxes: Point[][] = []
  for (let ty = Math.floor(around.y) - reach; ty <= Math.floor(around.y) + reach; ty++) {
    for (let tx = Math.floor(around.x) - reach; tx <= Math.floor(around.x) + reach; tx++) {
      const found = solid?.(tx, ty)
      if (!found) continue
      for (const [x0, y0, x1, y1] of found === true ? [[0, 0, SUB, SUB] as const] : found) {
        const left = tx + x0 / SUB
        const top = ty + y0 / SUB
        const right = tx + x1 / SUB
        const bottom = ty + y1 / SUB
        boxes.push([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }])
      }
    }
  }
  if (boxes.length > 0) marks.push({ polygons: boxes, color: 0xff4fd8, fill: 0.12, stroke: 0.9 })
  return marks
}
