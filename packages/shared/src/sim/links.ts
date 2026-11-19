import { DIR_X, DIR_Y, opposite } from '../geometry.ts'
import { ENTRIES, entryFor, type Entry } from './belt.ts'
import { hasInventory, isBeltLike, type Entity } from './entity.ts'

// A link joins one building's output port to another's input port, by their IDs. Links are worked out by the server
// when a building is placed (from where things are and which way they face) and sent to every client that
// simulates either end, so a client never has to look at a chunk it does not have to know what an edge leads to.
// Each tick, phase B goes through the links in ID order and moves at most one item along each.
export type Link = {
  id: number
  from: number
  to: number
  // The chunks the two ends are in, so a client knows whether it simulates one end, both or neither.
  fromChunk: number
  toChunk: number
  // Which side of the receiving building the items come in from.
  entry: Entry
  // Whether the last item offered was turned away (the far end is full). Only for drawing: the simulation does not
  // read it.
  blocked: boolean
}

// A link as it is sent: [id, from, to, fromChunk, toChunk, entry, blocked].
export type LinkState = [number, number, number, number, number, number, number]

export function linkToState(link: Link): LinkState {
  return [link.id, link.from, link.to, link.fromChunk, link.toChunk, ENTRIES.indexOf(link.entry), link.blocked ? 1 : 0]
}

export function linkFromState(state: LinkState): Link {
  const [id, from, to, fromChunk, toChunk, entry, blocked] = state
  return { id, from, to, fromChunk, toChunk, entry: ENTRIES[entry] ?? 'back', blocked: blocked === 1 }
}

// A link that should exist, before it has an ID.
export type LinkSpec = { from: Entity; to: Entity; entry: Entry }

type At = (x: number, y: number) => Entity | undefined

// What a building's output feeds, if anything: a belt hands its items to the building in front of it, if that is a
// belt not facing back into it, or a chest. Miners and chests do not push; they are pulled from by extractors.
function outputSpec(entity: Entity, at: At): LinkSpec | undefined {
  if (!isBeltLike(entity)) return undefined
  const target = at(entity.x + DIR_X[entity.dir], entity.y + DIR_Y[entity.dir])
  if (!target) return undefined
  if (isBeltLike(target)) {
    const entry = entryFor(target.dir, entity.dir)
    return entry ? { from: entity, to: target, entry } : undefined
  }
  if (target.kind === 'chest') return { from: entity, to: target, entry: 'back' }
  return undefined
}

// What an extractor pulls from: the inventory behind it.
function pullSpec(entity: Entity, at: At): LinkSpec | undefined {
  if (entity.kind !== 'extractor') return undefined
  const back = opposite(entity.dir)
  const source = at(entity.x + DIR_X[back], entity.y + DIR_Y[back])
  return source && hasInventory(source) ? { from: source, to: entity, entry: 'back' } : undefined
}

// Every link a building that has just been placed takes part in: its own output and pull, and those of the four
// buildings round it that lead into it. A link only depends on its two ends, so placing a building never changes
// the links between others.
export function linkSpecsFor(entity: Entity, at: At): LinkSpec[] {
  const specs: LinkSpec[] = []
  const own = outputSpec(entity, at)
  if (own) specs.push(own)
  const pull = pullSpec(entity, at)
  if (pull) specs.push(pull)
  for (let dir = 0; dir < 4; dir++) {
    const neighbour = at(entity.x + DIR_X[dir], entity.y + DIR_Y[dir])
    if (!neighbour) continue
    const output = outputSpec(neighbour, at)
    if (output && output.to === entity) specs.push(output)
    const pulled = pullSpec(neighbour, at)
    if (pulled && pulled.from === entity) specs.push(pulled)
  }
  return specs
}
