import monstersData from '../../../data/monsters.json' with { type: 'json' }
import { failIn, fieldsOf, numberField, onlyFields, secondsField, speedField, textField, tilesField, wholeField, type Fail, type Fields } from './data-check.ts'
import { SUB, TPS } from './constants.ts'
import { itemFromKey, type ItemId } from './items.ts'

// The monsters, from data/monsters.json: the skeletons that keep the mountains' camps and guard the dungeon, the
// frost lich and what it calls up, the goblins that keep the meadow's camps and the mummies the desert's tombs, and the bees (see bees.ts). They are not animals (they do not eat, breed or grow up: see animals.ts for those),
// and the server runs them in apps/server/src/monsters.ts, sending where they are with the players and what they are
// (kind, health, what they are doing) whenever that changes.
//
// In the file, for each kind:
// - `hp`, and `armor`: how much it takes off every hit on it (see damageAfterArmor; never all of it).
// - `speed`: how fast it goes after a player, in tiles a second (twice that going home); `size`: how big it is drawn,
//   in tiles; `halfSize`: how far it reaches from its middle to each side, in tiles, for walking into things;
//   `unclump`: how hard others of its kind push it away when they come closer than its `size` (see the server's
//   `unclump` in creatures.ts), in tiles a second, right on top of each other (less the further apart; 0: not at all).
// - `aggroRadius`: how close (in tiles) a player it can see must come for it to go for them; `leash`: how far from
//   where it keeps (its camp, its post) it chases a player before it gives up and goes back.
// - `boss`: fought in its own hall (see dungeons.ts), its health over the top of the screen; never knocked back.
// - `attack`, by its `kind`:
//   - "blade" (a skeleton's sword), two attacks, each winding up first (shown on the ground, and by how it holds its
//     sword, so it can be got out of the way of), during which it cannot be knocked back; after either it stands for
//     `recover` seconds, and waits `cooldown` more before it attacks again:
//     - `swing`: close in (within `reach` tiles), it raises its sword for `windup` seconds and swings it round, `arc`
//       degrees wide: everyone in that takes `damage` and is knocked back `knockback` tiles;
//     - `charge`: from further off (between `near` and `from` tiles), every `cooldown` seconds at most, it crouches with
//       its sword out for `windup` seconds, aiming where the player was `lead` seconds before (so one who keeps moving
//       is not where it goes), then dashes `distance` tiles that way at `speed` tiles a second, straight through
//       anyone in its way: each takes `damage` and is knocked back `knockback` tiles. It charges only `chance` of
//       the times it could (0 to 1, 1 if not given); otherwise it closes in to swing, and thinks again after `cooldown`.
//   - "bow": it comes within `range` tiles of the player where it has a clear shot, aims for `aim` seconds and looses
//     an arrow (`item`) at `speed` tiles a second for `damage`, which flies through other monsters; then it waits
//     `cooldown` seconds. It aims where the player was `lead` seconds before, so one who keeps moving is missed.
//   - "touch": it drifts after the nearest player and bursts against them for `damage`; it lasts `lifetime` seconds.
//   - "melee" (a mummy): it walks up to the player and hits them for `damage` once it is within `reach` tiles of them
//     (its size and theirs between), `windup` seconds after it starts (0: at once), every `cooldown` seconds,
//     knocking them back `knockback` tiles. With `slam`, now and then (every `cooldown` seconds of the slam's, the
//     first that long into a fight) it slams instead, once the player is within `ahead` and `radius` tiles of it:
//     its arms raised for `windup` seconds, the way to them fixed as it starts (nothing stops it), then brought down on
//     the ground `ahead` tiles in front of it, hurting everyone within `radius` tiles of there for `damage` and
//     knocking them back `knockback` tiles.
//   - "spear" (a goblin): close in (within `reach` and `lunge` tiles, its size and theirs between) it jabs, quick,
//     with little to warn of it, and nothing stopping it once it starts (no knockback or stun while it winds up):
//     `windup` seconds, then it lunges up to `lunge` tiles forward (not into the player) and everyone in a narrow
//     strip (JAB_WIDTH) `reach` tiles out from there the way it faces takes `damage` and is knocked back `knockback`
//     tiles; then `cooldown` seconds. Or it throws its spear (`throw`): each time it is ready to attack it picks
//     which, a throw `chance` of the time (0.3: three throws in ten) and a jab the rest, and sticks to it until it has
//     done it. A throw is from anywhere within `range` tiles where it can see the player: it draws back for `windup`
//     seconds, aiming where the player was `lead` seconds before, and throws a spear (`item`, drawn only: it keeps its
//     own) at `speed` tiles a second for `damage`; then `cooldown` seconds before its next attack.
//   - "twister" (a dust elemental): it comes within `range` of the player where it can see them, gathers itself for
//     `aim` seconds and looses a twister (`item`) at where they were `lead` seconds before, at `speed` tiles a second:
//     `width` tiles across, it goes through everything (it is wind), hurting each player it passes through once for
//     `damage`, and blows on `linger` seconds past where it was aimed before it dies away; then it waits `cooldown`.
//   - "lob" (a goblin shaman): within `range` of the player where it can see them, it raises its staff for `aim`
//     seconds and lobs a spell (`item`) up and over at where the player is (or was `lead` seconds before), which comes
//     down `base` seconds plus a second for every `speed` tiles away it is (so one close by can still be got out of
//     the way of), `peak` tiles up at the top of its arc, and bursts where it lands, hurting everyone within `radius`
//     tiles for `damage`; then it waits `cooldown` seconds.
//   - "sting" (a worker bee): it flies (over anything) after whoever angered its hive and stings them for `damage`
//     once it is on them, every `cooldown` seconds; its `leash` is how far from its hive it chases.
//   - "queen" (a queen bee): no attack; she flies off to find a new hive when hers is gone (see bees.ts).
//   - "spells": it casts (the frost lich: see the server's frost-lich.ts). Every `castEvery` seconds it begins a spell,
//     casting for `castTime` (the first `firstCast` seconds into the fight); a close one if more players are within
//     `closeRange` tiles than not, else a far one. Each spell's numbers (distances in tiles, times in seconds, angles in
//     degrees):
//     - `blizzard` (close): a whirl `radius` tiles round it for `duration`, hurting everyone in it `damage` every
//       `every` seconds, through any armour.
//     - `wisps` (close): `perPlayer` waves of frozen wisps over `over` seconds, each wave one for every player at once, on a ring
//       halfway out to the wall, never within `clear` tiles of a player nor `apart` of another wisp (see `frost-wisp`
//       for how fast they go and how hard they hit).
//     - `icicles` (far): one falls where each player stands and `extra` more within `spread` tiles of them, shown
//       `warning` seconds before they land, each hurting everyone within `radius` for `damage`.
//     - `shards` (far): `count` shards of ice fanned `arc` wide at each player, flying at `speed` tiles a second for
//       `duration`, each for `damage`.
//     - `summon`: `base` skeleton archers for one player, and `perExtraPlayer` more for each player after the first, round the edge of the hall, `chance` of the time once
//       those it called last are dead and it has cast `afterCasts` times since.
// - `drops`: what it drops when killed, `min` to `max` of each item.
// - `rewards` (a boss): what it leaves each player who hurt it when it is killed (even one who fell in the fight): one
//   of these items, picked at random for each, which only that player can pick up.
export type BladeSwing = { reach: number; arc: number; windup: number; damage: number; knockback: number }
export type BladeCharge = {
  from: number
  near: number
  windup: number
  lead: number
  distance: number
  speed: number
  width: number
  damage: number
  knockback: number
  cooldown: number
  // How likely it is to charge when it could (0 to 1): otherwise it closes in to swing instead, and does not think of
  // charging again for its `cooldown`.
  chance: number
}
// A mummy's slam (see "melee" above): units and ticks.
export type MeleeSlam = { windup: number; ahead: number; radius: number; damage: number; knockback: number; cooldown: number }
export type SpearThrow = { range: number; windup: number; lead: number; speed: number; damage: number; cooldown: number; chance: number; item: ItemId }
export type MonsterAttack =
  | { kind: 'blade'; swing: BladeSwing; charge: BladeCharge; recover: number; cooldown: number }
  | { kind: 'bow'; range: number; aim: number; lead: number; cooldown: number; speed: number; damage: number; item: ItemId }
  | { kind: 'touch'; damage: number; lifetime: number }
  | { kind: 'melee'; reach: number; windup: number; damage: number; cooldown: number; knockback: number; slam?: MeleeSlam }
  | { kind: 'spear'; reach: number; lunge: number; windup: number; damage: number; cooldown: number; knockback: number; throw: SpearThrow }
  | { kind: 'twister'; range: number; aim: number; lead: number; cooldown: number; speed: number; damage: number; width: number; linger: number; item: ItemId }
  | { kind: 'lob'; range: number; aim: number; lead: number; cooldown: number; base: number; speed: number; peak: number; radius: number; damage: number; item: ItemId }
  | { kind: 'sting'; damage: number; cooldown: number }
  | { kind: 'queen' }
  | ({ kind: 'spells' } & LichSpells)

// The frost lich's spells, in units, ticks and radians (see "spells" above).
export type LichSpells = {
  castEvery: number
  castTime: number
  firstCast: number
  closeRange: number
  blizzard: { radius: number; duration: number; every: number; damage: number }
  wisps: { perPlayer: number; over: number; clear: number; apart: number }
  icicles: { warning: number; radius: number; damage: number; extra: number; spread: number }
  shards: { count: number; arc: number; speed: number; duration: number; damage: number }
  summon: { chance: number; afterCasts: number; base: number; perExtraPlayer: number }
}

export type MonsterDef = {
  kind: string
  id: number
  name: string
  hp: number
  armor: number
  // Units a tick.
  speed: number
  size: number
  // Units a tick (see `unclump` above).
  unclump: number
  // Units.
  halfSize: number
  aggroRadius: number
  leash: number
  boss: boolean
  attack: MonsterAttack
  drops: ReadonlyArray<{ item: ItemId; min: number; max: number }>
  rewards: readonly ItemId[]
}

// What a monster is doing that the pages show: winding up a swing or a charge (and which way), dashing, aiming its bow
// or a spell (and which way), drawing back to jab or to throw a spear, raising its arms to slam (a mummy), or casting a spell (the frost lich: which one, see frost-lich.ts), for `ticks` from tick `at`
// (which also tells one such from the next).
export type MonsterAct =
  | { k: 'swing' | 'charge' | 'dash' | 'aim' | 'jab' | 'throw' | 'slam'; angle: number; ticks: number; at: number }
  | { k: 'cast'; spell: LichSpell; ticks: number; at: number }

// How hard a monster is to push about, against a player's PLAYER_MASS (see the server's bodies.ts; a boss never
// budges, and the page counts it as this many times heavier).
export const MONSTER_MASS = 1.2
export const BOSS_MASS = 1000

// The frost lich's spells (see the server's frost-lich.ts).
export type LichSpell = 'icicles' | 'shards' | 'blizzard' | 'wisps' | 'summon'

// What a monster near the player is, sent when it comes near and whenever that changes (its health out of `maxHp`, a
// boss's being more with more players fighting it).
// (`struck`: the tick of its last blow, a goblin's jab or a mummy's, for the pages to show where it landed.)
export type MonsterInfo = { id: number; kind: string; hp: number; maxHp: number; angry?: boolean; act?: MonsterAct; struck?: number }

// How wide a goblin's jab reaches across, in units (a spear's point: a narrow strip).
export const JAB_WIDTH = Math.round(0.5 * SUB)

// Where a monster is, in units, as it is sent with the players' positions: [id, x, y].
export type MonsterPosition = [number, number, number]

const MONSTER_FIELDS = ['id', 'name', 'hp', 'armor', 'speed', 'size', 'halfSize', 'unclump', 'aggroRadius', 'leash', 'boss', 'attack', 'drops', 'rewards']
// The fields of each kind of attack, besides `kind`.
const ATTACK_FIELDS: Readonly<Record<MonsterAttack['kind'], readonly string[]>> = {
  blade: ['swing', 'charge', 'recover', 'cooldown'],
  bow: ['range', 'aim', 'lead', 'cooldown', 'speed', 'damage', 'item'],
  touch: ['damage', 'lifetime'],
  melee: ['reach', 'windup', 'damage', 'cooldown', 'knockback', 'slam'],
  spear: ['reach', 'lunge', 'windup', 'damage', 'cooldown', 'knockback', 'throw'],
  lob: ['range', 'aim', 'lead', 'cooldown', 'base', 'speed', 'peak', 'radius', 'damage', 'item'],
  twister: ['range', 'aim', 'lead', 'cooldown', 'speed', 'damage', 'width', 'linger', 'item'],
  sting: ['damage', 'cooldown'],
  queen: [],
  spells: ['castEvery', 'castTime', 'firstCast', 'closeRange', 'blizzard', 'wisps', 'icicles', 'shards', 'summon'],
}

export const MONSTERS: readonly MonsterDef[] = parseMonsters(monstersData)
const BY_KIND = new Map(MONSTERS.map((def) => [def.kind, def]))

// The frost lich's spells (from its "attack" in monsters.json).
export const LICH_SPELLS: LichSpells = (() => {
  const attack = BY_KIND.get('frost-lich')?.attack
  if (attack?.kind !== 'spells') throw new Error('data/monsters.json needs a "frost-lich" whose attack is "spells".')
  return attack
})()

export function monsterDef(kind: string): MonsterDef {
  const def = BY_KIND.get(kind)
  if (!def) throw new Error(`There is no monster "${kind}".`)
  return def
}

function parseMonsters(data: unknown): MonsterDef[] {
  if (typeof data !== 'object' || data === null) throw new Error('data/monsters.json must be an object of monsters.')
  return Object.entries(data).map(([kind, entry]): MonsterDef => {
    const fail: Fail = failIn(`data/monsters.json, ${kind}`)
    const raw = fieldsOf(entry, 'it', fail)
    onlyFields(raw, MONSTER_FIELDS, fail)
    return {
      kind,
      id: wholeField(raw, 'id', fail, 1),
      name: textField(raw, 'name', fail),
      hp: numberField(raw, 'hp', fail, 1),
      armor: numberField(raw, 'armor', fail),
      speed: speedField(raw, 'speed', fail),
      size: numberField(raw, 'size', fail),
      unclump: speedField(raw, 'unclump', fail, 0),
      halfSize: tilesField(raw, 'halfSize', fail),
      aggroRadius: tilesField(raw, 'aggroRadius', fail),
      leash: tilesField(raw, 'leash', fail),
      boss: raw.boss === true,
      attack: attackOf(fieldsOf(raw.attack ?? {}, '"attack"', fail), fail),
      drops: ((raw.drops ?? []) as unknown[]).map((value) => {
        const drop = fieldsOf(value, 'a drop', fail)
        onlyFields(drop, ['item', 'min', 'max'], fail, '"drops": ')
        return { item: itemFromKey(drop.item, fail), min: numberField(drop, 'min', fail), max: numberField(drop, 'max', fail) }
      }),
      rewards: (() => {
        if (raw.rewards === undefined) return []
        if (raw.boss !== true || !Array.isArray(raw.rewards)) fail('"rewards" is a list of item keys, for a boss')
        return (raw.rewards as unknown[]).map((key) => itemFromKey(key, fail))
      })(),
    }
  })
}

function attackOf(a: Fields, fail: Fail): MonsterAttack {
  const kind = a.kind as MonsterAttack['kind']
  if (!Object.hasOwn(ATTACK_FIELDS, kind)) fail(`"attack.kind" must be one of ${Object.keys(ATTACK_FIELDS).join(', ')}`)
  onlyFields(a, ['kind', ...ATTACK_FIELDS[kind]], fail, '"attack": ')
  switch (kind) {
    case 'blade': {
      const swing = fieldsOf(a.swing, '"attack.swing"', fail)
      const charge = fieldsOf(a.charge, '"attack.charge"', fail)
      onlyFields(swing, ['reach', 'arc', 'windup', 'damage', 'knockback'], fail, '"attack.swing": ')
      onlyFields(charge, ['from', 'near', 'windup', 'lead', 'distance', 'speed', 'width', 'damage', 'knockback', 'cooldown', 'chance'], fail, '"attack.charge": ')
      return {
        kind,
        swing: {
          reach: tilesField(swing, 'reach', fail),
          arc: (numberField(swing, 'arc', fail) * Math.PI) / 180,
          windup: secondsField(swing, 'windup', fail),
          damage: numberField(swing, 'damage', fail, 1),
          knockback: tilesField(swing, 'knockback', fail),
        },
        charge: {
          from: tilesField(charge, 'from', fail),
          near: tilesField(charge, 'near', fail),
          windup: secondsField(charge, 'windup', fail),
          lead: Math.round(numberField(charge, 'lead', fail, 0) * TPS),
          distance: tilesField(charge, 'distance', fail),
          speed: speedField(charge, 'speed', fail),
          width: tilesField(charge, 'width', fail),
          damage: numberField(charge, 'damage', fail, 1),
          knockback: tilesField(charge, 'knockback', fail),
          cooldown: secondsField(charge, 'cooldown', fail),
          chance: Math.min(1, numberField(charge, 'chance', fail, 0, 1)),
        },
        recover: secondsField(a, 'recover', fail),
        cooldown: secondsField(a, 'cooldown', fail),
      }
    }
    case 'bow':
      return {
        kind,
        range: tilesField(a, 'range', fail),
        aim: secondsField(a, 'aim', fail),
        lead: Math.round(numberField(a, 'lead', fail, 0) * TPS),
        cooldown: secondsField(a, 'cooldown', fail),
        speed: speedField(a, 'speed', fail),
        damage: numberField(a, 'damage', fail, 1),
        item: itemFromKey(a.item ?? 'arrow', fail),
      }
    case 'touch':
      return { kind, damage: numberField(a, 'damage', fail, 1), lifetime: secondsField(a, 'lifetime', fail) }
    case 'melee':
      return {
        kind,
        reach: tilesField(a, 'reach', fail),
        windup: Math.round(numberField(a, 'windup', fail, 0, 0) * TPS),
        damage: numberField(a, 'damage', fail, 1),
        cooldown: secondsField(a, 'cooldown', fail),
        knockback: tilesField(a, 'knockback', fail, 0),
        ...(a.slam !== undefined ? { slam: slamOf(fieldsOf(a.slam, '"attack.slam"', fail), fail) } : {}),
      }
    case 'spear': {
      const thrown = fieldsOf(a.throw, '"attack.throw"', fail)
      onlyFields(thrown, ['range', 'windup', 'lead', 'speed', 'damage', 'cooldown', 'chance', 'item'], fail, '"attack.throw": ')
      return {
        kind,
        reach: tilesField(a, 'reach', fail),
        lunge: tilesField(a, 'lunge', fail, 0),
        windup: Math.round(numberField(a, 'windup', fail, 0, 0) * TPS),
        damage: numberField(a, 'damage', fail, 1),
        cooldown: secondsField(a, 'cooldown', fail),
        knockback: tilesField(a, 'knockback', fail, 0),
        throw: {
          range: tilesField(thrown, 'range', fail),
          windup: secondsField(thrown, 'windup', fail),
          lead: Math.round(numberField(thrown, 'lead', fail, 0) * TPS),
          speed: speedField(thrown, 'speed', fail),
          damage: numberField(thrown, 'damage', fail, 1),
          cooldown: secondsField(thrown, 'cooldown', fail),
          chance: Math.min(1, numberField(thrown, 'chance', fail, 0, 1)),
          item: itemFromKey(thrown.item, fail),
        },
      }
    }
    case 'twister':
      return {
        kind,
        range: tilesField(a, 'range', fail),
        aim: secondsField(a, 'aim', fail),
        lead: Math.round(numberField(a, 'lead', fail, 0, 0) * TPS),
        cooldown: secondsField(a, 'cooldown', fail),
        speed: speedField(a, 'speed', fail),
        damage: numberField(a, 'damage', fail, 1),
        width: tilesField(a, 'width', fail),
        linger: secondsField(a, 'linger', fail),
        item: itemFromKey(a.item, fail),
      }
    case 'lob':
      return {
        kind,
        range: tilesField(a, 'range', fail),
        aim: secondsField(a, 'aim', fail),
        lead: Math.round(numberField(a, 'lead', fail, 0, 0) * TPS),
        cooldown: secondsField(a, 'cooldown', fail),
        base: secondsField(a, 'base', fail),
        speed: speedField(a, 'speed', fail),
        peak: tilesField(a, 'peak', fail),
        radius: tilesField(a, 'radius', fail),
        damage: numberField(a, 'damage', fail, 1),
        item: itemFromKey(a.item, fail),
      }
    case 'sting':
      return { kind, damage: numberField(a, 'damage', fail, 1), cooldown: secondsField(a, 'cooldown', fail) }
    case 'queen':
      return { kind }
    case 'spells':
      return { kind, ...spellsOf(a, fail) }
  }
}

function spellsOf(a: Fields, fail: Fail): LichSpells {
  const part = (name: string, fields: readonly string[]): Fields => {
    const raw = fieldsOf(a[name], `"attack.${name}"`, fail)
    onlyFields(raw, fields, fail, `"attack.${name}": `)
    return raw
  }
  const blizzard = part('blizzard', ['radius', 'duration', 'every', 'damage'])
  const wisps = part('wisps', ['perPlayer', 'over', 'clear', 'apart'])
  const icicles = part('icicles', ['warning', 'radius', 'damage', 'extra', 'spread'])
  const shards = part('shards', ['count', 'arc', 'speed', 'duration', 'damage'])
  const summon = part('summon', ['chance', 'afterCasts', 'base', 'perExtraPlayer'])
  return {
    castEvery: secondsField(a, 'castEvery', fail),
    castTime: secondsField(a, 'castTime', fail),
    firstCast: secondsField(a, 'firstCast', fail),
    closeRange: tilesField(a, 'closeRange', fail),
    blizzard: {
      radius: tilesField(blizzard, 'radius', fail),
      duration: secondsField(blizzard, 'duration', fail),
      every: secondsField(blizzard, 'every', fail),
      damage: numberField(blizzard, 'damage', fail),
    },
    wisps: {
      perPlayer: wholeField(wisps, 'perPlayer', fail),
      over: secondsField(wisps, 'over', fail),
      clear: tilesField(wisps, 'clear', fail),
      apart: tilesField(wisps, 'apart', fail),
    },
    icicles: {
      warning: secondsField(icicles, 'warning', fail),
      radius: tilesField(icicles, 'radius', fail),
      damage: numberField(icicles, 'damage', fail),
      extra: wholeField(icicles, 'extra', fail),
      spread: tilesField(icicles, 'spread', fail),
    },
    shards: {
      count: wholeField(shards, 'count', fail, 1),
      arc: (numberField(shards, 'arc', fail) * Math.PI) / 180,
      speed: speedField(shards, 'speed', fail),
      duration: secondsField(shards, 'duration', fail),
      damage: numberField(shards, 'damage', fail),
    },
    summon: {
      chance: numberField(summon, 'chance', fail),
      afterCasts: wholeField(summon, 'afterCasts', fail),
      base: wholeField(summon, 'base', fail),
      perExtraPlayer: wholeField(summon, 'perExtraPlayer', fail),
    },
  }
}

function slamOf(slam: Fields, fail: Fail): MeleeSlam {
  onlyFields(slam, ['windup', 'ahead', 'radius', 'damage', 'knockback', 'cooldown'], fail, '"attack.slam": ')
  return {
    windup: secondsField(slam, 'windup', fail),
    ahead: tilesField(slam, 'ahead', fail, 0),
    radius: tilesField(slam, 'radius', fail),
    damage: numberField(slam, 'damage', fail, 1),
    knockback: tilesField(slam, 'knockback', fail, 0),
    cooldown: secondsField(slam, 'cooldown', fail),
  }
}
