import { BOSS_HALL_RADIUS, LICH_SPELLS, SUB, type IsSolid, type LichSpell } from '../../../packages/shared/src/index.ts'
import type { GroundMark } from './render3d/frame.ts'

// The shapes game.ts has painted on the ground (see GroundMark), worked out from what they show: the frost lich's spells
// coming, a blizzard blowing, an icicle falling, and the debug view's hitboxes. All in tiles. (A skeleton's attacks and
// the player's own charging show nothing on the ground: they are read from poses, sounds and timing.)

type Point = { x: number; y: number }

// A circle as a polygon.
export function circle(x: number, y: number, radius: number, points = 40): Point[] {
  return Array.from({ length: points }, (_, i) => ({ x: x + Math.cos((i / points) * Math.PI * 2) * radius, y: y + Math.sin((i / points) * Math.PI * 2) * radius }))
}

// The frost lich casting at x, y: where a blizzard will blow, or the archers it calls up will come, drawn out, filling as
// the cast comes (`progress`). (Nothing is drawn round the lich itself: its staff raised is plain enough.)
export function castMarks(x: number, y: number, spell: LichSpell, progress: number): GroundMark[] {
  const pale = spell === 'summon' ? 0x9a7ad8 : 0xcfeaff
  const marks: GroundMark[] = []
  if (spell === 'blizzard') marks.push({ polygons: [circle(x, y, LICH_SPELLS.blizzard.radius / SUB)], color: 0xe8f4ff, fill: 0.06 + 0.22 * progress, stroke: 0.8 })
  if (spell === 'summon') marks.push({ polygons: [circle(x, y, BOSS_HALL_RADIUS - 1.8)], color: pale, fill: 0, stroke: 0.4 + 0.5 * progress })
  return marks
}

// A blizzard blowing round x, y out to `radius`: a whirl of white over the ground, its wind streaming round. `fade` (0
// to 1) as it comes and goes.
export function blizzardMarks(x: number, y: number, radius: number, fade: number, now: number): GroundMark[] {
  const streaks: Point[][] = []
  for (let n = 0; n < 14; n++) {
    const turn = (n / 14) * Math.PI * 2 + now / 260
    const r = radius * (0.3 + (0.6 * ((n * 37) % 10)) / 10)
    const a0 = turn
    const a1 = turn + 0.9 / r
    streaks.push([
      { x: x + Math.cos(a0) * (r - 0.05), y: y + Math.sin(a0) * (r - 0.05) },
      { x: x + Math.cos(a1) * (r - 0.05), y: y + Math.sin(a1) * (r - 0.05) },
      { x: x + Math.cos(a1) * (r + 0.05), y: y + Math.sin(a1) * (r + 0.05) },
      { x: x + Math.cos(a0) * (r + 0.05), y: y + Math.sin(a0) * (r + 0.05) },
    ])
  }
  return [
    { polygons: [circle(x, y, radius)], color: 0xf2f8ff, fill: 0.22 * fade, stroke: 0.7 * fade },
    { polygons: streaks, color: 0xffffff, fill: 0.7 * fade, stroke: 0 },
  ]
}

// Where an icicle will land (x, y, within `reach`), filling as it falls (`fall`, 0 to 1).
export function icicleMark(x: number, y: number, reach: number, fall: number): GroundMark {
  return { polygons: [circle(x, y, reach, 24)], color: 0x9fd6ff, fill: 0.08 + 0.3 * fall, stroke: 0.9 }
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
