import {
  addItems,
  cloneInventory,
  DROP_THROW,
  moveBetween,
  plainLimit,
  slotLimitIn,
  type SlotLimit,
  BUILDINGS,
  checkBuild,
  checkPlace,
  countOf,
  craftIn,
  createEntity,
  cropIsGrown,
  cropOfSeed,
  dropToState,
  entityToState,
  BARREL_CAPACITY,
  CAMPFIRE_FUEL,
  floorDiv,
  bucketFor,
  liquidIn,
  LIQUID_NONE,
  withMachine,
  STATION_RECIPES,
  waterAt,
  workbenchCan,
  GATE_OPEN,
  GATE_SHUT,
  gateIsOpen,
  getCrop,
  getItem,
  getRecipe,
  GRASS_SEED_CHANCE,
  hashInts,
  hasInventory,
  resourceDamage,
  weaponIn,
  type Weapon,
  inventoryTotals,
  isBeltLike,
  isHittable,
  isNatural,
  isWithinReach,
  ITEMS,
  itemId,
  linkSpecsFor,
  linkToState,
  moveSlot,
  NO_ITEM,
  oreAt,
  PUNCH_COOLDOWN_TICKS,
  removeItems,
  roomFor,
  roomInBuilding,
  stationRecipe,
  SUB,
  takeFromSlot,
  toolIn,
  type BuildingKind,
  type Command,
  type Entity,
  type FactoryWorld,
  type Inventory,
  type IsSolid,
  type ItemId,
  type PlayerPosition,
  type Refusal,
  type ToolKind,
  type WorldEvent,
} from '../../../packages/shared/src/index.ts'
import type { Animals } from './animals.ts'
import type { Combat } from './combat.ts'

// What running a command needs from the game: the world as it is on the tick, who asked, and somewhere to write down
// what it changed. `emit` applies a world event to the server's world and logs it for the chunks' clients.
export type CommandContext = {
  world: FactoryWorld
  seed: number
  // The tick the command runs on.
  tick: number
  // Who asked, the last tick they punched on (for PUNCH_COOLDOWN_TICKS), and the work station they have open.
  player: { id: number; position: PlayerPosition; inventory: Inventory; lastPunchTick: number; using: number; attackReadyAt: number }
  // Where every player is, for whether a gate is open.
  players?: () => ReadonlyArray<PlayerPosition>
  // A work station has been started (it is watched, and stopped when nobody is at it).
  onWork?: (id: number) => void
  emit: (event: WorldEvent) => void
  nextEntityId: () => number
  nextLinkId: () => number
  // Where what a punch knocks loose goes: onto the ground round the plant (with these), or, without them, straight
  // into the puncher's inventory.
  drops?: { nextId: () => number; solid: IsSolid }
  // The animals, for the commands that act on them (the room's; tests of the factory alone go without).
  animals?: Animals
  // Attacks and what is in flight (the room's).
  combat?: Combat
}

export type CommandOutcome = { ok: true; moved?: number } | { ok: false; why: Refusal }

// What hitting things drops, and when. How many logs, acorns, berries, stone and flint are a hash of the seed and the
// plant or rock, so the same one always drops the same.
//
// - A tree: a bare-handed punch does not hurt it, but every STICK_EVERY punches knock one of its sticks loose, with a
//   leaf (it has TREE_STICKS, and grows them back slowly; see constants.ts). A knife does the same but strips bark
//   instead of a stick. Only an axe chops it, and when it falls it drops its logs, acorns and leaves and whatever
//   sticks are still on it.
// - A bush: every hit breaks it a little (an axe twice as much), dropping twine each time TWINE_EVERY of its hp has
//   gone, and berries when it is gone.
// - A rock: only a pickaxe breaks it, a little each hit, and when it is gone it drops stone and flint.
// - Grass: pulled up by hand, it gives a seed GRASS_SEED_CHANCE percent of the time; cut with a knife, it gives hay.
// - A garden plot with a grown crop gives the crop's produce and seeds (see crops.json), and stays, empty, unhurt; one
//   with a crop still growing gives the seed back; an empty one is taken down with an axe and given back.
// - Anything else a player put down (fences, gates, the stump, feed boxes) only comes down to an axe, and is given
//   back, with whatever was in it.
// - A sapling or berry sprout is dug back up as its acorn or berries.
export const STICK_EVERY = 6
export const TWINE_EVERY = 4

// What a hit drops: by item key and count, `stack` for a pile that lands as one (what was in a broken box).
export type Dropped = Array<[string, number] | [string, number, 'stack']>
export type Hit = { drops: Dropped } | { refused: Refusal }

// The item that puts a kind of building down (a fence item puts up a fence).
function itemPlacing(kind: BuildingKind): string | undefined {
  return ITEMS.find((item) => item.places === kind)?.key
}

// A hit on a plant, a rock or a building with a weapon (see `resourceDamage` in weapons.ts for how much it does).
export function hit(context: CommandContext, target: Entity, tool: ToolKind | undefined, weapon: Weapon): Hit {
  const roll = (salt: number, below: number): number => hashInts(context.seed, target.id, salt) % below
  // A roll that is different on every hit, for what can come of any one hit.
  const rollNow = (salt: number, below: number): number => hashInts(context.seed, target.id, context.tick, salt) % below
  const fell = (): void => context.emit({ t: 'remove', id: target.id })
  const damage = resourceDamage(target.kind, weapon, tool)
  switch (target.kind) {
    case 'sapling':
      fell()
      return { drops: [['acorn', 1]] }
    case 'sprout':
      fell()
      return { drops: [['berries', 1]] }
    case 'tree': {
      if (damage === 0) {
        if (target.sticks === 0) return { refused: 'bare' }
        const punches = target.punches + 1
        if (punches < STICK_EVERY) {
          context.emit({ t: 'sticks', id: target.id, sticks: target.sticks, punches })
          return { drops: [] }
        }
        context.emit({ t: 'sticks', id: target.id, sticks: target.sticks - 1, punches: 0 })
        return { drops: [[tool === 'knife' ? 'bark' : 'stick', 1], ['leaves', 1]] }
      }
      const hp = target.hp - damage
      if (hp > 0) {
        context.emit({ t: 'hp', id: target.id, hp })
        return { drops: [] }
      }
      const sticks = target.sticks
      fell()
      return { drops: [['log', 2 + roll(1, 3)], ['acorn', 1 + roll(2, 2)], ['stick', sticks], ['leaves', 2 + roll(9, 3)]] }
    }
    case 'bush': {
      const hp = target.hp - damage
      if (hp > 0) {
        // Twine for each multiple of TWINE_EVERY the bush's lost hp has passed with this hit. (Worked out before the
        // event, which changes `target` as it is applied.)
        const max = BUILDINGS.bush.maxHp
        const twine = Math.floor((max - hp) / TWINE_EVERY) - Math.floor((max - target.hp) / TWINE_EVERY)
        context.emit({ t: 'hp', id: target.id, hp })
        return { drops: [['twine', twine]] }
      }
      fell()
      return { drops: [['berries', 2 + roll(3, 1)]] }
    }
    case 'rock': {
      if (damage === 0) return { refused: 'needsPickaxe' }
      const hp = target.hp - damage
      if (hp > 0) {
        context.emit({ t: 'hp', id: target.id, hp })
        return { drops: [] }
      }
      fell()
      return { drops: [['stone', 2 + roll(4, 3)], ['flint', 1 + roll(5, 2)]] }
    }
    case 'loose':
      // Knocked loose by any hit.
      fell()
      return { drops: [[getItem(target.item).key, target.count]] }
    case 'grass':
      fell()
      if (tool === 'knife') return { drops: [['hay', 1]] }
      return { drops: rollNow(6, 100) < GRASS_SEED_CHANCE ? [['wheat-seed', 1]] : [] }
    case 'plot': {
      const crop = getCrop(target.crop)
      if (crop) {
        const grown = cropIsGrown(target)
        // A crop still growing is not pulled up bare-handed: it takes a tool.
        if (!grown && !tool) return { refused: 'unripe' }
        const emptied = entityToState(target)
        if (emptied.kind === 'plot') context.emit({ t: 'set', e: { ...emptied, crop: 0, growth: 0 } })
        const key = (id: ItemId): string => ITEMS.find((item) => item.id === id)!.key
        if (!grown) return { drops: [[key(crop.seed), 1]] }
        const produce = crop.produceMin + rollNow(7, crop.produceMax - crop.produceMin + 1)
        const seeds = crop.seedsMin + rollNow(8, crop.seedsMax - crop.seedsMin + 1)
        return { drops: [[key(crop.produce), produce], [key(crop.seed), seeds]] }
      }
      return breakStructure(context, target, damage)
    }
    default:
      // Anything a player put down (see `breakable` in buildings.ts): fences, gates, the stations, chests...
      return BUILDINGS[target.kind].breakable ? breakStructure(context, target, damage) : { refused: 'notPlant' }
  }
}

// A hit on something a player put down: without an axe it does nothing; with one it loses `damage`, and when it has
// none left it comes down and gives back the item that put it there and whatever was in it.
function breakStructure(context: CommandContext, target: Entity, damage: number): Hit {
  if (damage === 0) return { refused: 'needsAxe' }
  const hp = ('hp' in target ? target.hp : 1) - damage
  if (hp > 0) {
    context.emit({ t: 'hp', id: target.id, hp })
    return { drops: [] }
  }
  const drops: Dropped = []
  const item = itemPlacing(target.kind)
  if (item) drops.push([item, 1])
  if (hasInventory(target)) {
    for (const { item: id, count } of inventoryTotals(target.inv)) drops.push([ITEMS.find((def) => def.id === id)!.key, count, 'stack'])
  }
  context.emit({ t: 'remove', id: target.id })
  return { drops }
}

// How far from the middle of a plant's tile what it drops lands, in tiles.
const SCATTER_NEAR = 0.45
const SCATTER_FAR = 1.05
// How many spots are tried for each item before it is left where the last one fell, solid or not.
const SCATTER_TRIES = 8

// Drops `count` of an item round a point (in units), one item to a spot (or, with `stack`, all of them on one), each
// spot picked by a hash of the seed, `salt` (what dropped it), the tick and the item's number, at a random angle and
// distance, and clear of anything solid where it can be. Every copy gets the spots in the drop's world event, so only
// the server picks them. Gives how many were dropped.
export function scatterAt(
  context: Pick<CommandContext, 'seed' | 'tick' | 'emit'>,
  drops: { nextId: () => number; solid: IsSolid },
  middle: { x: number; y: number },
  salt: number,
  item: ItemId,
  count: number,
  stack = false,
): number {
  const middleTileX = floorDiv(middle.x, SUB)
  const middleTileY = floorDiv(middle.y, SUB)
  const spots = stack ? 1 : count
  for (let n = 0; n < spots; n++) {
    let x = middle.x
    let y = middle.y
    for (let attempt = 0; attempt < SCATTER_TRIES; attempt++) {
      const roll = (r: number): number => hashInts(context.seed, salt, context.tick, item, n, attempt, r) / 0x1_0000_0000
      const angle = roll(1) * Math.PI * 2
      const distance = (SCATTER_NEAR + roll(2) * (SCATTER_FAR - SCATTER_NEAR)) * SUB
      x = Math.round(middle.x + Math.cos(angle) * distance)
      y = Math.round(middle.y + Math.sin(angle) * distance)
      const tileX = floorDiv(x, SUB)
      const tileY = floorDiv(y, SUB)
      // The middle's own tile is fine (what was there is coming down, or the item is reachable beside it); another
      // solid one is not.
      if ((tileX === middleTileX && tileY === middleTileY) || !drops.solid(tileX, tileY)) break
    }
    context.emit({ t: 'drop+', d: dropToState({ id: drops.nextId(), item, count: stack ? count : 1, x, y, born: context.tick }) })
  }
  return count
}

// Hands what something dropped to the player: onto the ground round `middle`, or straight into the inventory where
// the game does not drop things on the ground. Gives how many.
export function giveDrops(context: CommandContext, middle: { x: number; y: number }, salt: number, drops: Dropped): number {
  let moved = 0
  for (const [key, count, stack] of drops) {
    if (count <= 0) continue
    if (context.drops) moved += scatterAt(context, context.drops, middle, salt, itemId(key), count, stack === 'stack')
    else moved += addItems(context.player.inventory, itemId(key), count)
  }
  return moved
}

// One side of a move between slots: the player's inventory (`id` 0), or a copy of a building's, handed back to the
// world as a `set` when the move is done (`commit`). A building has to be in reach and open (not a sealed barrel).
type SlotSide = { inv: Inventory; limit: SlotLimit; commit: () => void }
function slotSide(context: CommandContext, id: number): SlotSide | { why: Refusal } {
  const { player, world } = context
  if (id === 0) return { inv: player.inventory, limit: plainLimit(player.inventory), commit: () => {} }
  const entity = world.entity(id)
  if (!entity) return { why: 'missing' }
  if (!hasInventory(entity)) return { why: 'noInventory' }
  if (!isWithinReach(player.position, entity.x, entity.y)) return { why: 'reach' }
  if (entity.kind === 'barrel' && entity.sealed) return { why: 'sealed' }
  const inv = cloneInventory(entity.inv)
  const copy = { ...entity, inv } as Entity
  return {
    inv,
    limit: (index, item) => slotLimitIn(copy, index, item),
    commit: () => context.emit({ t: 'set', e: entityToState(copy) }),
  }
}

// Where something a player drops lands: DROP_THROW tiles off towards the point they aimed at, or nearer where that is
// solid, or at their feet.
function dropSpot(from: { x: number; y: number }, towards: { x: number; y: number }, solid: IsSolid): { x: number; y: number } {
  const dx = towards.x - from.x
  const dy = towards.y - from.y
  const length = Math.hypot(dx, dy) || 1
  for (const tiles of [DROP_THROW, DROP_THROW * 0.7, DROP_THROW * 0.4]) {
    const x = Math.round(from.x + (dx / length) * tiles * SUB)
    const y = Math.round(from.y + (dy / length) * tiles * SUB)
    if (!solid(floorDiv(x, SUB), floorDiv(y, SUB))) return { x, y }
  }
  return { x: from.x, y: from.y }
}

export function runCommand(context: CommandContext, command: Command): CommandOutcome {
  const { world, player } = context
  switch (command.k) {
    case 'build': {
      const why = checkBuild(world, context.seed, player.position, command.x, command.y, command.kind)
      if (why) return { ok: false, why }
      const entity = createEntity(
        context.nextEntityId(),
        command.kind,
        command.x,
        command.y,
        command.dir,
        oreAt(context.seed, command.x, command.y),
      )
      context.emit({ t: 'add', e: entityToState(entity) })
      const placed = world.entity(entity.id)!
      for (const spec of linkSpecsFor(placed, (x, y) => world.entityAt(x, y))) {
        context.emit({
          t: 'link+',
          l: linkToState({
            id: context.nextLinkId(),
            from: spec.from.id,
            to: spec.to.id,
            fromChunk: world.chunkOfEntity(spec.from.id)!,
            toChunk: world.chunkOfEntity(spec.to.id)!,
            entry: spec.entry,
            blocked: false,
          }),
        })
      }
      return { ok: true }
    }
    case 'remove': {
      const entity = world.entity(command.id)
      if (!entity) return { ok: false, why: 'missing' }
      if (isNatural(entity)) return { ok: false, why: 'natural' }
      if (!isWithinReach(player.position, entity.x, entity.y)) return { ok: false, why: 'reach' }
      // What it held goes to the player, as much as fits.
      let moved = 0
      if (isBeltLike(entity)) {
        for (const item of entity.lane) moved += addItems(player.inventory, item.item, 1)
      } else if (hasInventory(entity)) {
        for (const { item, count } of inventoryTotals(entity.inv)) moved += addItems(player.inventory, item, count)
      }
      for (const link of world.linksOf(entity.id)) context.emit({ t: 'link-', id: link.id })
      context.emit({ t: 'remove', id: entity.id })
      return { ok: true, moved }
    }
    case 'take':
    case 'put': {
      const entity = world.entity(command.id)
      if (!entity) return { ok: false, why: 'missing' }
      if (!hasInventory(entity)) return { ok: false, why: 'noInventory' }
      if (!isWithinReach(player.position, entity.x, entity.y)) return { ok: false, why: 'reach' }
      if (command.k === 'put' && !BUILDINGS[entity.kind].acceptsDeposits) return { ok: false, why: 'noDeposit' }
      if (entity.kind === 'barrel' && entity.sealed) return { ok: false, why: 'sealed' }
      const from = command.k === 'take' ? entity.inv : player.inventory
      const items: ItemId[] = command.item === NO_ITEM ? inventoryTotals(from).map((total) => total.item) : [command.item]
      let left = command.max
      let moved = 0
      for (const item of items) {
        if (left === 0) break
        const room = command.k === 'take' ? roomFor(player.inventory, item, left) : roomInBuilding(entity, item, left)
        const count = Math.min(left, countOf(from, item), room)
        if (count <= 0) continue
        if (command.k === 'take') {
          context.emit({ t: 'inv', id: entity.id, item, delta: -count })
          addItems(player.inventory, item, count)
        } else {
          removeItems(player.inventory, item, count)
          context.emit({ t: 'inv', id: entity.id, item, delta: count })
        }
        left -= count
        moved += count
      }
      return moved > 0 ? { ok: true, moved } : { ok: false, why: 'nothing' }
    }
    case 'move':
      return moveSlot(player.inventory, command.from, command.to) ? { ok: true } : { ok: false, why: 'nothing' }
    case 'slot': {
      const from = slotSide(context, command.from.id)
      if ('why' in from) return { ok: false, why: from.why }
      const to = command.to.id === command.from.id ? from : slotSide(context, command.to.id)
      if ('why' in to) return { ok: false, why: to.why }
      if (!moveBetween(from.inv, command.from.i, from.limit, to.inv, command.to.i, to.limit, command.count)) return { ok: false, why: 'nothing' }
      from.commit()
      if (to !== from) to.commit()
      return { ok: true }
    }
    case 'drop': {
      if (!context.drops) return { ok: false, why: 'nothing' }
      const from = slotSide(context, command.from.id)
      if ('why' in from) return { ok: false, why: from.why }
      const slot = from.inv.slots[command.from.i]
      if (!slot || slot.count === 0) return { ok: false, why: 'nothing' }
      const item = slot.item
      const count = takeFromSlot(from.inv, command.from.i, command.count)
      from.commit()
      const spot = dropSpot(player.position, command, context.drops.solid)
      context.emit({ t: 'drop+', d: dropToState({ id: context.drops.nextId(), item, count, x: spot.x, y: spot.y, born: context.tick }) })
      return { ok: true }
    }
    case 'punch': {
      const entity = world.entity(command.id)
      if (!entity) return { ok: false, why: 'missing' }
      if (!isHittable(entity)) return { ok: false, why: 'notPlant' }
      if (!isWithinReach(player.position, entity.x, entity.y)) return { ok: false, why: 'reach' }
      // Picking crops is not a punch: a whole field can be harvested as fast as the mouse goes over it.
      const harvest = entity.kind === 'plot' && entity.crop !== 0
      if (!harvest && context.tick - player.lastPunchTick < PUNCH_COOLDOWN_TICKS) return { ok: false, why: 'tooSoon' }
      const result = hit(context, entity, toolIn(player.inventory, command.slot), weaponIn(player.inventory, command.slot))
      if ('refused' in result) return { ok: false, why: result.refused }
      if (!harvest) player.lastPunchTick = context.tick
      const middle = { x: entity.x * SUB + SUB / 2, y: entity.y * SUB + SUB / 2 }
      return { ok: true, moved: giveDrops(context, middle, entity.id, result.drops) }
    }
    case 'craft': {
      const recipe = getRecipe(command.recipe)
      if (!recipe) return { ok: false, why: 'noRecipe' }
      const why = craftIn(player.inventory, recipe)
      return why ? { ok: false, why } : { ok: true, moved: recipe.count }
    }
    case 'work': {
      const entity = world.entity(command.id)
      if (!entity) return { ok: false, why: 'missing' }
      if (entity.kind !== 'stump' && entity.kind !== 'workbench') return { ok: false, why: 'noInventory' }
      if (!isWithinReach(player.position, entity.x, entity.y)) return { ok: false, why: 'reach' }
      if (entity.kind === 'stump') {
        if (!stationRecipe(entity.kind, entity.inv)) return { ok: false, why: 'noWork' }
        const state = entityToState(entity)
        if (state.kind === 'stump' && state.active === 0) context.emit({ t: 'set', e: { ...state, active: 1 } })
      } else {
        const recipe = STATION_RECIPES.workbench[command.recipe ?? -1]
        if (!recipe) return { ok: false, why: 'noRecipe' }
        // A recipe that needs a tool (a knife for a spear) needs it on the player, and does not use it up.
        if (recipe.tool && !player.inventory.slots.some((slot) => slot.count > 0 && getItem(slot.item).tool === recipe.tool)) {
          return { ok: false, why: 'needsTool' }
        }
        if (!workbenchCan(entity.inv, recipe)) return { ok: false, why: 'noWork' }
        // The same recipe again keeps how far it had got; another starts afresh.
        const same = entity.recipe === recipe.index + 1
        context.emit({
          t: 'set',
          e: withMachine(entity, { recipe: recipe.index + 1, repeat: command.repeat ? 1 : 0, progress: same ? entity.progress : 0, active: 1 }),
        })
      }
      // Pressing Craft is being at it.
      player.using = entity.id
      context.onWork?.(entity.id)
      return { ok: true }
    }
    case 'machine': {
      const entity = world.entity(command.id)
      if (!entity) return { ok: false, why: 'missing' }
      if (!isWithinReach(player.position, entity.x, entity.y)) return { ok: false, why: 'reach' }
      if (entity.kind === 'campfire' && (command.action === 'light' || command.action === 'douse')) {
        const fuel = entity.inv.slots[CAMPFIRE_FUEL]
        if (command.action === 'light' && (fuel.count === 0 || !getItem(fuel.item).fuel) && entity.burn <= 0) return { ok: false, why: 'noFuel' }
        const lit = command.action === 'light' ? 1 : 0
        context.emit({ t: 'set', e: withMachine(entity, { lit, burn: lit ? entity.burn : 0, target: lit ? entity.target : 0 }) })
        return { ok: true }
      }
      if (entity.kind === 'barrel' && (command.action === 'seal' || command.action === 'unseal')) {
        context.emit({ t: 'set', e: withMachine(entity, { sealed: command.action === 'seal' ? 1 : 0 }) })
        return { ok: true }
      }
      return { ok: false, why: 'nothing' }
    }
    case 'apply':
      return apply(context, command.x, command.y, command.slot)
    case 'use':
      player.using = command.id
      return { ok: true }
    case 'toggle': {
      const gate = world.entity(command.id)
      if (!gate) return { ok: false, why: 'missing' }
      if (gate.kind !== 'gate') return { ok: false, why: 'nothing' }
      if (!isWithinReach(player.position, gate.x, gate.y)) return { ok: false, why: 'reach' }
      // Shut it if it looks open now, open it if it looks shut.
      const open = gateIsOpen(gate, context.players?.() ?? [player.position])
      context.emit({ t: 'set', e: { id: gate.id, kind: 'gate', x: gate.x, y: gate.y, dir: gate.dir, hp: gate.hp, mode: open ? GATE_SHUT : GATE_OPEN } })
      return { ok: true }
    }
    case 'place': {
      const check = checkPlace(world, player.position, player.inventory, command.slot, command.x, command.y, context.seed)
      if (!check.ok) return check
      const held = player.inventory.slots[command.slot]
      if ('sow' in check) {
        const plot = world.entity(check.sow)
        const crop = cropOfSeed(held.item)
        if (!plot || plot.kind !== 'plot' || !crop) return { ok: false, why: 'notPlaceable' }
        takeFromSlot(player.inventory, command.slot, 1)
        const sown = entityToState(plot)
        if (sown.kind === 'plot') context.emit({ t: 'set', e: { ...sown, crop: crop.id, growth: 0 } })
        return { ok: true }
      }
      takeFromSlot(player.inventory, command.slot, 1)
      context.emit({ t: 'add', e: entityToState(createEntity(context.nextEntityId(), check.kind, command.x, command.y, 0, NO_ITEM)) })
      return { ok: true }
    }
    case 'attack':
      if (!context.combat) return { ok: false, why: 'nothing' }
      return context.combat.attack(context, command)
    case 'strike':
    case 'interact':
      if (!context.animals) return { ok: false, why: 'animalGone' }
      return command.k === 'strike' ? context.animals.strike(context, command.animal, command.slot) : context.animals.interact(context, command.animal, command.slot)
  }
}

// Using what is in a slot on a tile (a right click with it):
// - an empty bucket at a pond fills with water; at a barrel, with a bucket of what the barrel holds;
// - a full bucket empties into a barrel (of the same liquid, or empty, with room); a bucket of water waters a plot.
// A sealed barrel can be neither filled nor emptied.
function apply(context: CommandContext, x: number, y: number, slot: number): CommandOutcome {
  const { world, player } = context
  const held = player.inventory.slots[slot]
  if (!held || held.count === 0) return { ok: false, why: 'nothing' }
  if (!isWithinReach(player.position, x, y)) return { ok: false, why: 'reach' }
  const item = getItem(held.item)
  const target = world.entityAt(x, y)
  const swap = (key: string): void => {
    held.item = itemId(key)
    held.count = 1
  }
  // Emptying what is held: a bucket (a tool) is left empty; anything else that holds a liquid (milk) is used up.
  const emptied = (): void => {
    if (item.category === 'tool') swap('bucket')
    else takeFromSlot(player.inventory, slot, 1)
  }
  if (target?.kind === 'barrel') {
    if (!item.bucket) return { ok: false, why: 'cannotApply' }
    if (target.sealed) return { ok: false, why: 'sealed' }
    const set = (liquid: number, amount: number): void =>
      context.emit({ t: 'set', e: withMachine(target, { liquid: amount === 0 ? LIQUID_NONE : liquid, amount }) })
    if (item.bucket === 'empty') {
      if (target.amount === 0) return { ok: false, why: 'barrelEmpty' }
      const filled = bucketFor(target.liquid)
      // A liquid kept in a bucket fills it; one that is its own item (milk) comes out as that, leaving the bucket.
      if (getItem(filled).category === 'tool') swap(getItem(filled).key)
      else if (addItems(player.inventory, filled, 1) === 0) return { ok: false, why: 'inventoryFull' }
      set(target.liquid, target.amount - 1)
      return { ok: true }
    }
    const liquid = liquidIn(held.item)
    if ((target.liquid !== LIQUID_NONE && target.liquid !== liquid) || target.amount >= BARREL_CAPACITY) return { ok: false, why: 'barrelFull' }
    emptied()
    set(liquid, target.amount + 1)
    return { ok: true }
  }
  if (target?.kind === 'plot' && item.bucket === 'water') {
    const state = entityToState(target)
    if (state.kind !== 'plot') return { ok: false, why: 'cannotApply' }
    swap('bucket')
    context.emit({ t: 'set', e: { ...state, water: 100 } })
    return { ok: true }
  }
  if (!target && item.bucket === 'empty' && waterAt(context.seed, x, y)) {
    swap('water-bucket')
    return { ok: true }
  }
  // A bucket of anything is emptied out on bare ground.
  if (!target && item.bucket && item.bucket !== 'empty' && !waterAt(context.seed, x, y)) {
    emptied()
    return { ok: true }
  }
  return { ok: false, why: 'cannotApply' }
}
