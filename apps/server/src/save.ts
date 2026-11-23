import {
  ALTAR_NUMBERS,
  OFFERING_SIZE,
  isMachineKind,
  ITEMS,
  itemByKey,
  MACHINE_SLOTS,
  type DropState,
  type EntityState,
  type LinkState,
  type PlantGeneration,
  type SavedWorldInfo,
  type TerrainSettings,
} from '../../../packages/shared/src/index.ts'
import type { AnimalSave } from './animals.ts'
import type { RaftSave } from './rafts.ts'

// A world, saved: everything that is not worked out again from the seed (the ground, ponds, ore are). Written as JSON to
// a file per world in the saves folder (SAVES_DIR, see save-folder.ts), every SAVE_EVERY_MS while it runs, when it
// closes, and when the server stops; and exported and imported as the same file. Nothing here touches the disk, so the
// page's singleplayer world (which runs the same GameRoom) can use it too.
//
// Items are kept by number in the world (inventories, items on the ground, on belts), so a save carries the key of
// every item number it was made with (`items`): loaded with other data (items added, moved or taken out), each number
// is put back to the item with its key now, and items that are gone are dropped.
// Version 2 saves only what differs from what the seed grows (version 1 saved every chunk whole, and still loads).
export const SAVE_VERSION = 2

export type PlayerSave = {
  x: number
  y: number
  health: number
  // The tile of the sleeping bag they last slept in, if any.
  bed?: [number, number]
  // Slot by slot: [item key, count], or null for an empty slot.
  inventory: Array<[string, number] | null>
  // The raft they were aboard, and where on it: [raft ID, x, y] (see rafts.ts).
  aboard?: [number, number, number]
}

export type WorldSave = {
  version: number
  code: string
  name: string
  seed: number
  // When it was saved, in ms since 1970.
  savedAt: number
  tick: number
  // The next IDs the room will give out.
  next: { entity: number; link: number; drop: number }
  // The chunks whose plants have been grown (a chunk not in here is grown afresh the first time someone comes near).
  grown: number[]
  // How much grows (see PlantGeneration), and for each chunk grown: [chunk, its first plant's ID, how many plants the
  // seed grows there, its first flint's ID, how many pieces of flint, a checksum of them]. On loading, a chunk is grown
  // again with those IDs, and then what was saved for it put in place of what changed (see `chunks`).
  generation?: PlantGeneration
  // How big the world is and how ragged its coasts are (see terrain.ts). A save from before biomes has none, and is
  // given the default.
  terrain?: TerrainSettings
  generated?: Array<[number, number, number, number, number, number]>
  // The key of each item number, as the world was saved with (index: the number).
  items: string[]
  // Each chunk with anything the seed would not grow again just as it is: those buildings, plants and items (whole),
  // and the IDs of what the seed grew there that is gone (`removed`, `removedDrops`). In a version 1 save, every chunk,
  // whole.
  chunks: Array<{ chunk: number; entities: EntityState[]; drops: DropState[]; removed?: number[]; removedDrops?: number[] }>
  links: LinkState[]
  animals?: AnimalSave
  // The rafts on the water (see the server's rafts.ts).
  rafts?: RaftSave
  // Everyone who has played in it, by name (lower case, which is how players are linked to their save).
  players: Record<string, PlayerSave>
  // The host (the player who made it), and whether players can hurt each other.
  host?: string
  pvp?: boolean
}

// The keys of the items, by number, as they are now.
export function itemKeys(): string[] {
  const keys: string[] = []
  for (const item of ITEMS) keys[item.id] = item.key
  return keys
}

// How to turn the item numbers in a save into today's: by key (0 for one that is gone).
export function itemRemap(saved: readonly string[]): (id: number) => number {
  const map = new Map<number, number>()
  saved.forEach((key, id) => {
    if (key) map.set(id, itemByKey(key)?.id ?? 0)
  })
  return (id) => (id === 0 ? 0 : (map.get(id) ?? 0))
}

// An entity's state from a save, as it is now: brought up to date if it was saved by an older version (see
// `upgradeEntity`), and with its item numbers put right: in its slots, on its belt, and a miner's ore.
export function remapEntity(saved: EntityState, remap: (id: number) => number): EntityState {
  const copy = upgradeEntity(saved) as EntityState & { inv?: number[]; lane?: number[]; ore?: number }
  if (copy.inv) copy.inv = copy.inv.map((value, i) => (i % 2 === 0 ? remap(value) : value))
  if (copy.lane) copy.lane = copy.lane.map((value, i) => (i % 2 === 0 ? remap(value) : value))
  if (copy.ore !== undefined) copy.ore = remap(copy.ore)
  // An altar's offerings, after its numbers (see OFFERING_SIZE): an item's (not a liquid's, which is below 0), and one that
  // is gone is dropped.
  const n = (copy as { n?: number[] }).n
  if (copy.kind === 'altar' && n) {
    for (let i = ALTAR_NUMBERS; i + OFFERING_SIZE <= n.length; i += OFFERING_SIZE) {
      if (n[i + 2] <= 0) continue
      n[i + 2] = remap(n[i + 2])
      if (n[i + 2] === 0) n[i + 3] = 0
    }
  }
  // An item that is gone leaves its slot empty.
  if (copy.inv) for (let i = 0; i < copy.inv.length; i += 2) if (copy.inv[i] === 0) copy.inv[i + 1] = 0
  return copy
}

// A building saved by an older version, as it is now (a copy; one that is up to date comes back as it was):
// - a stump saved before it was a station like the workbench: its numbers by name, and its slots fewer;
// - a workbench saved with a `repeat` number (since dropped), or before it had its tool slot;
// - a barrel saved with three slots of solids: it keeps its first, and its output;
// - an altar or a pedestal saved before they had a slot (only their hits then).
type SavedState = Record<string, unknown> & { kind: string; inv?: number[]; n?: number[] }
function upgradeEntity(saved: EntityState): EntityState {
  const state = { ...(saved as unknown as SavedState) }
  // Slots padded (with empty ones) to `slots`.
  const padded = (inv: readonly number[] | undefined, slots: number): number[] => [...(inv ?? []), ...new Array(Math.max(0, slots * 2 - (inv?.length ?? 0))).fill(0)]
  if (state.kind === 'stump' && state.n === undefined) {
    const { hp, recipe = 0, progress = 0, active = 0 } = state as Record<string, number>
    for (const field of ['hp', 'recipe', 'progress', 'active']) delete state[field]
    state.n = [hp, recipe, progress, active]
  }
  if (state.kind === 'workbench' && state.n?.length === 5) state.n = [state.n[0], state.n[1], state.n[3], state.n[4]]
  if (state.kind === 'barrel' && state.inv?.length === 8) state.inv = [...state.inv.slice(0, 2), ...state.inv.slice(6, 8)]
  if ((state.kind === 'altar' || state.kind === 'pedestal') && state.n === undefined) {
    state.n = [typeof state.hp === 'number' ? state.hp : 6]
    delete state.hp
  }
  if (isMachineKind(state.kind)) state.inv = padded(state.inv, MACHINE_SLOTS[state.kind])
  return state as unknown as EntityState
}

// Whether a file's contents look like a save this server can load, and if not, why not.
export function checkSave(data: unknown): { ok: true; save: WorldSave } | { ok: false; why: string } {
  if (typeof data !== 'object' || data === null) return { ok: false, why: 'That is not a saved world.' }
  const save = data as Partial<WorldSave>
  if (typeof save.version !== 'number' || save.version > SAVE_VERSION) return { ok: false, why: 'That save is from a newer version of the game.' }
  if (typeof save.name !== 'string' || typeof save.seed !== 'number' || typeof save.tick !== 'number') return { ok: false, why: 'That save is missing its name, seed or tick.' }
  if (!Array.isArray(save.chunks) || !Array.isArray(save.links) || !Array.isArray(save.items) || !Array.isArray(save.grown)) {
    return { ok: false, why: 'That save is missing its world.' }
  }
  if (typeof save.players !== 'object' || save.players === null || typeof save.next !== 'object') return { ok: false, why: 'That save is missing its players.' }
  return { ok: true, save: save as WorldSave }
}

export function savedInfo(save: WorldSave): SavedWorldInfo {
  return { code: save.code, name: save.name, seed: save.seed, savedAt: save.savedAt, players: Object.keys(save.players) }
}
