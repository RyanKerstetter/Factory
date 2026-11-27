import type { AnimalInfo, AnimalPosition } from './animals.ts'
import type { LichSpell, MonsterInfo, MonsterPosition } from './monsters.ts'
import type { Command, Refusal } from './commands.ts'
import type { TerrainSettings } from './terrain.ts'
import type { Numbered } from './reliable-stream.ts'
import type { EntityState } from './sim/entity.ts'
import type { ChunkSnapshot, LinkResult } from './sim/factory-world.ts'
import type { DropState } from './sim/drops.ts'
import type { WaystoneInfo } from './waystones.ts'
import type { LinkState } from './sim/links.ts'
import type { WorldEvent } from './sim/world-events.ts'

// What goes between the server and a page. There are two kinds of traffic on the one Geckos channel:
//
// - The log: a reliable, ordered stream (see reliable-stream.ts) of what happens to the factory, tick by tick. A page
//   simulates a tick only once it has everything the server logged for it. It is sent on the `log` event, and each
//   message says, in `th`, the last tick it completes.
// - Everything else is sent unreliably and only the newest matters: where the players are (`state`), the clock
//   (`ping`/`pong`) and the movement keys (`input`).

// ---- server to page: the log

export type StreamEvent =
  // The first thing in the log: who the page is and where the world starts, and how its land lies (with the seed, all
  // the page needs to work out the biomes, the sea and the cold). Everything after it is from `tick` on.
  | { k: 'welcome'; tick: number; playerId: number; seed: number; code: string; name?: string; terrain?: TerrainSettings }
  // Who is in the game, sent whenever it changes. Not part of the simulation, so used as soon as it arrives.
  | { k: 'roster'; players: Array<[number, string]> }
  // Who the host is (the player who made the game, who can change its settings), whether players can hurt each other,
  // and whether item spawning is on; sent on joining and whenever it changes.
  | { k: 'room'; host: string; pvp: boolean; items?: boolean }
  // A player was hurt by another (`amount`), and whether that knocked them out (back to the spawn, healed).
  | { k: 'hurt'; id: number; amount: number; died: boolean }
  // A target dummy was hit, this hard (it never breaks: this is only to show the number).
  | { k: 'dummy'; id: number; amount: number }
  // The player has truesight (they ate a truesight flesh): the fog over the far islands is lifted for them. Sent on
  // joining, if they have it, and when they get it.
  | { k: 'sight' }
  // What a player holds (an item ID, 0 for nothing) and wears (head, body, feet: item IDs, 0 for none), for drawing
  // them: sent to everyone when it changes, and of everyone to a player who joins.
  | { k: 'gear'; id: number; held: number; armor: number[] }
  // A player attacked (for drawing it on other pages): with what (the item ID, 0 for fists), which way (radians), and
  // whether it was a charged attack.
  | { k: 'swung'; id: number; item: number; angle: number; charged?: 1 }
  // What a monster near the player is (see monsters.ts), sent when it comes near and whenever that changes; and one that
  // is gone (out of range, or dead: `died`, the damage of the killing blow).
  | { k: 'monster'; m: MonsterInfo }
  | { k: 'monster-'; id: number; died?: number }
  // A spike trap in a copy of the dungeon was set off (for drawing it): its spikes come up `delay` ticks from now (see
  // DUNGEON_TRAPS and the server's dungeons.ts).
  | { k: 'trap'; slot: number; trap: number; delay: number }
  // The frost lich cast a spell that the pages draw (a blizzard, a wisp or an archer called up): where (units), how far
  // it reaches (tiles), and for how long (ticks).
  | { k: 'spell'; spell: LichSpell; x: number; y: number; radius: number; ticks: number }
  // Every waystone in the world (see waystones.ts): sent on joining, and to everyone whenever one is put down, named or
  // taken away.
  | { k: 'waystones'; list: WaystoneInfo[] }
  // A player started travelling between two waystones (their tiles), arriving `ticks` from now; and the end of it,
  // `arrived` if they did (else it was called off).
  | { k: 'warp'; id: number; from: { x: number; y: number }; to: { x: number; y: number }; ticks: number }
  | { k: 'warp-'; id: number; arrived: boolean }
  // What an animal near the player is, sent when it comes near and whenever that changes; and one that is gone (out of
  // range, or dead). Animals are not part of the simulation either (see animals.ts).
  | { k: 'animal'; a: AnimalInfo }
  // An animal is no longer near the player; `died` (the damage of the killing blow) if it was killed.
  | { k: 'animal-'; id: number; died?: number }
  // Before phase A of `tick`: what a command did to a chunk this page simulates.
  | { k: 'world'; tick: number; ev: WorldEvent }
  // Before phase A of `tick`: what became of one of this page's own commands (`seq` is the number it was sent with),
  // and how many items it moved, if it moves items.
  | { k: 'result'; tick: number; seq: number; ok: boolean; why?: Refusal; moved?: number }
  // Before phase A of `tick`: the player's inventory, whenever a command changes it.
  | { k: 'pinv'; tick: number; inv: number[] }
  // Phase B of `tick`: what happened on a link that this page simulates only one end of.
  | { k: 'link'; tick: number; r: LinkResult }
  // After `tick`: a chunk's hash, to check the page's copy against.
  | { k: 'hash'; tick: number; chunk: number; hash: number }
  // After `tick`: a chunk the page now simulates, as it is at the end of `tick`. A big chunk comes in parts; the
  // links and the items on its ground come in the last.
  | { k: 'chunk'; tick: number; chunk: number; entities: EntityState[]; links: LinkState[]; drops?: DropState[]; last: boolean }
  // After `tick`: a chunk the page no longer simulates.
  | { k: 'unload'; tick: number; chunk: number }
  // After `tick`: in a development build, the server's copy of a chunk as it was at the end of tick `at`, which the
  // page reported a different hash for (or null if the server no longer has it), for comparing the two.
  | { k: 'dump'; tick: number; chunk: number; at: number; dump: ChunkSnapshot | null }

export type LogMessage = Numbered<{ th?: number; ev: StreamEvent[] }>

// The phase of a tick an event belongs to, which is the order a page applies them in.
export type EventPhase = 'now' | 'before' | 'exchange' | 'after'

export function eventPhase(event: StreamEvent): EventPhase {
  switch (event.k) {
    case 'welcome':
    case 'roster':
    case 'room':
    case 'hurt':
    case 'dummy':
    case 'sight':
    case 'gear':
    case 'swung':
    case 'monster':
    case 'monster-':
    case 'trap':
    case 'spell':
    case 'waystones':
    case 'warp':
    case 'warp-':
    case 'animal':
    case 'animal-':
      return 'now'
    case 'world':
    case 'result':
    case 'pinv':
      return 'before'
    case 'link':
      return 'exchange'
    case 'hash':
    case 'chunk':
    case 'unload':
    case 'dump':
      return 'after'
  }
}

// ---- server to page: unreliable

// Where everyone is, once a tick: [player ID, x, y] in units. `t` is the server's tick, `s` the number of the last log
// message sent before it (so a page that has every log message up to `s` has the whole log up to `t`), and `a` the
// last of this page's movement inputs the server has played. `n` is where the animals near the player are, `m` the
// monsters, `j` what is in flight near it (arrows, stones, spells: [id, item, x, y, 1 once it has stopped], and for
// something lobbed up and over, a goblin shaman's hex, how high it is, in units), `h` the
// player's own health, and `b` how warm their body is, in tenths of a °C (see cold.ts). `r` is where the rafts near the
// player are ([id, x, y, angle in thousandths of a radian, the player leading it on a rope or 0, the fence it is tied
// to or 0]: see rafts.ts), `q` which players are aboard which raft
// ([player ID, raft ID]), and `o`, while the player is aboard one, where on it they are after input `a` ([raft ID, x,
// y], units from its middle along its own axes). `c`, while the player is making something by hand, what ([recipe ID, ticks
// spent on it so far (it only goes on while their inventory is open), how many are waiting, it included]). `v`, while a rope is pulling the player
// along, how fast (units a tick, [x, y]: see `ropeStep`), for the page to play its inputs on from.
export type StateMessage = {
  t: number
  s: number
  a: number
  p: Array<[number, number, number]>
  n?: AnimalPosition[]
  m?: MonsterPosition[]
  j?: Array<[number, number, number, number, number] | [number, number, number, number, number, number]>
  h?: number
  b?: number
  r?: Array<[number, number, number, number, number, number]>
  q?: Array<[number, number]>
  o?: [number, number, number]
  c?: [number, number, number]
  v?: [number, number]
}
export type PongMessage = { c: number; t: number }
export type RequestAckMessage = { s: number }
export type ErrorMessage = { message: string }

// ---- page to server

// A command, or a report that a chunk's hash did not match.
export type Request =
  | { k: 'cmd'; tick: number; c: Command }
  | { k: 'desync'; chunk: number; tick: number; hash: number }
  // A request the server could not read (the server puts this in its place): it is answered as a command refused, so
  // the stream goes on past it rather than waiting for it forever.
  | { k: 'bad' }

export type RequestMessage = Numbered<{ r: Request }>
export type InputMessage = { i: Array<[number, number]> }

// The lobby API, over HTTP. A running game: its code (what invite links and the join box use), its world's name and
// seed, and who is in it. A saved world that is not running: the same, when it was last saved (ms since 1970), and
// everyone who has played in it.
export type GameInfo = { code: string; name: string; seed: number; players: number; playerNames: string[] }
export type SavedWorldInfo = { code: string; name: string; seed: number; savedAt: number; players: string[] }

// A player's name as the server keeps it: trimmed, and something if it is empty.
export function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, 24)
  return trimmed || 'Cave dweller'
}
