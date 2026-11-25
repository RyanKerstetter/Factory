import { CHUNK_SIZE, RANDOM_TICKS_PER_CHUNK } from '../constants.ts'
import { localTileIndex } from '../geometry.ts'
import { hashInts } from '../rng.ts'
import { heatFrom } from '../machines.ts'
import { hashEntity, randomTick, stepEntity, stepsEachTick, WATER_FALL_EVERY, type Entity } from './entity.ts'
import { Hasher } from './hash.ts'

// Inserts an entity into a list kept in ID order.
function insertById(list: Entity[], entity: Entity): void {
  let low = 0
  let high = list.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (list[middle].id < entity.id) low = middle + 1
    else high = middle
  }
  list.splice(low, 0, entity)
}

// One chunk's buildings. They are walked in order of their IDs, always, and a chunk only ever touches its own
// buildings: whatever crosses to another building goes through a port and a link (see FactoryWorld.exchange).
export class Chunk {
  private readonly byId = new Map<number, Entity>()
  private readonly byTile = new Map<number, Entity>()
  // The buildings in ID order, which is the order everything here goes through them in.
  private ordered: Entity[] = []
  // Those of them that do something every tick (see `stepsEachTick`), in ID order too: everything else (trees, rocks,
  // fences: nearly all of a world) only changes when something is done to it, or on a random tick, so a tick costs
  // what is working, not how big the world is.
  private readonly stepped: Entity[] = []

  constructor(readonly id: number) {}

  get size(): number {
    return this.ordered.length
  }

  get entities(): readonly Entity[] {
    return this.ordered
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id)
  }

  at(x: number, y: number): Entity | undefined {
    return this.byTile.get(localTileIndex(x, y))
  }

  add(entity: Entity): void {
    if (this.byId.has(entity.id)) throw new Error(`Chunk ${this.id} already has building ${entity.id}.`)
    const tile = localTileIndex(entity.x, entity.y)
    if (this.byTile.has(tile)) throw new Error(`Chunk ${this.id} already has a building at ${entity.x},${entity.y}.`)
    this.byId.set(entity.id, entity)
    this.byTile.set(tile, entity)
    insertById(this.ordered, entity)
    if (stepsEachTick(entity.kind)) insertById(this.stepped, entity)
  }

  remove(id: number): Entity | undefined {
    const entity = this.byId.get(id)
    if (!entity) return undefined
    this.byId.delete(id)
    this.byTile.delete(localTileIndex(entity.x, entity.y))
    this.ordered.splice(this.ordered.indexOf(entity), 1)
    const stepped = this.stepped.indexOf(entity)
    if (stepped >= 0) this.stepped.splice(stepped, 1)
    return entity
  }

  // Puts `entity` in place of the one with its ID, on the same tile and in the same place in the order (a sapling that
  // has grown into a tree).
  replace(entity: Entity): void {
    const old = this.byId.get(entity.id)
    if (!old || old.x !== entity.x || old.y !== entity.y) throw new Error(`Chunk ${this.id} cannot replace building ${entity.id}.`)
    this.byId.set(entity.id, entity)
    this.byTile.set(localTileIndex(entity.x, entity.y), entity)
    this.ordered[this.ordered.indexOf(old)] = entity
    const stepped = this.stepped.indexOf(old)
    if (stepped >= 0) this.stepped.splice(stepped, 1)
    if (stepsEachTick(entity.kind)) insertById(this.stepped, entity)
  }

  // Phase A: every building does what it does on its own, and then the random ticks: RANDOM_TICKS_PER_CHUNK tiles,
  // picked by a hash of the seed, the tick and the chunk, so every copy of the chunk picks the same ones.
  step(tick: number, seed: number): void {
    this.spreadHeat()
    for (const entity of this.stepped) stepEntity(entity)
    // Watered plots dry out on the clock, not by chance (see WATERED_SECONDS).
    if (tick % WATER_FALL_EVERY === 0) for (const entity of this.stepped) if (entity.kind === 'plot' && entity.water > 0) entity.water--
    if (this.ordered.length === 0) return
    for (let i = 0; i < RANDOM_TICKS_PER_CHUNK; i++) {
      const entity = this.byTile.get(hashInts(seed, tick, this.id, i) % (CHUNK_SIZE * CHUNK_SIZE))
      if (!entity) continue
      const replacement = randomTick(entity)
      if (replacement) this.replace(replacement)
    }
  }

  // What takes heat (a barrel, a drying rack) gets it from the hottest campfire near it in this chunk, as it was at the
  // end of the last tick (see `heatFrom`), or from one over the chunk's edge (`border`, which the server sends).
  private spreadHeat(): void {
    for (const entity of this.stepped) {
      if (entity.kind !== 'barrel' && entity.kind !== 'rack') continue
      let heat = entity.border
      for (const fire of this.stepped) {
        if ((fire.kind !== 'campfire' && fire.kind !== 'oven') || fire.heat === 0) continue
        heat = Math.max(heat, heatFrom(fire.heat, Math.max(Math.abs(fire.x - entity.x), Math.abs(fire.y - entity.y))))
      }
      entity.heat = heat
    }
  }

  hash(): number {
    const hasher = new Hasher()
    hasher.int(this.id).int(this.ordered.length)
    for (const entity of this.ordered) hashEntity(hasher, entity)
    return hasher.value
  }
}
