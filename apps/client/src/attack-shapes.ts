import { basicArea, DASH_TICKS, SPIN_TICKS, SUB, TICK_MS, type AttackArea, type ChargedKind, type Weapon } from '../../../packages/shared/src/index.ts'
import type { PlayerPose, Swish } from './render3d/frame.ts'

// How an attack looks, in tiles from where the player stands, pointing the way it is aimed: the arms' pose as it is
// made, and the swish in the air that traces exactly what it covers (the same numbers the server judges hits by, see
// weapons.ts and the server's combat.ts), so what is inside it is what gets hit. A charged attack (the button held
// down: see `charged` in weapons.ts) has its own: a spin all round, a bigger strike, a dash, a slam, a throw.

// How long an attack's swing is drawn for, in milliseconds (after a shot's windup).
export const SWING_MS = 280
// How long a slam is drawn for: slower and heavier than a swing.
const SLAM_MS = 420
// How long an oar's stroke is drawn for: pulled back in from out where it is aimed.
const ROW_MS = 450

// What a melee attack covers, basic or charged (nothing for a shot or a throw: what flies does the hitting).
export function attackArea(weapon: Weapon, charged: boolean): AttackArea | undefined {
  return charged && weapon.charged ? weapon.charged.area : basicArea(weapon)
}

// How long an attack is drawn for, from its start: a shot's windup, then the swing (or the shot let go); a spin's
// turns; a dash's run.
export function attackDurationMs(weapon: Weapon, charged = false): number {
  const kind = charged ? weapon.charged?.kind : undefined
  return windupMs(weapon, charged) + motionMs(weapon, kind)
}

// How long an attack waits before it goes (its `windup`), in milliseconds.
export function windupMs(weapon: Weapon, charged = false): number {
  return (charged && weapon.charged ? weapon.charged.windup : weapon.windup) * TICK_MS
}

// How long an attack's motion is drawn for, once its windup is over.
function motionMs(weapon: Weapon, kind: ChargedKind | undefined): number {
  if (kind === 'spin') return weapon.charged!.hits * SPIN_TICKS * TICK_MS
  if (kind === 'dash') return DASH_TICKS * TICK_MS + SWING_MS / 2
  if (kind === 'slam' || kind === 'strike') return SLAM_MS
  if (kind === 'throw' || kind === 'shot' || kind === 'blast') return SWING_MS
  if (weapon.basic === 'row') return ROW_MS
  return SWING_MS
}

// The pose of an attack `elapsed` milliseconds after it started: a shot is drawn back (the bow) or whirled once round
// (the sling) through its windup and then let go; a swing sweeps, a jab or thrust goes straight out, an oar is pulled
// back in from out where it is aimed, a strike comes down
// from overhead, a staff is raised through its windup and then let go at the cast. Charged: a spin turns the player
// round and round, arm out; a slam or big strike comes down slower; a dash is a thrust held out; a throw, a drawn shot
// or a staff's blast is let go.
export function attackPose(weapon: Weapon, elapsed: number, charged = false): PlayerPose {
  const kind = charged ? weapon.charged?.kind : undefined
  if (kind) {
    // Held ready through its windup, then made.
    const wait = windupMs(weapon, true)
    if (elapsed < wait) return chargePose(weapon, 1, 1)
    const progress = Math.min(1, (elapsed - wait) / motionMs(weapon, kind))
    if (kind === 'spin') return { kind: 'spin', progress, turns: weapon.charged!.hits }
    if (kind === 'slam' || kind === 'strike') return { kind: 'strike', progress }
    if (kind === 'dash') return { kind: 'lunge', progress }
    return { kind: 'release', progress }
  }
  const windup = weapon.windup * TICK_MS
  if (weapon.basic === 'shot') {
    if (elapsed < windup) {
      const progress = windup > 0 ? elapsed / windup : 1
      return { kind: weapon.key === 'sling' ? 'whirl' : 'draw', progress }
    }
    return { kind: 'release', progress: Math.min(1, (elapsed - windup) / SWING_MS) }
  }
  if (weapon.basic === 'cast') {
    if (elapsed < windup) return { kind: 'charge', progress: windup > 0 ? elapsed / windup : 1 }
    return { kind: 'release', progress: Math.min(1, (elapsed - windup) / SWING_MS) }
  }
  // A melee attack with a windup: drawn back through it, then made.
  if (elapsed < windup) return { kind: 'charge', progress: elapsed / windup }
  const progress = Math.min(1, (elapsed - windup) / SWING_MS)
  if (weapon.basic === 'strike') return { kind: 'strike', progress }
  if (weapon.basic === 'row') return { kind: 'row', progress: Math.min(1, elapsed / ROW_MS) }
  if (weapon.basic === 'swing') return { kind: 'swing', progress, arc: weapon.arc }
  return { kind: 'thrust', progress }
}

// The pose of an attack being charged, the button held down for `held` of the `full` milliseconds it takes: a shot drawn
// back (the bow) or whirled round and round (the sling); a dash gathered for, crouched low (as a skeleton's charge);
// anything else raised back, ready to let go.
export function chargePose(weapon: Weapon, held: number, full: number): PlayerPose {
  const progress = Math.min(1, held / full)
  if (weapon.charged?.kind === 'dash') return { kind: 'brace', progress }
  if (weapon.basic === 'shot') return weapon.key === 'sling' ? { kind: 'whirl', progress: (held / 400) % 1 } : { kind: 'draw', progress }
  return { kind: 'charge', progress }
}

// The swish of an attack from x, y (tiles) aimed at `angle`, `elapsed` milliseconds after it started: exactly the shape
// a melee attack covers, traced as it goes; for a shot or a throw, a streak of air out from the hand the way it flies,
// as it is let go (longer for a charged one). A spin traces a full circle on each turn.
export function attackSwish(weapon: Weapon, x: number, y: number, angle: number, elapsed: number, charged = false): Swish | undefined {
  const base = { x, y, angle, arc: 0, inner: 0, outer: 0, width: 0, distance: 0 }
  const kind = charged ? weapon.charged?.kind : undefined
  if (kind === 'throw' || kind === 'shot') {
    if (elapsed > SWING_MS) return undefined
    return { ...base, shape: 'band', outer: 2.6, width: 0.24, progress: elapsed / SWING_MS }
  }
  // A blast comes down from above where it was aimed (its ring on the ground shows where), with no swish.
  if (kind === 'blast') return undefined
  if (kind === 'spin') {
    const turn = SPIN_TICKS * TICK_MS
    if (elapsed > weapon.charged!.hits * turn) return undefined
    const range = (weapon.range / SUB)
    // Each turn starting from behind, coming all the way round.
    return { ...base, angle: angle + Math.PI, progress: (elapsed % turn) / turn, shape: 'arc', arc: Math.PI * 2, inner: Math.min(0.35, range * 0.4), outer: range }
  }
  if ((weapon.basic === 'shot' || weapon.basic === 'cast') && !kind) {
    const after = elapsed - weapon.windup * TICK_MS
    if (after < 0 || after > SWING_MS) return undefined
    return { ...base, shape: 'band', outer: 1.6, width: 0.16, progress: after / SWING_MS }
  }
  // Traced once its windup is over.
  const after = elapsed - windupMs(weapon, kind !== undefined)
  if (after < 0) return undefined
  const duration = kind || weapon.basic === 'row' ? motionMs(weapon, kind) : SWING_MS
  if (after > duration) return undefined
  const area = attackArea(weapon, kind !== undefined)
  const progress = after / duration
  // An oar's stroke: traced from its far end back in to the player, as the oar is pulled.
  if (weapon.basic === 'row' && !kind && area?.kind === 'band') {
    return { ...base, progress, shape: 'band', outer: area.length / SUB, width: area.width / SUB, pull: true }
  }
  switch (area?.kind) {
    case 'cone':
      return { ...base, progress, shape: 'arc', arc: area.arc, inner: Math.min(0.35, (area.range / SUB) * 0.4), outer: area.range / SUB }
    case 'band':
      return { ...base, progress, shape: 'band', outer: area.length / SUB, width: area.width / SUB }
    case 'circle':
      return { ...base, progress, shape: 'ring', outer: area.radius / SUB, distance: area.distance / SUB }
    default:
      return undefined
  }
}
