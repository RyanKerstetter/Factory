import type { AnimalInfo, AnimalPosition } from './animals.ts'
import type { Command, Refusal } from './commands.ts'
import type { Numbered } from './reliable-stream.ts'
import type { EntityState } from './sim/entity.ts'
import type { ChunkSnapshot, LinkResult } from './sim/factory-world.ts'
import type { DropState } from './sim/drops.ts'
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
  // The first thing in the log: who the page is and where the world starts. Everything after it is from `tick` on.
  | { k: 'welcome'; tick: number; playerId: number; seed: number; code: string; name?: string }
  // Who is in the game, sent whenever it changes. Not part of the simulation, so used as soon as it arrives.
  | { k: 'roster'; players: Array<[number, string]> }
  // What an animal near the player is, sent when it comes near and whenever that changes; and one that is gone (out of
  // range, or dead). Animals are not part of the simulation either (see animals.ts).
  | { k: 'animal'; a: AnimalInfo }
  | { k: 'animal-'; id: number }
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
// last of this page's movement inputs the server has played. `n` is where the animals near the player are, `j` the
// arrows, stones and spears in flight near it ([id, item, x, y, 1 once it has stopped]), and `h` the player's own health.
export type StateMessage = {
  t: number
  s: number
  a: number
  p: Array<[number, number, number]>
  n?: AnimalPosition[]
  j?: Array<[number, number, number, number, number]>
  h?: number
}
export type PongMessage = { c: number; t: number }
export type RequestAckMessage = { s: number }
export type ErrorMessage = { message: string }

// ---- page to server

// A command, or a report that a chunk's hash did not match.
export type Request =
  | { k: 'cmd'; tick: number; c: Command }
  | { k: 'desync'; chunk: number; tick: number; hash: number }

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
