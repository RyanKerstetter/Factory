import beesData from '../../../data/bees.json' with { type: 'json' }
import { failIn, fieldsOf, onlyFields, secondsField, wholeField } from './data-check.ts'

// The bees, from data/bees.json (the bees themselves, how hard they sting and how fast they fly, are "bee" and
// "queen-bee" in data/monsters.json). Each beehive, wild or a bee box, keeps a colony: a queen and its worker bees (see
// HiveEntity, and the server's bees.ts for what they do):
// - `workers`: how many worker bees a wild hive has.
// - Foraging: every `forageEverySeconds` a worker sets out for a sunflower within `forageRadius` tiles of its hive (with
//   none there, none sets out: no honey), gathers at it for `gatherSeconds`, and flies home with it: a hive's honey goes
//   up by one, to at most `honeyMost`. Each punch at a hive knocks one out as a honeycomb (cooked in a barrel, it is
//   honey: see "barrel" in stations.json).
// - A queen without a home (hers destroyed, or every worker of hers killed) looks for the nearest hive with no queen in
//   it within `searchRadius` tiles, and moves in, her workers after her.
// - Smoke: angry bees within `smokeRadius` tiles of a fire cooking leaves calm down.
// Everything a colony does goes on only where something is going on, as for the animals (near a player, or where a
// player has built: a bee box keeps working while its keeper is away).
export type BeeData = {
  workers: number
  // Tiles.
  forageRadius: number
  // Ticks.
  forageEvery: number
  gather: number
  honeyMost: number
  // Tiles.
  searchRadius: number
  smokeRadius: number
}

export const BEES: Readonly<BeeData> = parseBees(beesData)

function parseBees(data: unknown): BeeData {
  const fail = failIn('data/bees.json')
  const raw = fieldsOf(data, 'it', fail)
  onlyFields(raw, ['workers', 'forageRadius', 'forageEverySeconds', 'gatherSeconds', 'honeyMost', 'searchRadius', 'smokeRadius'], fail)
  const bees = {
    workers: wholeField(raw, 'workers', fail, 1),
    forageRadius: wholeField(raw, 'forageRadius', fail, 1),
    forageEvery: secondsField(raw, 'forageEverySeconds', fail),
    gather: secondsField(raw, 'gatherSeconds', fail),
    honeyMost: wholeField(raw, 'honeyMost', fail, 1),
    searchRadius: wholeField(raw, 'searchRadius', fail, 1),
    smokeRadius: wholeField(raw, 'smokeRadius', fail, 1),
  }
  return bees
}
