import campsData from '../../../data/camps.json' with { type: 'json' }
import { CAMP_KINDS, type CampKind } from './buildings.ts'
import { TPS } from './constants.ts'
import { failIn, fieldsOf, numberField, onlyFields, wholeField, type Fail } from './data-check.ts'
import { MONSTERS } from './monsters.ts'
import { CAMP_ROCK_SPOTS } from './world-gen-data.ts'

// What keeps each kind of camp, from data/camps.json (where to tweak it), by what keeps the camp: a skeletons' tent
// ("skeleton-camp"), a goblins' lean-to ("goblin-camp"), a mummies' tomb ("tomb"). (Where camps grow is in
// data/world-gen.json.)
// - `monsters`: what keeps it: `min` to `max` of each `kind` of monster (see monsters.json), how many picked for
//   each camp by the seed and where it is. The first kind's stand round the camp, and the others' between them, spread
//   evenly.
// - `respawnSeconds`: how long after one is killed it comes back (so long as what keeps the camp stands, and only while
//   nobody is near enough to see it come).
// - `patrolRadius`: how far from the camp's fire its monsters patrol, in tiles.
// - `rocks`: `count` rocks of `kind` ("rock", "tin-rock" or "copper-rock") by what keeps it (at most
//   CAMP_ROCK_SPOTS), broken ones put back as its monsters come back.
export type CampRock = 'rock' | 'tin-rock' | 'copper-rock'
export type CampDef = {
  monsters: ReadonlyArray<{ kind: string; min: number; max: number }>
  // Ticks.
  respawn: number
  // Tiles.
  patrolRadius: number
  rocks: { kind: CampRock; count: number }
}
const CAMP_ROCK_KINDS: readonly CampRock[] = ['rock', 'tin-rock', 'copper-rock']

export const CAMPS: Readonly<Record<CampKind, CampDef>> = parseCamps(campsData)

function parseCamps(data: unknown): Record<CampKind, CampDef> {
  const raw = fieldsOf(data, 'it', failIn('data/camps.json'))
  onlyFields(raw, CAMP_KINDS, failIn('data/camps.json'))
  const camps = {} as Record<CampKind, CampDef>
  for (const kind of CAMP_KINDS) {
    const fail: Fail = failIn(`data/camps.json, ${kind}`)
    const camp = fieldsOf(raw[kind], 'it', fail)
    onlyFields(camp, ['respawnSeconds', 'patrolRadius', 'rocks', 'monsters'], fail)
    if (!Array.isArray(camp.monsters) || camp.monsters.length === 0) fail('"monsters" must be a list of what keeps it')
    const monsters = (camp.monsters as unknown[]).map((value) => {
      const monster = fieldsOf(value, 'each of "monsters"', fail)
      onlyFields(monster, ['kind', 'min', 'max'], fail, '"monsters": ')
      const which = monster.kind
      if (typeof which !== 'string' || !MONSTERS.some((def) => def.kind === which)) fail(`"monsters": there is no monster ${JSON.stringify(which)}`)
      const min = wholeField(monster, 'min', fail)
      const max = wholeField(monster, 'max', fail)
      if (min > max) fail(`"monsters": ${which}: "min" must not be more than "max"`)
      return { kind: which as string, min, max }
    })
    const rocks = fieldsOf(camp.rocks, '"rocks"', fail)
    onlyFields(rocks, ['kind', 'count'], fail, '"rocks": ')
    const rock = rocks.kind as CampRock
    if (!CAMP_ROCK_KINDS.includes(rock)) fail(`"rocks": "kind" must be one of ${CAMP_ROCK_KINDS.join(', ')}`)
    const count = wholeField(rocks, 'count', fail)
    if (count > CAMP_ROCK_SPOTS) fail(`"rocks": at most ${CAMP_ROCK_SPOTS}`)
    camps[kind] = {
      monsters,
      respawn: Math.round(numberField(camp, 'respawnSeconds', fail) * TPS),
      patrolRadius: numberField(camp, 'patrolRadius', fail, 1),
      rocks: { kind: rock, count },
    }
  }
  return camps
}
