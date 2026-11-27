import { SUB, TPS } from './constants.ts'
import { distanceToTileSquared } from './geometry.ts'

// Waystones. A player puts one down and gives it a name; opening one lists every other waystone in the world (the
// server sends the list to every page: a page only simulates the chunks near it, so it cannot find them itself), and
// picking one there sends a `warp` command. The waystone then charges for WARP_TICKS, the player held still on it the
// while (their page sends no movement, and the server plays none), and they arrive beside the other waystone, in front
// of it (or beside it, if that is blocked). The server says when a warp starts and ends (`warp` and `warp-` in the
// log), for every page to draw it: the lights up the stone's sides coming on one after another, bottom to top, and the
// flash where they arrive.
// How near a player has to be to a waystone (tiles, from its middle) to open it or travel from it.
export const WAYSTONE_REACH = 3
export function nearWaystone(player: { x: number; y: number }, x: number, y: number): boolean {
  return distanceToTileSquared(player.x, player.y, x, y) <= (WAYSTONE_REACH * SUB) ** 2
}

export const WARP_SECONDS = 3
export const WARP_TICKS = WARP_SECONDS * TPS
// How far (tiles) a player can be pushed from where they started a warp (a knock, a shove from another player) before
// it is called off.
export const WARP_SLIP = 1

// The marks up a waystone's face, which light up one after another from the bottom as it charges: WARP_LIGHT_LEVELS
// of them, and the keystone mark at the top, which comes on last, just before the player goes. When each level comes
// on, as a share of the warp (0 to 1): evenly spaced, the keystone (level WARP_LIGHT_LEVELS) at WARP_KEYSTONE_AT. Drawn
// and heard on the pages alike.
export const WARP_LIGHT_LEVELS = 2
const WARP_KEYSTONE_AT = 0.86
export function warpLightAt(level: number): number {
  return ((level + 0.6) / (WARP_LIGHT_LEVELS + 0.6)) * WARP_KEYSTONE_AT
}

// A waystone, as the list of them says: where it is (its tile) and its name ('' for none).
export type WaystoneInfo = { id: number; name: string; x: number; y: number }

// What a waystone is called in the list: its name, or where it is.
export function waystoneTitle(info: { name?: string; x: number; y: number }): string {
  return info.name ? info.name : `Waystone at ${info.x}, ${info.y}`
}

// The tiles beside a waystone a player can arrive on, best first: in front of it (south, towards the camera), then to
// its sides, behind it, and the corners.
export const ARRIVAL_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]
