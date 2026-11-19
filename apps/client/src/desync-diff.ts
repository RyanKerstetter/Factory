import type { ChunkSnapshot, EntityState, LinkState } from '../../../packages/shared/src/index.ts'

// What differs between the page's copy of a chunk and the server's at the same tick, one line for each difference,
// for the console in a development build when a chunk's hash does not match.
export function diffChunkSnapshots(local: ChunkSnapshot, server: ChunkSnapshot): string[] {
  const lines: string[] = []
  const localEntities = new Map(local.entities.map((entity) => [entity.id, entity]))
  const serverEntities = new Map(server.entities.map((entity) => [entity.id, entity]))
  const ids = [...new Set([...localEntities.keys(), ...serverEntities.keys()])].sort((a, b) => a - b)
  for (const id of ids) {
    const mine = localEntities.get(id)
    const theirs = serverEntities.get(id)
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
  const localLinks = new Map(local.links.map((link) => [link[0], link]))
  const serverLinks = new Map(server.links.map((link) => [link[0], link]))
  for (const id of [...new Set([...localLinks.keys(), ...serverLinks.keys()])].sort((a, b) => a - b)) {
    const mine = localLinks.get(id)
    const theirs = serverLinks.get(id)
    if (!mine) lines.push(`link ${id} ${describeLink(theirs!)} is missing here`)
    else if (!theirs) lines.push(`link ${id} ${describeLink(mine)} is here but not on the server`)
    else if (JSON.stringify(mine.slice(0, 6)) !== JSON.stringify(theirs.slice(0, 6))) {
      lines.push(`link ${id}: here ${describeLink(mine)}, server ${describeLink(theirs)}`)
    }
  }
  const localDrops = new Map((local.drops ?? []).map((drop) => [drop[0], drop]))
  const serverDrops = new Map((server.drops ?? []).map((drop) => [drop[0], drop]))
  for (const id of [...new Set([...localDrops.keys(), ...serverDrops.keys()])].sort((a, b) => a - b)) {
    const a = JSON.stringify(localDrops.get(id) ?? null)
    const b = JSON.stringify(serverDrops.get(id) ?? null)
    if (a !== b) lines.push(`item on the ground ${id}: here ${a}, server ${b}`)
  }
  return lines
}

function describe(entity: EntityState): string {
  return `${entity.kind} at ${entity.x},${entity.y}`
}

function describeLink(link: LinkState): string {
  return `${link[1]} → ${link[2]}`
}
