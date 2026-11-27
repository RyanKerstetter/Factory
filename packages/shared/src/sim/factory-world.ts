import { chunkOfTile } from '../geometry.ts'
import { NO_ITEM, type ItemId } from '../items.ts'
import { shapeFor, type Entry } from './belt.ts'
import { Chunk } from './chunk.ts'
import { chunkOfDrop, dropFromState, dropToState, hashDrop, type Drop, type DropState } from './drops.ts'
import { Hasher } from './hash.ts'
import { entityFromState, entityToState, isBeltLike, type Entity, type EntityOf, type EntityState } from './entity.ts'
import { KindIndex } from './kind-index.ts'
import { linkFromState, linkToState, type Link, type LinkState } from './links.ts'
import { accepts, offered, receive, takeOffered } from './ports.ts'

// What happened on a link in phase B, which the server sends to every client that simulates only one end of it.
// An item handed over is sent every time; whether the link is blocked is sent only when it changes.
export type LinkResult =
  | { link: number; kind: 'accepted'; item: ItemId }
  | { link: number; kind: 'blocked' }
  | { link: number; kind: 'unblocked' }

// The results the server sent for one tick, for the links whose other end this copy does not simulate.
export type RemoteLinkResults = {
  accepted(link: number): ItemId
  blocked(link: number): boolean | undefined
  // The server says an item left a building here, but the building is not offering it: this copy has gone wrong.
  mismatch(link: Link): void
}

// A chunk as it is sent: its buildings, every link with an end in it, and the items lying on its ground.
export type ChunkSnapshot = { chunk: number; entities: EntityState[]; links: LinkState[]; drops: DropState[] }

// The factory: chunks of buildings and the links between them. The server holds every chunk; a client holds the
// chunks it simulates, and the links with at least one end in them.
//
// A tick is two phases (commands are applied before them, by whoever runs the world):
//   A) `stepInterior`: each chunk, in chunk ID order, moves its own buildings on (belts move items, miners dig) and
//      gives a few of its tiles a random tick (saplings grow), reading nothing outside itself. Whatever is to leave a
//      building waits in its output port.
//   B) `exchange`: the links, in link ID order, each move at most one item from an output port to an input port,
//      if the receiving end takes it. A client resolves the links whose ends it both simulates itself, and takes
//      the server's word for the links where it simulates only one end.
export class FactoryWorld {
  private readonly chunks = new Map<number, Chunk>()
  private chunkOrder: number[] = []
  private readonly entityChunk = new Map<number, number>()
  // The buildings by kind (see `ofKind`).
  private readonly kinds = new KindIndex()
  private readonly links = new Map<number, Link>()
  private linkOrder: number[] = []
  // The links with an end at each building, by building ID.
  private readonly linksAt = new Map<number, Set<number>>()
  // The items on the ground, by ID, and by the chunk they lie in.
  private readonly drops = new Map<number, Drop>()
  private readonly dropsIn = new Map<number, Map<number, Drop>>()

  // ---- chunks

  hasChunk(id: number): boolean {
    return this.chunks.has(id)
  }

  chunk(id: number): Chunk | undefined {
    return this.chunks.get(id)
  }

  // The chunks held, in ID order.
  get chunkIds(): readonly number[] {
    return this.chunkOrder
  }

  ensureChunk(id: number): Chunk {
    let chunk = this.chunks.get(id)
    if (!chunk) {
      chunk = new Chunk(id)
      this.chunks.set(id, chunk)
      this.chunkOrder = insertSorted(this.chunkOrder, id)
    }
    return chunk
  }

  // Lets go of a chunk: its buildings, and the links that no longer have an end in a chunk that is held.
  dropChunk(id: number): void {
    const chunk = this.chunks.get(id)
    if (!chunk) return
    for (const entity of [...chunk.entities]) {
      chunk.remove(entity.id)
      this.entityChunk.delete(entity.id)
      this.kinds.remove(entity)
    }
    for (const drop of this.dropsInChunk(id)) this.removeDrop(drop.id)
    this.chunks.delete(id)
    this.chunkOrder = this.chunkOrder.filter((other) => other !== id)
    for (const linkId of [...this.linkOrder]) {
      const link = this.links.get(linkId)
      if (link && !this.chunks.has(link.fromChunk) && !this.chunks.has(link.toChunk)) this.removeLink(linkId)
    }
  }

  // ---- buildings

  entity(id: number): Entity | undefined {
    const chunk = this.entityChunk.get(id)
    return chunk === undefined ? undefined : this.chunks.get(chunk)?.get(id)
  }

  // What stands on a tile (never its floor: see `floorAt`).
  entityAt(x: number, y: number): Entity | undefined {
    return this.chunks.get(chunkOfTile(x, y))?.at(x, y)
  }

  // The floor laid on a tile, under whatever stands on it (see Chunk).
  floorAt(x: number, y: number): Entity | undefined {
    return this.chunks.get(chunkOfTile(x, y))?.floorAt(x, y)
  }

  chunkOfEntity(id: number): number | undefined {
    return this.entityChunk.get(id)
  }

  // Every building of a kind held, in ID order: what to use instead of going through every chunk for the few of a kind
  // (waystones, altars, hives). The list is only good until a building of that kind comes or goes.
  ofKind<K extends Entity['kind']>(kind: K): readonly EntityOf<K>[] {
    return this.kinds.of(kind)
  }

  // How many buildings of a kind are held.
  countOf(kind: Entity['kind']): number {
    return this.kinds.count(kind)
  }

  // A number that goes up whenever a building of a kind comes, goes or has a new state put in (see KindIndex.changes).
  changesOf(kind: Entity['kind']): number {
    return this.kinds.changes(kind)
  }

  addEntity(entity: Entity): void {
    const chunkId = chunkOfTile(entity.x, entity.y)
    this.ensureChunk(chunkId).add(entity)
    this.entityChunk.set(entity.id, chunkId)
    this.kinds.add(entity)
    this.refreshShape(entity.id)
  }

  // Puts a building's new state in place of its old one (same ID, same tile; see Chunk.replace).
  replaceEntity(entity: Entity): void {
    const chunkId = this.entityChunk.get(entity.id)
    if (chunkId === undefined) return
    const chunk = this.chunks.get(chunkId)!
    const old = chunk.get(entity.id)!
    chunk.replace(entity)
    this.kinds.replace(old, entity)
    this.refreshShape(entity.id)
  }

  // Takes a building out, with every link to or from it.
  removeEntity(id: number): Entity | undefined {
    for (const linkId of [...(this.linksAt.get(id) ?? [])]) this.removeLink(linkId)
    const chunkId = this.entityChunk.get(id)
    if (chunkId === undefined) return undefined
    this.entityChunk.delete(id)
    const removed = this.chunks.get(chunkId)?.remove(id)
    if (removed) this.kinds.remove(removed)
    return removed
  }

  // ---- items on the ground

  drop(id: number): Drop | undefined {
    return this.drops.get(id)
  }

  // The items on a chunk's ground, in ID order.
  dropsInChunk(chunk: number): Drop[] {
    return [...(this.dropsIn.get(chunk)?.values() ?? [])].sort((a, b) => a.id - b.id)
  }

  // Every item on the ground, in ID order.
  allDrops(): Drop[] {
    return [...this.drops.values()].sort((a, b) => a.id - b.id)
  }

  addDrop(drop: Drop): void {
    const chunk = chunkOfDrop(drop)
    this.ensureChunk(chunk)
    this.drops.set(drop.id, drop)
    let inChunk = this.dropsIn.get(chunk)
    if (!inChunk) this.dropsIn.set(chunk, (inChunk = new Map()))
    inChunk.set(drop.id, drop)
  }

  removeDrop(id: number): void {
    const drop = this.drops.get(id)
    if (!drop) return
    this.drops.delete(id)
    const chunk = chunkOfDrop(drop)
    const inChunk = this.dropsIn.get(chunk)
    inChunk?.delete(id)
    if (inChunk?.size === 0) this.dropsIn.delete(chunk)
  }

  // ---- links

  link(id: number): Link | undefined {
    return this.links.get(id)
  }

  // The links held, in ID order, which is the order phase B goes through them in.
  get linkIds(): readonly number[] {
    return this.linkOrder
  }

  linksOf(entityId: number): Link[] {
    return [...(this.linksAt.get(entityId) ?? [])].sort((a, b) => a - b).map((id) => this.links.get(id)!)
  }

  addLink(link: Link): void {
    const existing = this.links.get(link.id)
    if (existing) {
      existing.blocked = link.blocked
      return
    }
    this.links.set(link.id, link)
    this.linkOrder = insertSorted(this.linkOrder, link.id)
    this.attach(link.from, link.id)
    this.attach(link.to, link.id)
    this.refreshShape(link.to)
  }

  removeLink(id: number): void {
    const link = this.links.get(id)
    if (!link) return
    this.links.delete(id)
    this.linkOrder = this.linkOrder.filter((other) => other !== id)
    this.detach(link.from, id)
    this.detach(link.to, id)
    this.refreshShape(link.to)
  }

  // A belt turns a corner when it is fed from one side only (see `shapeFor`), which is known from the links into it.
  refreshShape(entityId: number): void {
    const entity = this.entity(entityId)
    if (!entity || !isBeltLike(entity)) return
    const inputs: Entry[] = []
    for (const linkId of this.linksAt.get(entityId) ?? []) {
      const link = this.links.get(linkId)!
      if (link.to === entityId) inputs.push(link.entry)
    }
    entity.shape = shapeFor(inputs)
  }

  private attach(entityId: number, linkId: number): void {
    let set = this.linksAt.get(entityId)
    if (!set) this.linksAt.set(entityId, (set = new Set()))
    set.add(linkId)
  }

  private detach(entityId: number, linkId: number): void {
    const set = this.linksAt.get(entityId)
    if (!set) return
    set.delete(linkId)
    if (set.size === 0) this.linksAt.delete(entityId)
  }

  // ---- the tick

  // Phase A, for tick `tick` of the world made from `seed` (which pick the random ticks).
  stepInterior(tick: number, seed: number): void {
    for (const id of this.chunkOrder) this.chunks.get(id)!.step(tick, seed)
  }

  // Phase B. A link whose two ends are both here is resolved here; one with only one end here takes the result the
  // server sent (`remote`). What happened on each link resolved here is put in `results`, if given.
  exchange(remote?: RemoteLinkResults, results?: LinkResult[]): void {
    for (const id of this.linkOrder) {
      const link = this.links.get(id)!
      const from = this.entity(link.from)
      const to = this.entity(link.to)
      if (from && to) {
        const item = offered(from)
        if (item === NO_ITEM) {
          if (link.blocked) {
            link.blocked = false
            results?.push({ link: id, kind: 'unblocked' })
          }
        } else if (accepts(to, item, link.entry)) {
          receive(to, item, link.entry, takeOffered(from))
          link.blocked = false
          results?.push({ link: id, kind: 'accepted', item })
        } else if (!link.blocked) {
          link.blocked = true
          results?.push({ link: id, kind: 'blocked' })
        }
        continue
      }
      if (!remote) continue
      const item = remote.accepted(id)
      if (item !== NO_ITEM) {
        if (from) {
          if (offered(from) === item) takeOffered(from)
          else remote.mismatch(link)
        }
        if (to) receive(to, item, link.entry, 0)
        link.blocked = false
      }
      const blocked = remote.blocked(id)
      if (blocked !== undefined) link.blocked = blocked
    }
  }

  // ---- checking and copying

  hashChunk(id: number): number {
    const hasher = new Hasher().int((this.chunks.get(id) ?? new Chunk(id)).hash())
    const drops = this.dropsInChunk(id)
    hasher.int(drops.length)
    for (const drop of drops) hashDrop(hasher, drop)
    return hasher.value
  }

  snapshotChunk(id: number): ChunkSnapshot {
    const chunk = this.chunks.get(id)
    const entities = chunk ? chunk.entities.map(entityToState) : []
    const linkIds = new Set<number>()
    for (const entity of chunk?.entities ?? []) {
      for (const linkId of this.linksAt.get(entity.id) ?? []) linkIds.add(linkId)
    }
    const links = [...linkIds].sort((a, b) => a - b).map((linkId) => linkToState(this.links.get(linkId)!))
    return { chunk: id, entities, links, drops: this.dropsInChunk(id).map(dropToState) }
  }

  // Puts a chunk in as the snapshot says, in place of whatever this copy had for it.
  loadChunk(snapshot: ChunkSnapshot): void {
    const chunk = this.chunks.get(snapshot.chunk)
    const kept = new Set(snapshot.links.map((state) => state[0]))
    if (chunk) {
      for (const entity of [...chunk.entities]) {
        for (const linkId of [...(this.linksAt.get(entity.id) ?? [])]) {
          if (!kept.has(linkId)) this.removeLink(linkId)
        }
        chunk.remove(entity.id)
        this.entityChunk.delete(entity.id)
        this.kinds.remove(entity)
      }
    }
    const target = this.ensureChunk(snapshot.chunk)
    for (const state of snapshot.entities) {
      const entity = entityFromState(state)
      target.add(entity)
      this.entityChunk.set(entity.id, snapshot.chunk)
      this.kinds.add(entity)
    }
    for (const drop of this.dropsInChunk(snapshot.chunk)) this.removeDrop(drop.id)
    for (const state of snapshot.drops) this.addDrop(dropFromState(state))
    for (const state of snapshot.links) this.addLink(linkFromState(state))
    for (const state of snapshot.links) this.refreshShape(state[2])
    for (const entity of target.entities) this.refreshShape(entity.id)
  }
}

function insertSorted(list: readonly number[], value: number): number[] {
  let low = 0
  let high = list.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (list[middle] < value) low = middle + 1
    else high = middle
  }
  return [...list.slice(0, low), value, ...list.slice(low)]
}
