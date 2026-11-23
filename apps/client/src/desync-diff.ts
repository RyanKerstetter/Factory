import type { ChunkSnapshot, EntityState, LinkState } from '../../../packages/shared/src/index.ts'

// What differs between the page's copy of a chunk and the server's at the same tick, one line for each difference,
// for the console in a development build when a chunk's hash does not match.
export function diffChunkSnapshots(local: ChunkSnapshot, server: ChunkSnapshot): string[] {
  const lines: string[] = []
  for (const [id, mine, theirs] of pairedById(local.entities, server.entities, (entity) => entity.id)) {
    if (!mine) lines.push(`building ${id} (${describe(theirs!)}) is missing here`)
    else if (!theirs) lines.push(`building ${id} (${describe(mine)}) is here but not on the server`)
    else {
      for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
        const a = JSON.stringify((mine as Record<string, unknown>)[key])
        const b = JSON.stringify((theirs as Record<string, unknown>)[key])
        if (a !== b) lines.push(`building ${id} (${describe(mine)}) ${key}: here ${a}, server ${b}`)
      }
    }
  }
  for (const [id, mine, theirs] of pairedById(local.links, server.links, (link) => link[0])) {
    if (!mine) lines.push(`link ${id} ${describeLink(theirs!)} is missing here`)
    else if (!theirs) lines.push(`link ${id} ${describeLink(mine)} is here but not on the server`)
    else if (JSON.stringify(mine.slice(0, 6)) !== JSON.stringify(theirs.slice(0, 6))) {
      lines.push(`link ${id}: here ${describeLink(mine)}, server ${describeLink(theirs)}`)
    }
  }
  for (const [id, mine, theirs] of pairedById(local.drops ?? [], server.drops ?? [], (drop) => drop[0])) {
    const a = JSON.stringify(mine ?? null)
    const b = JSON.stringify(theirs ?? null)
    if (a !== b) lines.push(`item on the ground ${id}: here ${a}, server ${b}`)
  }
  return lines
}

// Every ID on either side, in order, with what each side has under it (undefined where it has nothing).
function* pairedById<T>(mine: readonly T[], theirs: readonly T[], idOf: (thing: T) => number): Generator<[number, T | undefined, T | undefined]> {
  const here = new Map(mine.map((thing) => [idOf(thing), thing]))
  const there = new Map(theirs.map((thing) => [idOf(thing), thing]))
  for (const id of [...new Set([...here.keys(), ...there.keys()])].sort((a, b) => a - b)) yield [id, here.get(id), there.get(id)]
}

function describe(entity: EntityState): string {
  return `${entity.kind} at ${entity.x},${entity.y}`
}

function describeLink(link: LinkState): string {
  return `${link[1]} → ${link[2]}`
}
