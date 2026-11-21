import { SUB, type Weapon } from '../../../packages/shared/src/index.ts'
import type { PlayerPose, Swish } from './render/world-renderer.ts'

// What an attack covers on the ground, in tiles, from where the player stands, pointing the way it is aimed: what the
// indicator shows while it is held (and flashes when it lands). It is drawn from the same numbers the server judges hits
// by (see weapons.ts and the server's combat.ts), so what is inside it is what gets hit.
export type AttackShape =
  // Everything within `range` and half of `arc` (radians) either side of the aim: a swing, or a narrow jab or thrust.
  | { kind: 'cone'; range: number; arc: number }
  // A straight strip `length` long and `width` wide: a shot, a throw, a lunge.
  | { kind: 'band'; length: number; width: number }
  // A ring `radius` across, `distance` ahead: a slam, or a pickaxe's strike.
  | { kind: 'circle'; distance: number; radius: number }
  // `count` strips `spread` (radians) apart: a volley.
  | { kind: 'fan'; length: number; width: number; count: number; spread: number }

// How far something shot or thrown flies before it comes down (the server's FLIGHT_TICKS), and how wide a strip it is
// drawn as.
const FLIGHT_TICKS = 40
const SHOT_WIDTH = 0.3

export function attackShape(weapon: Weapon, special: boolean): AttackShape | undefined {
  if (!special) {
    if (weapon.basic === 'shot') return { kind: 'band', length: (weapon.speed * FLIGHT_TICKS) / SUB, width: SHOT_WIDTH }
    if (weapon.basic === 'strike') return { kind: 'circle', distance: weapon.range / SUB, radius: weapon.radius / SUB }
    if (weapon.width > 0) return { kind: 'band', length: weapon.range / SUB, width: weapon.width / SUB }
    return { kind: 'cone', range: weapon.range / SUB, arc: weapon.arc }
  }
  const move = weapon.special
  if (!move) return undefined
  switch (move.kind) {
    case 'smash':
      return { kind: 'circle', distance: move.range / SUB, radius: move.radius / SUB }
    case 'lunge':
      return { kind: 'band', length: (move.dash + move.range) / SUB, width: SHOT_WIDTH * 2 }
    case 'throw':
      // A thrown spear lands after `range` (see the server's combat.ts), or flies as long as a shot.
      return { kind: 'band', length: (move.range > 0 ? move.range : move.speed * FLIGHT_TICKS) / SUB, width: SHOT_WIDTH }
    case 'volley':
      return { kind: 'fan', length: (move.speed * FLIGHT_TICKS) / SUB, width: SHOT_WIDTH, count: move.count, spread: move.spread }
    default:
      return { kind: 'cone', range: move.range / SUB, arc: move.arc }
  }
}

// An attack's shape as polygons (lists of points, in tiles), from x, y, aimed at `angle` (radians). A shot charged
// only `reach` of the way (0 to 1) flies that much less far, and is drawn so.
export function shapePolygons(shape: AttackShape, x: number, y: number, angle: number, reach = 1): Array<Array<{ x: number; y: number }>> {
  const along = (distance: number, sideways: number, heading = angle): { x: number; y: number } => ({
    x: x + Math.cos(heading) * distance - Math.sin(heading) * sideways,
    y: y + Math.sin(heading) * distance + Math.cos(heading) * sideways,
  })
  const band = (length: number, width: number, heading: number): Array<{ x: number; y: number }> => [
    along(0, -width / 2, heading),
    along(length, -width / 2, heading),
    along(length, width / 2, heading),
    along(0, width / 2, heading),
  ]
  switch (shape.kind) {
    case 'cone': {
      const points = [{ x, y }]
      const steps = Math.max(4, Math.ceil(shape.arc / 0.12))
      for (let i = 0; i <= steps; i++) {
        const heading = angle - shape.arc / 2 + (shape.arc * i) / steps
        points.push({ x: x + Math.cos(heading) * shape.range, y: y + Math.sin(heading) * shape.range })
      }
      return [points]
    }
    case 'band':
      return [band(shape.length * reach, shape.width, angle)]
    case 'circle': {
      const middle = along(shape.distance, 0)
      return [Array.from({ length: 24 }, (_, i) => ({ x: middle.x + Math.cos((i / 24) * Math.PI * 2) * shape.radius, y: middle.y + Math.sin((i / 24) * Math.PI * 2) * shape.radius }))]
    }
    case 'fan':
      return Array.from({ length: shape.count }, (_, i) => band(shape.length * reach, shape.width, angle + (i - (shape.count - 1) / 2) * shape.spread))
  }
}

// The indicator's colours: pale while an attack is held and not ready, amber once it can be let go, and for the flash
// when it lands.
export const INDICATOR_COLOR = 0xf2e8a0
export const INDICATOR_READY_COLOR = 0xffb347

// ---- how an attack looks: the arms' pose, and the swish that traces what it covers

// How an attack moves the arms (see PlayerPose): a swing sweeps, a jab or thrust goes straight out, a strike comes down
// from overhead; a shot or a throw is let go.
export type AttackStyle = 'swing' | 'thrust' | 'strike' | 'release'

export function attackStyle(weapon: Weapon, special: boolean): AttackStyle {
  if (!special) {
    if (weapon.basic === 'shot') return 'release'
    if (weapon.basic === 'strike') return 'strike'
    return weapon.basic === 'swing' ? 'swing' : 'thrust'
  }
  switch (weapon.special?.kind) {
    case 'chop':
    case 'smash':
      return 'strike'
    case 'lunge':
      return 'thrust'
    case 'throw':
    case 'volley':
      return 'release'
    default:
      return 'swing'
  }
}

// The pose of an attack `progress` of the way through (0 to 1).
export function attackPose(weapon: Weapon, special: boolean, progress: number): PlayerPose {
  const style = attackStyle(weapon, special)
  if (style === 'release') return { kind: 'release', progress, thrown: special && weapon.special?.kind === 'throw' }
  if (style === 'swing') return { kind: 'swing', progress, arc: special ? (weapon.special?.arc ?? weapon.arc) : weapon.arc }
  return { kind: style, progress }
}

// The pose while an attack is held, `charge` of the way to full (0 to 1): a bow drawn, a sling whirled, a spear pulled
// back, or a weapon cocked for its special.
export function holdingPose(weapon: Weapon, special: boolean, charge: number): PlayerPose {
  if (!special && weapon.basic === 'shot') return weapon.key === 'sling' ? { kind: 'whirl', charge } : { kind: 'draw', charge }
  if (special && weapon.special?.kind === 'throw') return { kind: 'aimThrow', charge }
  if (special && weapon.special?.kind === 'volley') return { kind: 'draw', charge: 1 }
  const style = attackStyle(weapon, special)
  return { kind: 'windup', style: style === 'release' ? 'thrust' : style, arc: weapon.special?.arc ?? weapon.arc, charge }
}

// The swish of an attack from x, y (tiles) aimed at `angle`, `progress` of the way through: exactly the shape the
// attack covers (attackShape), traced as it goes. None for what is shot or thrown (the shot itself shows that).
export function attackSwish(weapon: Weapon, special: boolean, x: number, y: number, angle: number, progress: number): Swish | undefined {
  const shape = attackShape(weapon, special)
  if (!shape || attackStyle(weapon, special) === 'release') return undefined
  const base = { x, y, angle, progress, arc: 0, inner: 0, outer: 0, width: 0, distance: 0 }
  switch (shape.kind) {
    case 'cone':
      return { ...base, shape: 'arc', arc: shape.arc, inner: Math.min(0.35, shape.range * 0.4), outer: shape.range }
    case 'band':
      return { ...base, shape: 'band', outer: shape.length, width: shape.width }
    case 'circle':
      return { ...base, shape: 'ring', outer: shape.radius, distance: shape.distance }
    default:
      return undefined
  }
}
