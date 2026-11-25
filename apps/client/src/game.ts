import {
  airTemperatureAt,
  animalDef,
  ARMOR_SLOT,
  ATTACK_SLOW_TICKS,
  BARREL_CAPACITY,
  barrelPlan,
  BODY_NORMAL,
  BOSS_MASS,
  BUILDINGS,
  canAfford,
  checkPlace,
  CHUNK_SIZE,
  chunkCoords,
  coldSpeedPercent,
  countOf,
  countMatching,
  type Match,
  oneKindEach,
  DIR_X,
  DIR_Y,
  distanceToTileSquared,
  DUNGEON_TRAPS,
  dungeonCorner,
  dungeonSlotAt,
  EAT_COOLDOWN_TICKS,
  fenceMask,
  fitsIn,
  FOOD_SLOT,
  frostOf,
  gateIsOpen,
  getCrop,
  getItem,
  getRecipe,
  growthNeeded,
  hasInventory,
  HOTBAR_SLOTS,
  hpOf,
  inventoryTotals,
  isBeltLike,
  isFilled,
  isHittable,
  isInDungeons,
  isStation,
  isRaftItem,
  itemId,
  isWithinReach,
  itemByKey,
  KEY_SLOW,
  KEY_CHARGE,
  CHARGE_TICKS,
  HURT_GRACE_TICKS,
  lungeOf,
  withPush,
  type AttackArea,
  LIQUIDS,
  ALTAR_GLOW_TICKS,
  ALTAR_RECIPES,
  altarBusy,
  altarRoomFor,
  altarSurroundings,
  offeringsOf,
  planRitual,
  ritualFraction,
  MONSTER_MASS,
  monsterDef,
  NO_ITEM,
  opposite,
  PLAYER_HALF_SIZE,
  PLAYER_MASS,
  PLAYER_MAX_HEALTH,
  PLAYER_REACH,
  playerInventory as playerInventoryOf,
  RACK_INPUT,
  RACK_OUTPUT,
  rackRefusal,
  RECIPES,
  PLAYER_CRAFT_SPEED,
  raftOnTile,
  raftFits,
  onRaft,
  overlapsSolid,
  type RaftPose,
  toRaft,
  REFUSALS,
  roomFor,
  isFoggedAt,
  isSmoking,
  rotateCCW,
  rotateCW,
  slowIn,
  snowAt,
  solidIn,
  STATION_LAYOUT,
  STATION_RECIPES,
  stationHas,
  stationTool,
  SUB,
  TICK_MS,
  WARP_TICKS,
  waystoneTitle,
  type WaystoneEntity,
  type WaystoneInfo,
  tileOfUnits,
  tilesHitBy,
  TPS,
  WATER_FALL_EVERY,
  waterAt,
  weaponIn,
  weaponOf,
  type AnimalInfo,
  type ChunkSnapshot,
  type Command,
  type Entity,
  type Inventory,
  type ItemId,
  type Link,
  type MonsterInfo,
  type TerrainSettings,
  type Weapon,
  type Refusal,
} from '../../../packages/shared/src/index.ts'
import { animalSound, footstep, monsterSound, Sounds, surfaceAt, type SoundId } from './audio/sounds.ts'
import { DEFAULT_ZOOM, easeZoom, zoomAfterWheel } from './camera.ts'
import { connect, connectLocal, type ConnectionHandlers } from './connection.ts'
import { diffChunkSnapshots } from './desync-diff.ts'
import { FactoryMirror } from './factory-mirror.ts'
import { HeldKeys, isMovementAction, isTypingIn } from './input.ts'
import { attackArea, attackDurationMs, attackPose, attackSwish, chargePose } from './attack-shapes.ts'
import { CreatureTracks } from './creature-tracks.ts'
import { RaftTracks } from './raft-tracks.ts'
import { blizzardMarks, castMarks, hitboxMarks, icicleMark } from './ground-marks.ts'
import { LocalPlayer } from './local-player.ts'
import { machineProgress, machineView } from './machine-views.ts'
import { Prediction } from './prediction.ts'
import { REMOTE_DELAY_TICKS, RemotePlayers } from './remote-players.ts'
import type {
  AnimalView,
  AttackView,
  GroundMark,
  BuildingView,
  DebugView,
  DropView,
  GhostView,
  MonsterView,
  OverlayView,
  PlayerView,
  PlayerPose,
  RitualView,
  TrapView,
  WarpFlashView,
  WarpView,
  WorldFrame,
} from './render3d/frame.ts'
import { drawnAt, offeringWindows } from './ritual-timeline.ts'
import { CROP_GROWTH_STAGES } from './render3d/models.ts'
import { createThreeView } from './render3d/three-view.ts'
import { FrameTimer } from './frame-timer.ts'
import { HOTBAR_ACTIONS, Settings } from './settings.ts'
import { createDebugOverlay } from './ui/debug-overlay.ts'
import { copyText, element } from './ui/dom.ts'
import { createHotbarView } from './ui/hotbar-view.ts'
import { createHudView } from './ui/hud-view.ts'
import { createMapView } from './ui/map-view.ts'
import { createSnowstorm } from './ui/snowstorm-view.ts'
import { createFrostView } from './ui/frost-view.ts'
import { createInventoryPanels, type MachineView, type PanelsView } from './ui/inventory-view.ts'
import { createPauseMenu } from './ui/pause-menu-view.ts'
import type { BookEntry } from './ui/recipe-book.ts'
import { createTooltips } from './ui/tooltip.ts'
import { createWaystonePanel, type WaystoneView } from './ui/waystone-view.ts'

export type GameOptions = {
  container: HTMLElement
  code: string
  name: string
  // Singleplayer: the world is run in this browser (see connectLocal), from this seed and land, and nobody else can
  // join.
  local?: { seed: number; terrain?: TerrainSettings }
  // The player is going back to the menu: they chose to, or the game was lost. The message says why, if anything.
  onLeave: (message?: string, isError?: boolean) => void
}

// How often the page's own elements are brought up to date, and the debug text.
const UI_MS = 100
// How far past the newest position the server sent an animal on the player's rope is reckoned to be (ticks), for its
// pull (see `local.tethers`).
const TETHER_AHEAD = 3
const DEBUG_MS = 250
// How long to wait for the server's welcome before giving up.
const CONNECT_TIMEOUT_MS = 12_000
// How far the player walks between footsteps, in units, and between rustles while pushing through a bush.
const STEP_DISTANCE = 1.75 * SUB
const RUSTLE_DISTANCE = 1.1 * SUB
// A point in units, in tiles (where something is drawn, or a sound comes from).
// How long the flash of someone going from or arriving at a waystone lasts (ms), and how long past the end of a warp
// this page waits to hear of it before letting the player move again anyway.
// A notch of the mouse wheel, in pixels (about what browsers call one): a hotbar slot.
const WHEEL_NOTCH = 100
const WARP_FLASH_MS = 900
const WARP_GRACE_MS = 2000

// Which way something is (tiles across and down) as a compass point.
function compassWay(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return ''
  const points = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE']
  return points[(Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) + 8) % 8]
}

function tilesOf(spot: { x: number; y: number }): { x: number; y: number } {
  return { x: spot.x / SUB, y: spot.y / SUB }
}

// How long a punched plant sways (and a player hit is lit up), a spark lasts, and a damage number rises.
const SHAKE_MS = 260
// How fast a player who was just hurt flickers (each half of a blink).
const BLINK_MS = 70
// How long a monster's swing or dash is drawn for once it lands, and how often a dashing one kicks up dust.
const MONSTER_SWISH_MS = 360
const DUST_EVERY_MS = 45
const SPARK_MS = 280
const NUMBER_MS = 900
// How far past reach (as a share of it) the player can walk from what they have open before it closes.
const CLOSE_AWAY = 1
// Refusals answered with a sound only.
const QUIET_REFUSALS: ReadonlySet<string> = new Set(['busy', 'noWork', 'needsTool', 'noRecipe', 'notFood', 'fullHealth', 'eatTooSoon'])
// How long a command can go unanswered before the player is told something is wrong.
const STALL_WARN_MS = 6_000
// A spike trap's spikes come up over TRAP_RISE_MS, stay up until TRAP_UP_MS (the server's TRAP_ACTIVE), and go back
// down over TRAP_DOWN_MS.
const TRAP_RISE_MS = 70
const TRAP_UP_MS = 1_000
const TRAP_DOWN_MS = 220

// How many hp each notch on a boss's health bar marks off.
const BOSS_NOTCH = 50

// The frost lich's icicles: how long one takes to fall (as the server's ICICLE_TICKS), and how wide a ring shows where
// it will land (its reach, in tiles).
const ICICLE = itemByKey('icicle')?.id ?? -1
const ICICLE_FALL_MS = 1200
const ICICLE_RING = 0.9
// How heavy the snow is inside the ice crypt: a few flakes drifting down, out of the wind.
const DUNGEON_FLURRY = 0.12
// How far round the player the debug view shows what is solid (tiles), and the colours of the bodies' hitboxes.
const HITBOX_REACH = 12
const HITBOX_PLAYER = 0xffd25a
const HITBOX_ANIMAL = 0x5ab0ff
const HITBOX_MONSTER = 0xff5a5a

// Runs one game: the connection, the page's copy of the world, the player's input, and each frame. It works out
// what to draw and hands it to the 3D view (render3d/) and the page's elements (ui/); it draws nothing itself.
export async function startGame({ container, code, name, onLeave, local: solo }: GameOptions): Promise<() => void> {
  const root = element('div', 'game')
  const stage = element('div', 'game-stage')
  const hudRoot = element('div', 'game-hud')
  root.append(stage, hudRoot)
  container.replaceChildren(root)

  const settings = new Settings()
  const view = await createThreeView(stage)

  let disposed = false
  let welcomed = false
  let placed = false
  let lastStateTick = -1
  const roster = new Map<number, string>()
  // Whether the page has heard who is in the game yet (so those already here are not announced as joining).
  let rosterHeard = false
  let playerInventory: Inventory = playerInventoryOf()
  // The hotbar slot picked, 0 to HOTBAR_SLOTS - 1: what a right click puts down.
  let selectedSlot = 0
  // The slot that was picked before bare hands (Q), to go back to.
  let slotBeforeHand = 0
  let openBuilding: number | undefined
  let inventoryOpen = false
  // The waystone whose panel is open; every waystone in the world (the server says); the players travelling by one
  // (page time: when it started charging and when they go), and the flashes where they went and arrived.
  let openWaystone: number | undefined
  let waystoneList: WaystoneInfo[] = []
  const warps = new Map<number, { from: { x: number; y: number }; to: { x: number; y: number }; at: number; until: number }>()
  const warpFlashes: Array<{ x: number; y: number; at: number; arriving: boolean; salt: number; stone: { x: number; y: number } }> = []
  // Until when (page time) this player is held still: from picking a waystone to go to until the server says they
  // have arrived (or it was called off, or turned down). The warp command asked for, and to which waystone.
  let heldUntil = 0
  let warpSeq: number | undefined
  let warpTo: number | undefined
  let debug = false
  // The zoom drawn, easing towards where the wheel has put it, and when it last eased.
  let zoom = DEFAULT_ZOOM
  let zoomTarget = DEFAULT_ZOOM
  let zoomedAt = performance.now()
  const local = new LocalPlayer()
  const remotes = new RemotePlayers()
  const prediction = new Prediction()
  const keys = new HeldKeys(settings)
  const sounds = new Sounds()
  sounds.setLevels({ ...settings.volumes, muted: settings.muted })
  // Which way each other player faces, kept while they stand still.
  const remoteFacing = new Map<number, number>()
  // Where each other player aboard a raft was on it when last drawn (to tell which way they walk on it).
  const remoteOnRaft = new Map<number, { raft: number; x: number; y: number }>()
  // When each plant was last punched, by ID, while it still sways.
  const shakes = new Map<number, number>()
  // The animals and the monsters near the player (see creature-tracks.ts), and the animal under the mouse, if any. When
  // the page first heard of what each monster is doing (to draw how far through it is).
  const animalTracks = new CreatureTracks<AnimalInfo>()
  // The rafts near the player, and who is aboard them.
  const raftTracks = new RaftTracks()
  const monsterTracks = new CreatureTracks<MonsterInfo>()
  let hoveredAnimal: number | undefined
  const actHeard = new Map<number, { at: number; heardAt: number }>()
  // The frost lich's blizzards blowing (in tiles, from and until when), and the spike traps set off (by copy and trap,
  // when their spikes come up, and whether that has been heard).
  const blizzards: Array<{ x: number; y: number; radius: number; at: number; until: number }> = []
  const trapsSetOff = new Map<string, { slot: number; trap: number; upAt: number; sounded: boolean }>()
  // What is in flight (arrows, stones, spears), and the player's health.
  const shotTracks = new RemotePlayers()
  const shotItems = new Map<number, number>()
  // The tick each one stopped on (it is drawn flying until then, and then not at all).
  const shotStopped = new Map<number, number>()
  // When each icicle was first seen (it is drawn falling from then), and those that have shattered.
  const shotSeen = new Map<number, number>()
  const shattered = new Set<number>()
  let health = PLAYER_MAX_HEALTH
  // Whether the player has truesight (they ate a truesight flesh): until then the far islands are under fog, and
  // nothing on them is drawn or can be walked onto. And whether they have just eaten one (to say the fog lifts).
  let truesight = false
  let expectingSight = false
  // How warm the player's body is, in tenths of a °C, as the server last said (see cold.ts).
  let bodyTenths = BODY_NORMAL * 10
  // The world's name (the server says it when the page joins).
  let worldName = solo ? 'Singleplayer' : code
  const localDumps = new Map<string, ChunkSnapshot>()

  // ---- the page's elements

  const inviteLink = (): string => `${window.location.origin}${window.location.pathname}?game=${code}`
  const copyInvite = async (): Promise<void> => {
    if (solo) {
      hud.toast('This is a singleplayer world, run in this browser: nobody else can join it.')
      return
    }
    hud.toast((await copyText(inviteLink())) ? 'Invite link copied.' : `Invite others with the code ${code}.`)
  }
  const hud = createHudView(hudRoot, () => void copyInvite())
  const map = createMapView(hudRoot)
  // The temperature where the player is, and the snow blowing over the view in the cold.
  const snow = createSnowstorm(stage)
  const frost = createFrostView(stage)
  // The health of a boss being fought, across the top of the screen.
  const bossFill = element('div', 'boss-fill')
  const bossName = element('span', 'boss-name')
  // Its health as a number over the bar, and the bar marked off every BOSS_NOTCH hp.
  const bossHp = element('span', 'boss-hp')
  const bossNotches = element('div', 'boss-notches')
  const bossBar = element('div', 'boss-bar', bossName, element('div', 'boss-track', bossFill, bossNotches, bossHp))
  let bossNotchesFor = 0
  bossBar.hidden = true
  hudRoot.append(bossBar)
  hud.setConnecting(solo ? 'Making the world…' : `Connecting to ${code}…`)
  const hotbar = createHotbarView(hudRoot, (slot) => {
    selectedSlot = slot
  })
  const closePanels = (): void => {
    inventoryOpen = false
    openBuilding = undefined
    openWaystone = undefined
  }
  const waystonePanel = createWaystonePanel(hudRoot, {
    rename: (id, waystoneName) => send({ k: 'rename', id, name: waystoneName }),
    travel: (from, to) => travel(from, to),
    close: () => closePanels(),
  })
  const panels = createInventoryPanels(hudRoot, {
    take: (id, item, max) => {
      send({ k: 'take', id, item, max })
      sounds.play('move')
    },
    put: (id, item, max, slot) => {
      send({ k: 'put', id, item, max, ...(slot !== undefined ? { slot } : {}) })
      sounds.play('move')
    },
    chest: (id, action) => {
      send({ k: 'chest', id, action })
      sounds.play('pickup')
    },
    rename: (id, chestName) => send({ k: 'rename', id, name: chestName }),
    slot: (from, to, count) => {
      send({ k: 'slot', from, to, count })
      sounds.play('move')
    },
    drop: (from, count, screen) => {
      const rect = view.canvas.getBoundingClientRect()
      const at = view.pick({ x: screen.x - rect.left, y: screen.y - rect.top })
      send({ k: 'drop', from, count, x: Math.round(at.x * SUB), y: Math.round(at.y * SUB) })
    },
    craft: (recipe, times) => craftByHand(recipe, times),
    press: (id, buttonId) => pressMachine(id, buttonId),
    recipe: (id, index, times) => machineRecipe(id, index, times),
    select: (slot) => {
      selectedSlot = slot
    },
    close: closePanels,
  })
  const debugOverlay = createDebugOverlay(hudRoot)
  // The room's settings: who the host is, and whether players can hurt each other (the host can change it).
  let room = { host: '', pvp: true }
  const roomListeners = new Set<() => void>()
  // When each player was last hurt by another, by ID, to flash them red.
  const playerHitAt = new Map<number, number>()
  const pause = createPauseMenu(
    hudRoot,
    settings,
    { onCopyInvite: () => void copyInvite(), onLeave: () => leave(), onRespawn: (at) => send({ k: 'respawn', at }) },
    {
      // The connection (`mirror`) is made below, after this menu: until the server has welcomed the player, the name they
      // asked for stands in for the one the server gave them.
      get: () => {
        const me = welcomed ? (roster.get(mirror.playerId) ?? name) : name
        return { host: room.host, pvp: room.pvp, isHost: room.host !== '' && room.host.toLowerCase() === me.toLowerCase() }
      },
      setPvp: (on) => send({ k: 'pvp', on }),
      subscribe: (listener) => {
        roomListeners.add(listener)
        return () => roomListeners.delete(listener)
      },
    },
  )

  const unsubscribeSettings = settings.subscribe(() => {
    sounds.setLevels({ ...settings.volumes, muted: settings.muted })
  })

  // ---- the world and the connection

  const mirror = new FactoryMirror({
    onWelcome: (welcome) => {
      welcomed = true
      if (welcome.name) worldName = welcome.name
      hud.setConnecting(undefined)
    },
    onRoster: (players) => {
      // Who has come and gone since the last time (not everyone already here, the first time).
      const before = new Map(roster)
      roster.clear()
      for (const [id, playerName] of players) roster.set(id, playerName)
      if (rosterHeard) {
        for (const [id, playerName] of roster) if (!before.has(id) && id !== mirror.playerId) hud.notice(`${playerName} joined the game`)
        for (const [id, playerName] of before) if (!roster.has(id)) hud.notice(`${playerName} left the game`)
      }
      rosterHeard = true
    },
    onRoom: (next) => {
      room = next
      for (const listener of roomListeners) listener()
    },
    // A player hurt by another: it flashes red with the damage rising off it; knocked out, it is back at the spawn.
    onHurt: ({ id, amount, died }) => {
      const now = performance.now()
      playerHitAt.set(id, now)
      const spot = id === mirror.playerId ? local.position : remotes.positionOf(id, lastRemoteTick)
      if (spot) numbers.push({ ...tilesOf(spot), text: `-${amount}`, at: now })
      // Hurt yourself: a thud and a grunt; someone else, the dull thump of the hit, from where they are.
      if (id === mirror.playerId) sounds.play('hurt')
      else if (spot) sounds.play('hit/animal', { ...tilesOf(spot), other: true })
      if (died) hud.toast(id === mirror.playerId ? 'You were knocked out, and woke up back at the start.' : `${roster.get(id) ?? 'Someone'} was knocked out.`)
    },
    // A target dummy hit (by anyone): it sways, with how hard rising off it.
    onSight: () => {
      truesight = true
      if (expectingSight) hud.toast('The fog over the far islands lifts: you can see your way there now.')
      expectingSight = false
    },
    onDummyHit: (id, amount) => {
      const dummy = mirror.world.entity(id)
      if (!dummy) return
      const now = performance.now()
      shakes.set(id, now)
      numbers.push({ x: dummy.x + 0.5, y: dummy.y + 0.5, text: `-${amount}`, at: now })
    },
    onAnimal: (info) => {
      const lost = animalTracks.told(info, performance.now())
      const spot = animalTracks.spot(info.id)
      if (lost > 0 && spot) creatureHurt(spot, lost, animalSound(info.kind))
    },
    onGear: ({ id, held, armor }) => {
      gear.set(id, { held, armor })
    },
    onSwung: ({ id, item, angle, charged }) => {
      const weapon = weaponOf(item as ItemId)
      const them = remotes.positionOf(id, lastRemoteTick)
      flashes.push({ id, weapon, angle, at: performance.now(), charged: charged === 1, ...(them ? { from: tilesOf(them) } : {}) })
      remoteFacing.set(id, angle)
      // Heard from where they are, under the other players' volume.
      if (them) {
        const from = { ...tilesOf(them), other: true }
        if (charged === 1) sounds.play(chargedSound(weapon), from)
        else if (weapon.basic === 'shot') {
          sounds.play('attack/draw', from)
          setTimeout(() => {
            if (!disposed) sounds.play('attack/shoot', from)
          }, weapon.windup * TICK_MS)
        } else sounds.play(attackSound(weapon), from)
      }
    },
    onMonster: (info) => {
      const now = performance.now()
      const before = monsterTracks.info.get(info.id)
      const lost = monsterTracks.told(info, now)
      if (info.act && actHeard.get(info.id)?.at !== info.act.at) actHeard.set(info.id, { at: info.act.at, heardAt: now })
      const spot = monsterTracks.spot(info.id)
      if (!spot) return
      if (lost > 0) creatureHurt(spot, lost, monsterSound(info.kind))
      // An archer that stops aiming without being hurt has loosed its arrow; a skeleton raising its sword, or crouching to
      // charge, is heard, and so is the swing that ends its windup (with a red swish where it cuts) and the dash that ends
      // its charge (a red streak along it, and dust kicked up behind); the lich starting a spell is heard.
      const from = tilesOf(spot)
      const started = info.act !== undefined && before?.act?.at !== info.act.at
      if (before?.act?.k === 'aim' && info.act?.k !== 'aim' && lost === 0) sounds.play('attack/shoot', from)
      if (started && info.act?.k === 'swing') sounds.play('monster/raise', from)
      if (started && info.act?.k === 'charge') sounds.play('monster/charge', from)
      if (before?.act?.k === 'swing' && info.act?.k !== 'swing') {
        sounds.play('attack/swing', from)
        monsterSwishes.push({ kind: 'swing', monster: info.kind, ...from, angle: before.act.angle, at: now })
      }
      if (started && info.act?.k === 'dash') {
        sounds.play('attack/dash', from)
        monsterSwishes.push({ kind: 'dash', monster: info.kind, ...from, angle: info.act.angle, at: now })
      }
      if (info.act?.k === 'cast' && before?.act?.at !== info.act.at) sounds.play('cast', from)
    },
    onMonsterGone: (id, died) => {
      // Killed: the blow's number rises off it, and it falls over (a wisp does not: it bursts). A wisp that is gone
      // without being killed burst against someone.
      actHeard.delete(id)
      const gone = monsterTracks.gone(id, died, performance.now(), (info) => info.kind !== 'frost-wisp')
      if (!gone) return
      if (died !== undefined) creatureHurt(gone.spot, died, monsterSound(gone.info.kind))
      else if (gone.info.kind === 'frost-wisp') {
        sparks.push({ ...tilesOf(gone.spot), at: performance.now(), color: 0xcfeaff })
        sounds.play('punch/stone', tilesOf(gone.spot))
      }
    },
    onTrap: ({ slot, trap, delay }) => {
      trapsSetOff.set(`${slot}:${trap}`, { slot, trap, upAt: performance.now() + delay * TICK_MS, sounded: false })
      sounds.play('trap/click', trapMiddle(slot, trap))
    },
    onSpell: ({ spell, x, y, radius, ticks }) => {
      const now = performance.now()
      const at = tilesOf({ x, y })
      if (spell === 'blizzard') {
        blizzards.push({ ...at, radius, at: now, until: now + ticks * TICK_MS })
        sounds.play('blizzard', at)
      } else sparks.push({ ...at, at: now, color: spell === 'summon' ? 0x9a7ad8 : 0xcfeaff })
    },
    onWaystones: (list) => {
      waystoneList = list
    },
    // A player starting to travel by waystone: the stone charging (and this player held still, if it is them).
    onWarp: ({ id, from, to, ticks }) => {
      const now = performance.now()
      warps.set(id, { from, to, at: now, until: now + ticks * TICK_MS })
      const mine = id === mirror.playerId
      if (mine) heldUntil = now + ticks * TICK_MS + WARP_GRACE_MS
      sounds.play('warp/charge', mine ? undefined : { x: from.x + 0.5, y: from.y + 0.5, other: true })
    },
    // And the end of it: the flash where they went and where they arrived (in front of the stone, unless that was
    // blocked), or, called off, nothing.
    onWarpEnd: (id, arrived) => {
      const warp = warps.get(id)
      warps.delete(id)
      const mine = id === mirror.playerId
      if (mine) {
        heldUntil = 0
        warpTo = undefined
      }
      if (!warp) return
      if (!arrived) {
        if (mine) hud.toast('The waystone lost its hold on you.', 'error')
        return
      }
      const now = performance.now()
      const left = id === mirror.playerId ? tilesOf(local.position) : remotes.positionOf(id, lastRemoteTick)
      const leftAt = left ? (id === mirror.playerId ? left : tilesOf(left)) : { x: warp.from.x + 0.5, y: warp.from.y + 1.5 }
      warpFlashes.push({ ...leftAt, at: now, arriving: false, salt: id, stone: warp.from })
      warpFlashes.push({ x: warp.to.x + 0.5, y: warp.to.y + 1.5, at: now, arriving: true, salt: id + 1, stone: warp.to })
      if (mine) {
        closePanels()
        sounds.play('warp/arrive')
      } else {
        sounds.play('warp/arrive', { ...leftAt, other: true })
        sounds.play('warp/arrive', { x: warp.to.x + 0.5, y: warp.to.y + 1.5, other: true })
      }
    },
    onAnimalGone: (id, died) => {
      // Killed: the blow's number rises off it, and it falls over (its drops show once it has: see visibleDrops).
      const gone = animalTracks.gone(id, died, performance.now())
      if (gone && died !== undefined) creatureHurt(gone.spot, died, animalSound(gone.info.kind))
    },
    onResult: (result) => {
      prediction.settle(result.seq)
      // A warp turned down: the player is free to move again.
      if (result.seq === warpSeq) {
        warpSeq = undefined
        if (!result.ok) {
          heldUntil = 0
          warpTo = undefined
        }
      }
      // A punch a little too soon after the last is simply not counted; it is not worth a message. Crafting and eating
      // that cannot be done only make their sound.
      if (!result.ok && result.why && QUIET_REFUSALS.has(result.why)) sounds.play('craft/fail')
      else if (!result.ok && result.why && result.why !== 'tooSoon') hud.toast(REFUSALS[result.why], 'error')
    },
    onPlayerInventory: (inventory) => {
      const before = new Map(inventoryTotals(playerInventory).map((total) => [total.item, total.count]))
      let gainedAny = false
      for (const { item, count } of inventoryTotals(inventory)) {
        const gained = count - (before.get(item) ?? 0)
        if (gained <= 0) continue
        hud.pickup(`+${gained} ${getItem(item).name}`)
        gainedAny = true
      }
      if (gainedAny) sounds.play('pickup')
      playerInventory = inventory
    },
    onDesync: (report, snapshot) => {
      connection.sendDesync(report)
      const { cx, cy } = chunkCoords(report.chunk)
      console.warn(`Chunk ${cx},${cy} differs from the server's at tick ${report.tick}; it is being sent again.`)
      if (import.meta.env.DEV) {
        localDumps.set(`${report.chunk}@${report.tick}`, snapshot)
        if (localDumps.size > 8) localDumps.delete(localDumps.keys().next().value!)
      }
    },
    onDump: (chunk, tick, server) => {
      const mine = localDumps.get(`${chunk}@${tick}`)
      const { cx, cy } = chunkCoords(chunk)
      if (!mine || !server) {
        console.info(`Chunk ${cx},${cy} at tick ${tick}: there is no copy from ${mine ? 'the server' : 'this page'} to compare.`)
        return
      }
      const lines = diffChunkSnapshots(mine, server)
      console.groupCollapsed(`Desync in chunk ${cx},${cy} at tick ${tick}: ${lines.length} difference(s)`)
      for (const line of lines) console.log(line)
      console.log('this page:', mine)
      console.log('server:', server)
      console.groupEnd()
    },
  })

  // What the player is making by hand, as the state messages say: the recipe, how many are waiting, and how far along
  // it is (`elapsed` ticks at `at`, going on a tick every TICK_MS while the inventory is open). State messages come
  // unevenly, so a new one only moves that on if it is more than a few ticks out (a new item, or the inventory closed a
  // while), and the bar goes on smoothly from one to the next.
  let craftState: { recipe: number; elapsed: number; queued: number; at: number } | undefined
  const CRAFT_SLACK_TICKS = 3
  const craftElapsed = (now: number): number => {
    if (!craftState) return 0
    return craftState.elapsed + (handOpen ? (now - craftState.at) / TICK_MS : 0)
  }
  const handlers: ConnectionHandlers = {
    onLog: (message) => mirror.receiveLog(message),
    onState: (state) => {
      if (state.t <= lastStateTick) return
      lastStateTick = state.t
      mirror.noteState(state.t, state.s)
      raftTracks.update(state.t, state.r ?? [], state.q ?? [])
      if (!state.c) craftState = undefined
      else {
        const now = performance.now()
        const [recipe, elapsed, queued] = state.c
        const kept = craftState && craftState.recipe === recipe && Math.abs(craftElapsed(now) - elapsed) <= CRAFT_SLACK_TICKS
        if (kept) {
          craftState!.elapsed = craftElapsed(now)
          craftState!.at = now
          craftState!.queued = queued
        } else craftState = { recipe, elapsed, queued, at: now }
      }
      const self = state.p.find((player) => player[0] === mirror.playerId)
      const aboard = state.o ? { raft: state.o[0], x: state.o[1], y: state.o[2] } : undefined
      if (self && mirror.started) {
        if (!placed) {
          local.place({ x: self[1], y: self[2] }, aboard)
          placed = true
        } else local.reconcile({ x: self[1], y: self[2] }, state.a, aboard, state.v ? { x: state.v[0], y: state.v[1] } : undefined)
      }
      remotes.update(state.t, state.p, mirror.playerId)
      animalTracks.update(state.t, state.n ?? [])
      monsterTracks.update(state.t, state.m ?? [])
      shotTracks.update(state.t, (state.j ?? []).map(([id, , x, y]): [number, number, number] => [id, x, y]), -1)
      for (const [id, item, , , stopped] of state.j ?? []) {
        shotItems.set(id, item)
        if (stopped && !shotStopped.has(id)) shotStopped.set(id, state.t)
      }
      if (state.h !== undefined) health = state.h
      if (state.b !== undefined) bodyTenths = state.b
    },
    onError: (message) => {
      if (!welcomed) leave(message, true)
      else hud.toast(message, 'error')
    },
    onDisconnect: () => leave('The connection to the game was lost.', true),
  }
  // Online, the game server; in singleplayer, the world run in this browser.
  const connection = solo ? connectLocal(solo.seed, name, handlers, solo.terrain) : connect(code, name, handlers)
  // The player walks into what the page's copy of the world says is solid, and is pushed out of it, and is slowed by
  // what it says is slow (bushes).
  // Without truesight, the far islands' fog is as solid as a wall (as on the server).
  const solid = solidIn(mirror.world, () => (mirror.started ? mirror.terrain : undefined))
  local.solid = (x, y) => (!truesight && mirror.started && mirror.terrain !== undefined && isFoggedAt(mirror.terrain, x, y) ? true : solid(x, y))
  local.slow = slowIn(mirror.world)
  // Freezing, the player is slowed here as on the server (see cold.ts), by how cold the server says its body is.
  local.speedPercent = () => coldSpeedPercent(bodyTenths)
  // The animals and other players, which the player is pushed off when on top of them.
  let lastRemoteTick = 0
  // The rafts, where they are drawn, to step aboard and ride; and the land, to step off one onto.
  local.rafts = () => raftTracks.posesAt(lastRemoteTick)
  local.canLand = (point) => {
    const solid = local.solid
    return solid !== undefined && solid(tileOfUnits(point.x), tileOfUnits(point.y)) === false && !overlapsSolid(point, solid)
  }
  local.crowd = () => {
    const crowd: Array<{ x: number; y: number; half: number; mass: number }> = []
    for (const { info, x, y } of animalTracks.drawn()) {
      const def = animalDef(info.kind)
      crowd.push({ x, y, half: def.halfSize, mass: def.mass })
    }
    for (const { info, x, y } of monsterTracks.drawn()) {
      const def = monsterDef(info.kind)
      // Wisps are not bodies: they burst against whoever they touch.
      if (def.attack.kind !== 'touch') crowd.push({ x, y, half: def.halfSize, mass: def.boss ? BOSS_MASS : MONSTER_MASS })
    }
    for (const remote of remotes.positionsAt(lastRemoteTick)) crowd.push({ x: remote.x, y: remote.y, half: PLAYER_HALF_SIZE, mass: PLAYER_MASS })
    return crowd
  }
  // The animals this player leads, which the rope pulls the player towards: where each is reckoned to be now (not
  // where it is drawn, a little in the past), going on as it was going, TETHER_AHEAD ticks past the newest the server
  // sent, about when the server plays the player's input.
  local.tethers = () => {
    const pulling: Array<{ x: number; y: number }> = []
    for (const info of animalTracks.info.values()) {
      if (info.leader !== mirror.playerId) continue
      const spot = animalTracks.ahead(info.id, TETHER_AHEAD)
      if (spot) pulling.push(spot)
    }
    return pulling
  }
  const connectTimer = setTimeout(() => {
    if (!welcomed) leave(solo ? 'The world could not start in this browser.' : 'Could not reach the game server.', true)
  }, CONNECT_TIMEOUT_MS)

  // ---- commands

  // Sends a command; gives its number (undefined if not sent).
  const send = (command: Command): number | undefined => {
    if (!welcomed) return undefined
    // Every number in a command must be a real one: NaN and Infinity go over the wire as null, which the server cannot
    // read. Such a command is a bug here; it is not sent.
    if (!finiteThroughout(command)) {
      console.error('Not sent: a command with a number that is not a number.', command)
      return undefined
    }
    const now = performance.now()
    const seq = connection.sendCommand(connection.clock.commandTick(now), command)
    prediction.add(seq, command, now)
    return seq
  }

  // The player's inventory as it will be once what has been asked for is done.
  const predictedInventory = (): Inventory => prediction.predictInventories(playerInventory, mirror.world).player

  // The plant, rock or building on a tile that bare hands would hit: in reach.
  const punchable = (x: number, y: number): Entity | undefined => {
    const entity = mirror.world.entityAt(x, y)
    return entity && isHittable(entity) && isWithinReach(local.position, x, y) ? entity : undefined
  }


  // ---- attacking (see weapons.ts): the left button attacks with what is held, aimed at the mouse, and holding it
  // keeps attacking as the cooldown allows. A shot (bow, sling) has a short windup first (the bow drawn, the sling
  // whirled once round), which the server waits out too before it lets fly. Every attack shares one cooldown. What it
  // hits is the server's to say: the page draws the swing and plays its sound at once. The right button never attacks:
  // it is for using things, whatever is held.
  let attackReadyAt = 0
  // Until when the player is slowed by having just attacked (see ATTACK_SLOW_TICKS), in page time.
  let attackSlowUntil = 0
  // Until when the player stands still, making an attack.
  let attackStillUntil = 0
  // When the player was last told they have nothing to shoot.
  let noAmmoToldAt = Number.NEGATIVE_INFINITY
  // When the player was last told the game is not answering.
  let stallWarnedAt = Number.NEGATIVE_INFINITY
  // The attacks being made, by this player and the others (for their arms' swing and the swish behind the weapon, each
  // for SWING_MS); sparks where they hit something; and the numbers that rise off animals that are hurt. Positions in
  // tiles.
  // (`charged`: a charged attack, drawn from where it was made, `from`, in tiles.)
  const flashes: Array<{ id: number; weapon: Weapon; angle: number; at: number; charged?: boolean; from?: { x: number; y: number } }> = []
  // The steps attacks take the player (see lungeOf: a lunge, a dash), one a tick, played with the movement.
  const pushes: Array<{ angle: number; speed: number }> = []
  // The attack button held down to charge the held weapon's charged attack (see CHARGE_TICKS): with what, in which slot,
  // since when (page time), and whether it is ready (its sound has played). It is ready a little after CHARGE_TICKS, so
  // the server, counting in ticks, always agrees it was held long enough.
  let charging: { slot: number; weapon: Weapon; since: number; ready: boolean } | undefined
  const chargeMs = (weapon: Weapon): number => (weapon.charged?.charge ?? CHARGE_TICKS) * TICK_MS + 40
  // Monsters' attacks landing, drawn for a moment where they were made (tiles): a skeleton's swing, its dash.
  const monsterSwishes: Array<{ kind: 'swing' | 'dash'; monster: string; x: number; y: number; angle: number; at: number }> = []
  let lastDustAt = 0
  // What each other player holds and wears (see the `gear` event), and the slot this page last told the server it holds.
  const gear = new Map<number, { held: number; armor: number[] }>()
  let holdSent: number | undefined
  const sparks: Array<{ x: number; y: number; at: number; color: number }> = []
  const numbers: Array<{ x: number; y: number; text: string; at: number }> = []

  const heldWeapon = (): Weapon => weaponIn(predictedInventory(), selectedSlot)
  // Where the mouse points, in units (straight ahead of the player without a mouse).
  const aimPoint = (): { x: number; y: number } => {
    if (!pointer) return { x: Math.round(local.position.x + Math.cos(local.facing) * SUB), y: Math.round(local.position.y + Math.sin(local.facing) * SUB) }
    // The ground under the mouse itself, not the middle of a tree or rock there, so the attack goes exactly that way.
    const world = view.aim(pointer)
    return { x: Math.round(world.x * SUB), y: Math.round(world.y * SUB) }
  }
  const attack = (weapon: Weapon, charged = false): void => {
    if (!welcomed) return
    const now = performance.now()
    if (now < attackReadyAt) return
    if (weapon.basic === 'shot' && (weapon.ammo === undefined || countOf(predictedInventory(), weapon.ammo) === 0)) {
      if (now - noAmmoToldAt > 2_000) hud.toast(REFUSALS.noAmmo, 'error')
      noAmmoToldAt = now
      attackReadyAt = now + 400
      return
    }
    const aim = aimPoint()
    const angle = Math.atan2(aim.y - local.position.y, aim.x - local.position.x)
    // With the tick the creatures are drawn at, so the server judges the attack against where they are seen.
    const seen = Math.max(0, Math.round(lastRemoteTick))
    send({ k: 'attack', slot: selectedSlot, x: aim.x, y: aim.y, seen, ...(charged ? { charged: 1 as const } : {}) })
    // A charged shot was drawn while the button was held: it flies at once.
    const windup = charged ? 0 : weapon.windup * TICK_MS
    const cooldown = charged && weapon.charged ? weapon.charged.cooldown : weapon.cooldown
    attackReadyAt = now + windup + cooldown * TICK_MS
    attackSlowUntil = now + windup + ATTACK_SLOW_TICKS * TICK_MS
    // The player stands still while the attack is made (a shot's windup too), so the swing is not dragged about; a melee
    // attack steps them forward first (a dash runs them through), which also cuts short walking backwards as they swing.
    attackStillUntil = now + attackDurationMs(weapon, charged)
    local.facing = angle
    flashes.push({ id: mirror.playerId, weapon, angle, at: now, charged, from: tilesOf(local.position) })
    const lunge = lungeOf(weapon, charged)
    if (lunge) {
      pushes.length = 0
      for (let i = 0; i < lunge.ticks; i++) pushes.push({ angle, speed: lunge.distance / lunge.ticks })
    }
    if (charged) {
      sounds.play(chargedSound(weapon))
      const area = attackArea(weapon, true)
      if (area) showHits(area, angle, now)
      return
    }
    if (weapon.basic === 'shot') {
      sounds.play('attack/draw')
      setTimeout(() => {
        if (!disposed) sounds.play('attack/shoot')
      }, windup)
    } else {
      sounds.play(attackSound(weapon))
      const area = attackArea(weapon, false)
      if (area) showHits(area, angle, now)
    }
  }

  // The attack button pressed down with a weapon that has a charged attack: nothing is swung yet; it starts charging
  // (the server is told, to time it), slowing the player while it is held. It is all timing, with nothing drawn to show
  // it (only a soft cue in the sound when it is ready): let go once it is ready (its `charge`: chargeMs, and the cooldown over) and
  // the charged attack goes; let go before (a click) and the plain attack goes instead.
  const startCharge = (): void => {
    const inventory = predictedInventory()
    const weapon = heldWeapon()
    if (!welcomed || !weapon.charged) return
    if (weapon.basic === 'shot' && (weapon.ammo === undefined || countOf(inventory, weapon.ammo) === 0)) return void attack(weapon)
    charging = { slot: selectedSlot, weapon, since: performance.now(), ready: false }
    send({ k: 'charge', slot: selectedSlot })
  }
  const chargeIsReady = (now: number): boolean => charging !== undefined && now - charging.since >= chargeMs(charging.weapon) && now >= attackReadyAt
  const releaseCharge = (): void => {
    const held = charging
    charging = undefined
    if (!held || held.slot !== selectedSlot) return
    const now = performance.now()
    if (now - held.since >= chargeMs(held.weapon) && now >= attackReadyAt) attack(held.weapon, true)
    else attack(held.weapon)
  }

  // What a basic swing is about to hit, shown at once (the server has the last word, a moment later): everything it
  // reaches shakes and throws up a spark, with the sound of what it is. Animals are not guessed at: they flash, spark and
  // show their damage only once the server says they were hurt (see onAnimal), so the flash and the number always agree.
  const showHits = (area: AttackArea, angle: number, now: number): void => {
    const targets = tilesHitBy(mirror.world, area, local.position, angle)
    for (const target of targets) {
      shakes.set(target.id, now)
      sparks.push({ x: target.x + 0.5, y: target.y + 0.5, at: now, color: hitColor(target.kind) })
    }
    const first = targets[0]
    if (first) sounds.play(hitSound(first.kind))
  }
  // Rock and what is like it (copper, tin, clay) knock like stone; what is green or soft (sunflowers, cacti, sand, a
  // cobweb, a wild hive's comb) rustles; the rest knocks like wood. Each sparks in its own colour.
  const STONY: ReadonlySet<string> = new Set(['rock', 'copper-rock', 'tin-rock', 'clay'])
  const SOFT: ReadonlySet<string> = new Set(['bush', 'grass', 'plot', 'sunflower', 'seedling', 'cactus', 'sand', 'cobweb', 'hive'])
  const SPARKS: Readonly<Record<string, number>> = {
    rock: 0xb9bcc2,
    'copper-rock': 0xd27a3c,
    'tin-rock': 0xdcdfd4,
    clay: 0xa8644a,
    sand: 0xe3cd94,
    cobweb: 0xf2f2ee,
    hive: 0xe8a020,
    sunflower: 0xf2c41c,
  }
  const hitColor = (kind: Entity['kind']): number => SPARKS[kind] ?? (SOFT.has(kind) ? 0x6fbf4a : 0xc49562)
  const hitSound = (kind: Entity['kind']): SoundId => (STONY.has(kind) ? 'punch/stone' : SOFT.has(kind) ? 'punch/leaves' : 'punch/wood')

  const attackSound = (weapon: Weapon): SoundId =>
    weapon.basic === 'shot' ? 'attack/shoot' : weapon.basic === 'jab' ? 'attack/jab' : weapon.basic === 'thrust' ? 'attack/thrust' : 'attack/swing'
  // A charged attack's: a spin's whirl, the heavy thud of a slam or big strike, a dash's rush, a throw's or a shot's.
  const chargedSound = (weapon: Weapon): SoundId => {
    switch (weapon.charged?.kind) {
      case 'spin':
        return 'attack/spin'
      case 'slam':
      case 'strike':
        return 'attack/slam'
      case 'dash':
        return 'attack/dash'
      case 'throw':
        return 'attack/thrust'
      default:
        return 'attack/shoot'
    }
  }

  // The left button pressed: an attack with what is held, if it is a weapon or a tool; with anything else, or nothing,
  // a punch (see weaponOf).
  const pressAttack = (): void => attack(heldWeapon())

  // Whether the picked slot holds something put down or planted with the right button (so a drag goes on doing it).
  const holdsPlaceable = (): boolean => {
    const held = predictedInventory().slots[selectedSlot]
    const item = held && held.count > 0 ? getItem(held.item) : undefined
    return item !== undefined && (item.places !== undefined || item.crop !== undefined)
  }

  // Where a raft put down on a tile goes (its middle on the tile's), as the page sees it, or why it cannot: out of
  // reach, or not all on open water clear of the other rafts.
  const raftSpot = (x: number, y: number): { pose: RaftPose } | { why: Refusal } => {
    if (!isWithinReach(local.position, x, y)) return { why: 'reach' }
    const terrain = mirror.terrain
    const others = raftTracks.posesAt(lastRemoteTick).map((raft) => raft.pose)
    const pose = raftOnTile(x, y)
    return terrain && raftFits(pose, (tx, ty) => waterAt(terrain, tx, ty), others) ? { pose } : { why: 'raftWater' }
  }

  // A right click on an animal: put a rope on it (or take it off), or milk it.
  const interact = (id: number): void => {
    if (!welcomed) return
    send({ k: 'interact', animal: id, slot: selectedSlot })
  }

  // Tying something to a fence: the fence right clicked first, kept until the next right click (on an animal or a raft
  // to tie it to the fence, or anywhere else to give up).
  let tyingTo: number | undefined
  // A right click on a fence: untie what is tied to it, or start tying something to it.
  const fenceClicked = (id: number): void => {
    tyingTo = undefined
    if (tiedFences().has(id)) {
      send({ k: 'untie', fence: id })
      return
    }
    tyingTo = id
    hud.toast('Now right click an animal or a raft to tie it to this fence.')
  }
  // The raft under the mouse, as it is drawn, if there is one.
  const raftUnderPointer = (): number | undefined => {
    if (!pointer) return undefined
    const at = view.pick(pointer)
    const point = { x: Math.round(at.x * SUB), y: Math.round(at.y * SUB) }
    return raftTracks.posesAt(lastRemoteTick).find(({ pose }) => onRaft(pose, point))?.id
  }
  // A right click on a raft holding a rope puts it on the raft's post, to pull the raft along (and one on yours takes
  // it off again). False if it does neither, so the click does what it would on the water.
  const raftClicked = (id: number): boolean => {
    const held = predictedInventory().slots[selectedSlot]
    const holdsRope = held !== undefined && held.count > 0 && getItem(held.item).key === 'rope'
    if (!holdsRope && raftTracks.ropes.get(id)?.leader !== mirror.playerId) return false
    if (welcomed) send({ k: 'raftRope', raft: id, slot: selectedSlot })
    return true
  }

  // Whether a point (tiles) is under the far islands' fog for this player (no truesight): what is there is not drawn,
  // and cannot be used.
  const inFog = (x: number, y: number): boolean => !truesight && mirror.terrain !== undefined && isFoggedAt(mirror.terrain, Math.floor(x), Math.floor(y))

  // Ctrl + right click: quick moves, without opening anything. A target dummy is picked back up (with no room for it,
  // nothing). Gives whether it was one of those, else the click goes on as a plain one.
  const quickUse = (x: number, y: number): boolean => {
    if (inFog(x, y)) return false
    const there = mirror.world.entityAt(x, y)
    if (there?.kind !== 'dummy') return false
    if (roomFor(predictedInventory(), itemId('target-dummy'), 1) > 0) send({ k: 'lift', id: there.id })
    return true
  }

  // A right click on a tile: opens a building with an inventory there, or puts down what the picked hotbar slot holds
  // (plants an acorn). A drag over tiles plants along it, skipping quietly where it cannot; a click says why not.
  const place = (x: number, y: number, quiet: boolean): void => {
    if (!welcomed || inFog(x, y)) return
    const there = mirror.world.entityAt(x, y)
    if (there?.kind === 'gate') {
      if (!quiet) send({ k: 'toggle', id: there.id })
      return
    }
    if (there?.kind === 'fence') {
      if (!quiet) fenceClicked(there.id)
      return
    }
    // A bucket or compost is used on what it is pointed at: a pond, a barrel, a garden plot.
    const using = predictedInventory().slots[selectedSlot]
    const tool = using && using.count > 0 ? getItem(using.item) : undefined
    // A bucket fills at a pond or a well (fresh water) or the sea (salt water), empties into a barrel or onto a plot, or is
    // emptied out on bare ground.
    const dumps = tool?.bucket !== undefined && tool.bucket !== 'empty' && !there
    if (tool && tool.bucket && (there?.kind === 'barrel' || there?.kind === 'plot' || (there?.kind === 'well' && tool.bucket === 'empty') || (!there && mirror.terrain !== undefined && waterAt(mirror.terrain, x, y)) || dumps)) {
      if (!quiet) send({ k: 'apply', x, y, slot: selectedSlot })
      return
    }
    // A sleeping bag: sleep in it, to wake up here next time you are knocked out.
    if (there?.kind === 'bed') {
      if (!quiet) sleepIn(there.id)
      return
    }
    // A waystone: its panel, to name it and travel from it.
    if (there?.kind === 'waystone') {
      if (!quiet) {
        inventoryOpen = false
        openBuilding = undefined
        openWaystone = there.id
      }
      return
    }
    // A drying rack has no panel: what is held (a hide) is hung on it, if nothing is on it yet. What has dried on it comes
    // off with a hit, as a grown crop does (see the server's `hit`).
    if (there?.kind === 'rack') {
      const held = predictedInventory().slots[selectedSlot]
      if (quiet || !held || held.count === 0) return
      const refused = rackRefusal(there, held.item)
      if (refused) return void hud.toast(REFUSALS[refused], 'error')
      send({ k: 'put', id: there.id, item: held.item, max: 1, slot: selectedSlot })
      sounds.play('move')
      return
    }
    if (there && hasInventory(there)) {
      if (!quiet) {
        openBuilding = there.id
        openWaystone = undefined
      }
      return
    }
    const inventory = predictedInventory()
    const held = inventory.slots[selectedSlot]
    if (!held || held.count === 0) return
    // A raft goes down on the water, on the player's rope.
    if (isRaftItem(held.item)) {
      if (quiet) return
      const spot = raftSpot(x, y)
      if ('why' in spot) return void hud.toast(REFUSALS[spot.why], 'error')
      send({ k: 'place', x, y, slot: selectedSlot })
      sounds.play('plant')
      return
    }
    if (!getItem(held.item).places && getItem(held.item).crop === undefined) {
      if (!quiet) hud.toast(REFUSALS.notPlaceable, 'error')
      return
    }
    if (prediction.occupies(x, y)) return
    const check = checkPlace(mirror.world, local.position, inventory, selectedSlot, x, y, mirror.terrain)
    if (!check.ok) {
      if (!quiet) hud.toast(REFUSALS[check.why], 'error')
      return
    }
    send({ k: 'place', x, y, slot: selectedSlot })
    sounds.play('plant')
  }

  // ---- input

  let pointer: { x: number; y: number } | undefined
  let leftDown = false
  let rightDown = false
  let lastDragTile = ''
  const tileUnderPointer = (): { x: number; y: number } | undefined => {
    if (!pointer) return undefined
    const at = view.pick(pointer)
    return { x: Math.floor(at.x), y: Math.floor(at.y) }
  }

  const canvas = view.canvas
  const onPointerMove = (event: PointerEvent): void => {
    pointer = { x: event.offsetX, y: event.offsetY }
    const tile = tileUnderPointer()
    if (!tile || pause.isOpen || !rightDown || !holdsPlaceable()) return
    const key = `${tile.x},${tile.y}`
    if (key === lastDragTile) return
    lastDragTile = key
    if (hoveredAnimal === undefined) place(tile.x, tile.y, true)
  }
  const onPointerDown = (event: PointerEvent): void => {
    pointer = { x: event.offsetX, y: event.offsetY }
    const tile = tileUnderPointer()
    if (!tile || pause.isOpen) return
    lastDragTile = `${tile.x},${tile.y}`
    if (event.button === 0) {
      leftDown = true
      // A weapon with a charged attack charges while the button is down and attacks when it is let go (see startCharge);
      // anything else attacks at once.
      if (heldWeapon().charged) startCharge()
      else pressAttack()
    } else if (event.button === 2) {
      // The right button uses things, whatever is held: opens a chest or a station, puts down, leads an animal or a raft,
      // ties one to a fence.
      rightDown = true
      const raft = hoveredAnimal === undefined ? raftUnderPointer() : undefined
      if (tyingTo !== undefined) {
        const fence = tyingTo
        tyingTo = undefined
        if (hoveredAnimal !== undefined) send({ k: 'tie', fence, animal: hoveredAnimal })
        else if (raft !== undefined) send({ k: 'tie', fence, raft })
        else if (mirror.world.entityAt(tile.x, tile.y)?.id !== fence) hud.toast('Nothing tied: right click an animal or a raft after the fence.')
        return
      }
      if (event.ctrlKey && hoveredAnimal === undefined && quickUse(tile.x, tile.y)) return
      if (hoveredAnimal !== undefined) interact(hoveredAnimal)
      else if (raft === undefined || !raftClicked(raft)) place(tile.x, tile.y, false)
    }
  }
  const onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) {
      leftDown = false
      releaseCharge()
    }
    if (event.button === 2) rightDown = false
  }
  const onPointerLeave = (): void => {
    pointer = undefined
  }
  // The wheel picks the hotbar slot, a slot a notch (down for the next, wrapping round; from bare hands, from the slot
  // held before); with Ctrl held (or a trackpad pinch, which comes as one) it zooms. A trackpad's many small turns are
  // added up, a slot for each notch's worth.
  let wheelSlots = 0
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    // Lines or pages (some mice, some browsers) as pixels, a notch being about 100.
    const scale = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 800 : 1
    if (event.ctrlKey) {
      zoomTarget = zoomAfterWheel(zoomTarget, event.deltaY * scale)
      return
    }
    const pixels = event.deltaY * scale
    if (pixels === 0) return
    let steps: number
    if (Math.abs(pixels) >= WHEEL_NOTCH / 2) {
      // A mouse wheel's notch (however many pixels the browser calls it): one slot.
      steps = Math.sign(pixels)
      wheelSlots = 0
    } else {
      // A trackpad's small turns, added up (starting again when it turns the other way).
      if (Math.sign(pixels) !== Math.sign(wheelSlots)) wheelSlots = 0
      wheelSlots += pixels / WHEEL_NOTCH
      steps = Math.trunc(wheelSlots)
      wheelSlots -= steps
      if (steps === 0) return
    }
    const from = selectedSlot === -1 ? slotBeforeHand : selectedSlot
    selectedSlot = (((from + steps) % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS
  }
  const onContextMenu = (event: Event): void => event.preventDefault()

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingIn(event.target)) return
    if (event.code === 'Escape') {
      event.preventDefault()
      if (pause.isOpen) pause.back()
      else if (map.isOpen) map.close()
      else if (inventoryOpen || openBuilding !== undefined || openWaystone !== undefined) closePanels()
      else {
        keys.clear()
        leftDown = false
        rightDown = false
        charging = undefined
        pause.open()
      }
      return
    }
    if (pause.isOpen) return
    if (event.code === 'F9' && import.meta.env.DEV) {
      event.preventDefault()
      corruptForTesting()
      return
    }
    const action = settings.actionOf(event.code)
    if (!action) return
    event.preventDefault()
    if (isMovementAction(action)) {
      keys.press(event.code)
      return
    }
    if (event.repeat) return
    const slot = HOTBAR_ACTIONS.indexOf(action)
    if (slot >= 0) {
      // Over a stack in the open inventory: swapped with that hotbar slot.
      const over = inventoryOpen || openBuilding !== undefined ? panels.hovered() : undefined
      if (over) {
        const from = over.side === 'player' ? { id: 0, i: over.index } : openBuilding !== undefined ? { id: openBuilding, i: over.index } : undefined
        if (from && !(from.id === 0 && from.i === slot)) {
          send({ k: 'slot', from, to: { id: 0, i: slot }, count: 100_000 })
          sounds.play('move')
        }
        return
      }
      selectedSlot = slot
      return
    }
    if (action === 'hand') {
      // Bare hands, or, already bare-handed, back to what was held before.
      if (selectedSlot === -1) selectedSlot = slotBeforeHand
      else {
        slotBeforeHand = selectedSlot
        selectedSlot = -1
      }
      return
    }
    if (action === 'inventory') {
      if (inventoryOpen || openBuilding !== undefined || openWaystone !== undefined) closePanels()
      else inventoryOpen = true
    } else if (action === 'eat') eat()
    else if (action === 'players') showingPlayers = true
    else if (action === 'map') map.toggle()
    else if (action === 'debug') debug = !debug
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    keys.release(event.code)
    if (settings.actionOf(event.code) === 'players') showingPlayers = false
  }
  // The browser lets the page make sound only once the player has pressed something.
  const unlockSound = (): void => sounds.unlock()
  const onBlur = (): void => {
    showingPlayers = false
    keys.clear()
    leftDown = false
    rightDown = false
    charging = undefined
  }

  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  // No browser menu on a right click anywhere in the game (over the panels as much as the world).
  window.addEventListener('contextmenu', onContextMenu)
  const disposeTooltips = createTooltips(hudRoot)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('pointerdown', unlockSound, true)
  window.addEventListener('keydown', unlockSound, true)

  // In a development build, F9 changes this page's copy of a chunk behind the log's back, to see a desync found and
  // put right (the chunk's next hash does not match, the server sends it again, and the console shows the difference).
  const corruptForTesting = (): void => {
    for (const chunkId of mirror.world.chunkIds) {
      const entity = mirror.world.chunk(chunkId)!.entities.find((candidate) => candidate.kind !== 'sapling')
      if (!entity) continue
      if (hasInventory(entity)) entity.inv.slots[entity.inv.slots.length - 1] = { item: 1, count: 7 }
      else if (isBeltLike(entity)) entity.lane.push({ item: 1, pos: 8, prev: 8 })
      else if (entity.kind === 'tree' || entity.kind === 'bush') entity.hp = entity.hp > 1 ? entity.hp - 1 : 2
      hud.toast(`Changed ${BUILDINGS[entity.kind].name.toLowerCase()} ${entity.id} on this page only: watch the desync be put right.`)
      return
    }
    hud.toast('There is nothing near here to change.')
  }

  // ---- each frame

  let lastFrameAt = performance.now()
  let localClock = 0
  let lastUiAt = 0
  let lastDebugAt = 0
  // What each part of a frame takes, for the debug view.
  const timer = new FrameTimer()

  const frame = (): void => {
    if (disposed) return
    const now = performance.now()
    const elapsed = Math.min(250, now - lastFrameAt)
    lastFrameAt = now
    const clock = connection.clock
    // The view drew the last frame after this was last called.
    timer.add('render', view.stats().renderMs)
    timer.start(now)

    // The player's own movement, a tick at a time, sent as it is played.
    if (placed && clock.ready) {
      localClock = Math.min(localClock + elapsed, TICK_MS * 6)
      while (localClock >= TICK_MS) {
        localClock -= TICK_MS
        // Just after an attack (and through a shot's windup) the player is slowed, so a fight cannot be run from with the
        // weapon swinging; while the attack is made, they stand still.
        // Charging an attack slows them more. A step an attack takes (a lunge, a dash) moves them instead of the keys.
        const slow = performance.now() < attackSlowUntil ? KEY_SLOW : 0
        const charge = charging ? KEY_CHARGE : 0
        const still = pause.isOpen || performance.now() < attackStillUntil || performance.now() < heldUntil
        const push = pushes.shift()
        connection.sendInputs(local.step(push ? withPush(0, push.angle, push.speed) : still ? 0 : keys.movement() | slow | charge))
        stepSounds()
      }
    }

    timer.lap('input')

    // The world, as soon as it can be: every tick the server's log is complete for is simulated now, so what the player
    // did shows a round trip after they did it, and no later. (A long way behind, after a stall, it catches up a slice
    // at a time, so a frame is never held up for long.)
    let alpha = 1
    if (mirror.started && clock.ready) {
      const behind = mirror.through - mirror.simTick
      const deadline = now + 8
      let steps = 0
      while (mirror.canStep()) {
        mirror.step()
        steps++
        if (behind > 10 && (steps & 15) === 0 && performance.now() > deadline) break
      }
      alpha = Math.min(1, Math.max(0, clock.arrivalTick(now) - mirror.simTick))
    }
    timer.lap('world')

    // The animals, drawn a little in the past like the other players, and the one under the mouse.
    const remoteTick = clock.ready ? clock.arrivalTick(now) - REMOTE_DELAY_TICKS : 0
    lastRemoteTick = remoteTick
    const animalList = animalViews(remoteTick, now)

    // Holding the left button charges a weapon's charged attack (a sound when it is ready to let go: see startCharge);
    // with no charged attack (fists, a tool), it keeps attacking as the cooldown allows. Crops are harvested by what the
    // attack covers, like anything else.
    if (charging && charging.slot !== selectedSlot) charging = undefined
    if (charging && !charging.ready && chargeIsReady(now)) {
      charging.ready = true
      sounds.play('charge/ready')
    }
    if (leftDown && !pause.isOpen && !charging && !heldWeapon().charged && now >= attackReadyAt) pressAttack()

    // The camera follows the player, drawn between its last two ticks (aboard a raft, on it as it is drawn now), and
    // eased onto where the server last put it right (see `LocalPlayer.smoothing`).
    local.follow()
    const t = localClock / TICK_MS
    const smoothing = local.smoothing(now)
    const playerX = local.previous.x + (local.position.x - local.previous.x) * t + smoothing.x
    const playerY = local.previous.y + (local.position.y - local.previous.y) * t + smoothing.y
    // Sounds are heard from where the player is; the other players' footsteps from where they walk.
    sounds.listen(playerX / SUB, playerY / SUB)
    remoteSteps(remoteTick)
    const zoomNow = performance.now()
    zoom = easeZoom(zoom, zoomTarget, Math.min(100, zoomNow - zoomedAt))
    zoomedAt = zoomNow
    view.look({ x: playerX / SUB, y: playerY / SUB }, zoom)

    const rituals = ritualViews(alpha)
    const buildings = visibleBuildings(remoteTick, rituals)
    const removing = prediction.removals()
    // The cold: frost creeping over the view as the body cools, and snow blowing in cold air (only a few flakes
    // drifting down in the ice crypt, out of the wind).
    if (mirror.terrain) {
      const position = { x: Math.round(playerX), y: Math.round(playerY) }
      const inside = isInDungeons(tileOfUnits(position.x), tileOfUnits(position.y))
      frost.update(frostOf(bodyTenths / 10), elapsed)
      snow.update(inside ? DUNGEON_FLURRY : snowAt(airTemperatureAt(mirror.terrain, position.x / SUB, position.y / SUB)), elapsed)
    }
    const worldFrame: WorldFrame = {
      terrain: mirror.terrain,
      fogLifted: truesight,
      buildings,
      removingIds: removing,
      shaking: shaking(now),
      now,
      alpha,
      players: players(playerX, playerY, remoteTick, now),
      drops: visibleDrops(alpha, now),
      animals: animalList,
      monsters: monsterViews(remoteTick, now),
      traps: trapViews(now),
      rafts: raftTracks.posesAt(remoteTick).map(({ id, pose }) => {
        const on = raftTracks.ropes.get(id)
        const rope = on ? ropeEnd(on.leader, on.post, remoteTick) : undefined
        return { id, x: pose.x / SUB, y: pose.y / SUB, angle: pose.angle, ...(rope ? { rope } : {}) }
      }),
      attacks: attackView(now, playerX / SUB, playerY / SUB, remoteTick),
      overlay: overlay(buildings),
      rituals,
      warps: warpViews(now, playerX / SUB, playerY / SUB, remoteTick),
      warpFlashes: warpFlashViews(now),
      ...(debug ? { debug: debugView() } : {}),
    }
    timer.lap('scene')
    view.draw(worldFrame)
    timer.lap('draw')

    if (openBuilding !== undefined) panels.setProgress(workProgress(alpha))
    else if (inventoryOpen && craftState) panels.setHandProgress(handFraction())

    if (now - lastUiAt >= UI_MS) {
      lastUiAt = now
      prediction.expire(now)
      // Commands waiting a long time for their answer: the server is not hearing them (or not answering), so say so
      // rather than leaving the player wondering why nothing they do takes effect.
      const oldest = prediction.oldestSentAt()
      if (oldest !== undefined && now - oldest > STALL_WARN_MS && now - stallWarnedAt > STALL_WARN_MS * 3) {
        stallWarnedAt = now
        hud.toast('The game has not answered for a while: what you do may not be taking effect. Leaving and joining again will fix it.', 'error')
      }
      updateUi()
    }
    if (now - lastDebugAt >= DEBUG_MS) {
      lastDebugAt = now
      debugOverlay.update(debug ? debugLines(now) : undefined)
    }
    timer.lap('ui')
    timer.end()
  }
  view.start(frame)

  // How hard each punched plant still sways, from 1 at the punch down to 0, forgetting those that have stopped.
  const shaking = (now: number): Map<number, number> => {
    const amounts = new Map<number, number>()
    for (const [id, at] of shakes) {
      const amount = 1 - (now - at) / SHAKE_MS
      if (amount > 0) amounts.set(id, amount)
      else shakes.delete(id)
    }
    return amounts
  }

  // The other players' footsteps: one each time one of them has walked STEP_DISTANCE (as drawn), sounding like the ground
  // they are on, from where they are, under the other players' volume.
  // Aboard a raft, where they are is kept on the raft (`raft`), so the raft carrying them is not walking.
  const remoteWalked = new Map<number, { x: number; y: number; raft: number; walked: number }>()
  const remoteSteps = (tick: number): void => {
    const seen = new Set<number>()
    for (const remote of remotes.positionsAt(tick)) {
      seen.add(remote.id)
      const raft = raftTracks.riders.get(remote.id) ?? 0
      const pose = raft ? raftTracks.poseAt(raft, tick) : undefined
      const at = pose ? toRaft(pose, remote) : remote
      const last = remoteWalked.get(remote.id)
      if (!last || last.raft !== raft) {
        remoteWalked.set(remote.id, { x: at.x, y: at.y, raft, walked: last?.walked ?? STEP_DISTANCE * 0.6 })
        continue
      }
      const moved = Math.hypot(at.x - last.x, at.y - last.y)
      last.x = at.x
      last.y = at.y
      // A jump (a knockback, being taken into the dungeon) is not walking.
      if (moved === 0 || moved > SUB) continue
      last.walked += moved
      if (last.walked < STEP_DISTANCE) continue
      last.walked = 0
      const surface = raftTracks.riders.has(remote.id) ? 'wood' : surfaceAt(mirror.terrain, tileOfUnits(remote.x), tileOfUnits(remote.y))
      sounds.play(footstep(surface), { ...tilesOf(remote), other: true })
    }
    for (const id of [...remoteWalked.keys()]) if (!seen.has(id)) remoteWalked.delete(id)
  }

  // A footstep each time the player has walked STEP_DISTANCE, sounding like the ground it is on, and a quiet rustle
  // every RUSTLE_DISTANCE while it pushes through a bush. Only how far it really went counts, so walking into a wall is
  // quiet.
  let walked = 0
  let rustled = 0
  const stepSounds = (): void => {
    // Aboard a raft, only walking about its deck counts (not the raft carrying them), and it sounds of wood.
    const aboard = local.aboard
    const before = local.previousAboard
    const onRaft = aboard !== undefined && before?.raft === aboard.raft
    const moved = onRaft ? Math.hypot(aboard.x - before.x, aboard.y - before.y) : Math.hypot(local.position.x - local.previous.x, local.position.y - local.previous.y)
    if (moved === 0) {
      // Stopping and starting again steps (and rustles) at once.
      walked = STEP_DISTANCE * 0.6
      rustled = RUSTLE_DISTANCE
      return
    }
    const tileX = tileOfUnits(local.position.x)
    const tileY = tileOfUnits(local.position.y)
    if (local.slow?.(tileX, tileY)) {
      rustled += moved
      if (rustled >= RUSTLE_DISTANCE) {
        rustled = 0
        sounds.play('rustle')
      }
    } else rustled = RUSTLE_DISTANCE
    walked += moved
    if (walked < STEP_DISTANCE) return
    walked -= STEP_DISTANCE
    sounds.play(footstep(aboard ? 'wood' : surfaceAt(mirror.terrain, tileX, tileY)))
  }

  // The items on the ground in view, with how long each has lain there (in ticks, between the last tick and the next).
  const visibleDrops = (alpha: number, now: number): DropView[] => {
    const bounds = view.visible()
    const found: DropView[] = []
    for (const chunkId of mirror.world.chunkIds) {
      const { cx, cy } = chunkCoords(chunkId)
      if ((cx + 1) * CHUNK_SIZE <= bounds.left || cx * CHUNK_SIZE > bounds.right + 1) continue
      if ((cy + 1) * CHUNK_SIZE <= bounds.top || cy * CHUNK_SIZE > bounds.bottom + 1) continue
      for (const drop of mirror.world.dropsInChunk(chunkId)) {
        if (inFog(drop.x / SUB, drop.y / SUB)) continue
        // What a creature just killed drops shows once it has fallen.
        const fresh = mirror.simTick - drop.born < 2 * TPS
        if (fresh && (animalTracks.fellNear(drop.x / SUB, drop.y / SUB, now) || monsterTracks.fellNear(drop.x / SUB, drop.y / SUB, now))) continue
        found.push({ id: drop.id, item: drop.item, x: drop.x / SUB, y: drop.y / SUB, age: mirror.simTick + alpha - drop.born })
      }
    }
    return found
  }

  // How far the open miner is through digging its next item, drawn between the factory's last tick and the next (the
  // way items glide on belts), so the bar fills smoothly whenever and however often the factory steps. A miner with a
  // full store is not digging, so its bar holds still.
  const workProgress = (alpha: number): number => {
    const opened = openBuilding !== undefined ? mirror.world.entity(openBuilding) : undefined
    const machine = opened ? machineProgress(opened, alpha) : undefined
    if (machine !== undefined) return machine
    if (!opened || opened.kind !== 'miner') return 0
    const digging = roomFor(opened.inv, opened.ore, 1) > 0
    return (opened.progress + (digging ? alpha : 0)) / getItem(opened.ore).mineTicks
  }

  // The debug view's hitboxes (F3): each body's round space, which no other body can stand in (players yellow, animals
  // blue, monsters red: see the server's bodies.ts), and round the player the solid parts of what stands on the ground,
  // as the player walks into them (magenta: a tree's trunk, a fence's rails, a whole rock). In tiles.
  const hitboxes = (x: number, y: number, tick: number): GroundMark[] => {
    const bodies = [{ x, y, half: PLAYER_HALF_SIZE, color: HITBOX_PLAYER }]
    for (const remote of remotes.positionsAt(tick)) bodies.push({ ...tilesOf(remote), half: PLAYER_HALF_SIZE, color: HITBOX_PLAYER })
    for (const { info, ...spot } of animalTracks.drawn()) bodies.push({ ...tilesOf(spot), half: animalDef(info.kind).halfSize, color: HITBOX_ANIMAL })
    for (const { info, ...spot } of monsterTracks.drawn()) bodies.push({ ...tilesOf(spot), half: monsterDef(info.kind).halfSize, color: HITBOX_MONSTER })
    return hitboxMarks(bodies, local.solid, { x, y }, HITBOX_REACH)
  }

  // The players' attacks being made (their swishes), and what is in flight.
  const attackView = (now: number, x: number, y: number, tick: number): AttackView => {
    for (let i = flashes.length - 1; i >= 0; i--) if (now - flashes[i].at > attackDurationMs(flashes[i].weapon, flashes[i].charged)) flashes.splice(i, 1)
    while (sparks.length > 0 && now - sparks[0].at > SPARK_MS) sparks.shift()
    while (numbers.length > 0 && now - numbers[0].at > NUMBER_MS) numbers.shift()
    const view: AttackView = { marks: [], swishes: [], shots: [], sparks: [], numbers: [] }
    // The swish behind each weapon as it swings, from where its player is now, tracing what the attack covers.
    const where = new Map(remotes.positionsAt(tick).map((remote) => [remote.id, tilesOf(remote)]))
    where.set(mirror.playerId, { x, y })
    for (const flash of flashes) {
      // A charged attack from where it was made (a dash leaves its streak behind); anything else following its player.
      const from = (flash.charged ? flash.from : undefined) ?? where.get(flash.id)
      const swish = from ? attackSwish(flash.weapon, from.x, from.y, flash.angle, now - flash.at, flash.charged) : undefined
      if (swish) view.swishes.push(swish)
    }
    // Monsters' attacks landing: a red swish where a skeleton's swing cut, a red streak along its dash.
    for (let i = monsterSwishes.length - 1; i >= 0; i--) if (now - monsterSwishes[i].at > MONSTER_SWISH_MS) monsterSwishes.splice(i, 1)
    for (const swish of monsterSwishes) {
      const attack = monsterDef(swish.monster).attack
      if (attack.kind !== 'blade') continue
      const progress = (now - swish.at) / MONSTER_SWISH_MS
      const base = { x: swish.x, y: swish.y, angle: swish.angle, inner: 0, distance: 0, tint: 0xff5a4a, progress }
      if (swish.kind === 'swing') view.swishes.push({ ...base, shape: 'arc', arc: attack.swing.arc, inner: 0.3, outer: (attack.swing.reach + PLAYER_HALF_SIZE) / SUB, width: 0 })
      else view.swishes.push({ ...base, shape: 'band', arc: 0, outer: attack.charge.distance / SUB, width: attack.charge.width / SUB })
    }
    for (const spark of sparks) view.sparks.push({ x: spark.x, y: spark.y, age: (now - spark.at) / SPARK_MS, color: spark.color })
    if (debug) view.marks.push(...hitboxes(x, y, tick))
    // A skeleton's attacks show nothing on the ground as they come (its pose and its sounds give them away); dust is
    // kicked up behind one dashing. The frost lich casting shows (see ground-marks.ts).
    const dust = now - lastDustAt > DUST_EVERY_MS
    if (dust) lastDustAt = now
    for (const { info, ...spot } of monsterTracks.drawn()) {
      const act = info.act
      if (!act) continue
      const attack = monsterDef(info.kind).attack
      const { x: cx, y: cy } = tilesOf(spot)
      const progress = actProgress(info, now)
      if (attack.kind === 'blade') {
        if (act.k === 'dash' && dust) sparks.push({ x: cx - Math.cos(act.angle) * 0.3, y: cy - Math.sin(act.angle) * 0.3, at: now, color: 0xb8a68a })
      }
      if (act.k === 'cast') view.marks.push(...castMarks(cx, cy, act.spell, progress))
    }
    // Each blizzard blowing.
    for (let i = blizzards.length - 1; i >= 0; i--) if (now > blizzards[i].until) blizzards.splice(i, 1)
    for (const blizzard of blizzards) {
      const fade = Math.min(1, (now - blizzard.at) / 250, (blizzard.until - now) / 400)
      view.marks.push(...blizzardMarks(blizzard.x, blizzard.y, blizzard.radius, fade, now))
    }
    for (const number of numbers) view.numbers.push({ x: number.x, y: number.y, text: number.text, age: (now - number.at) / NUMBER_MS })
    const present = new Set<number>()
    for (const shot of shotTracks.positionsAt(tick)) {
      present.add(shot.id)
      const item = shotItems.get(shot.id)
      const stopped = shotStopped.get(shot.id)
      // Drawn flying until the tick it stopped on (it is drawn in the past, so it reaches what it hit), then gone.
      if (item === undefined || (stopped !== undefined && tick >= stopped)) {
        // An icicle shatters where it lands.
        if (item === ICICLE && !shattered.has(shot.id)) {
          shattered.add(shot.id)
          sparks.push({ ...tilesOf(shot), at: now, color: 0xcfeaff })
          sounds.play('punch/stone', tilesOf(shot))
        }
        continue
      }
      if (item === ICICLE) {
        // Falling from above, over where it will land: a ring on the ground there, filling as it comes down.
        if (!shotSeen.has(shot.id)) shotSeen.set(shot.id, now)
        const fall = Math.min(1, (now - shotSeen.get(shot.id)!) / ICICLE_FALL_MS)
        const { x: landX, y: landY } = tilesOf(shot)
        view.marks.push(icicleMark(landX, landY, ICICLE_RING, fall))
        view.shots.push({ id: shot.id, item, x: landX, y: landY, angle: 0, fall })
        continue
      }
      view.shots.push({ id: shot.id, item, ...tilesOf(shot), angle: Math.atan2(shot.dy, shot.dx) })
    }
    for (const id of shotItems.keys()) {
      if (present.has(id)) continue
      shotItems.delete(id)
      shotStopped.delete(id)
      shotSeen.delete(id)
      shattered.delete(id)
    }
    return view
  }

  // The animals in view, as drawn on this frame (and those just killed, falling over), and which one is under the mouse.
  // Where a rope runs to from what is on it (tiles): the player leading it, or the post of the fence it is tied to.
  const ropeEnd = (leader: number, post: number, tick: number): { x: number; y: number } | undefined => {
    if (post !== 0) {
      const fence = mirror.world.entity(post)
      return fence ? { x: fence.x + 0.5, y: fence.y + 0.5 } : undefined
    }
    if (leader === 0) return undefined
    if (leader === mirror.playerId) return tilesOf(local.position)
    const remote = remotes.positionOf(leader, tick)
    return remote ? tilesOf(remote) : undefined
  }

  // The fences with an animal or a raft tied to them (drawn with the rope wound round them; a right click unties it).
  const tiedFences = (): Set<number> => {
    const tied = new Set<number>()
    for (const info of animalTracks.info.values()) if (info.post) tied.add(info.post)
    for (const rope of raftTracks.ropes.values()) if (rope.post) tied.add(rope.post)
    return tied
  }

  const animalViews = (tick: number, now: number): AnimalView[] => {
    const views: AnimalView[] = []
    const mouse = pointer && !pause.isOpen ? view.pick(pointer) : undefined
    let hovered: number | undefined
    let hoveredDistance = Number.POSITIVE_INFINITY
    for (const track of animalTracks.at(tick)) {
      if (inFog(track.x / SUB, track.y / SUB)) continue
      const { info } = track
      const def = animalDef(info.kind)
      const baby = info.growth < 100
      const view: AnimalView = {
        id: track.id,
        kind: info.kind,
        x: track.x / SUB,
        y: track.y / SUB,
        size: def.size,
        baby,
        facing: animalTracks.facingOf(track.id, Math.PI),
        hovered: false,
        hurt: animalTracks.isHurt(track.id, now),
        angry: info.angry === true,
        male: info.sex === 'm',
      }
      const leader = ropeEnd(info.leader, info.post ?? 0, tick)
      if (leader) view.leader = leader
      if (mouse) {
        const distance = Math.hypot(mouse.x - view.x, mouse.y - view.y)
        if (distance <= Math.max(0.45, def.size * (baby ? 0.35 : 0.55)) && distance < hoveredDistance) {
          hovered = track.id
          hoveredDistance = distance
        }
      }
      views.push(view)
    }
    hoveredAnimal = hovered
    for (const view of views) view.hovered = view.id === hovered
    for (const dead of animalTracks.falling(now)) {
      views.push({
        id: -dead.info.id,
        kind: dead.info.kind,
        x: dead.x,
        y: dead.y,
        size: animalDef(dead.info.kind).size,
        baby: dead.info.growth < 100,
        facing: dead.facing,
        hovered: false,
        hurt: true,
        angry: false,
        male: dead.info.sex === 'm',
        dying: dead.fall,
      })
    }
    return views
  }

  // How far through what a monster is doing it is, 0 to 1 (from when the page heard of it).
  const actProgress = (info: MonsterInfo, now: number): number => {
    const heard = actHeard.get(info.id)
    return info.act && heard ? Math.min(1, (now - heard.heardAt) / Math.max(1, info.act.ticks * TICK_MS)) : 0
  }

  // The monsters, drawn a little in the past like the animals, and those just killed falling over.
  const monsterViews = (tick: number, now: number): MonsterView[] => {
    const views: MonsterView[] = []
    for (const track of monsterTracks.at(tick)) {
      if (inFog(track.x / SUB, track.y / SUB)) continue
      const { info } = track
      const def = monsterDef(info.kind)
      // An attack faces its way; a boss, which never moves, faces the player.
      const act = info.act
      const facing =
        act && act.k !== 'cast' ? act.angle : def.boss ? Math.atan2(local.position.y - track.y, local.position.x - track.x) : monsterTracks.facingOf(track.id)
      views.push({
        id: track.id,
        kind: info.kind,
        x: track.x / SUB,
        y: track.y / SUB,
        size: def.size,
        facing,
        hurt: monsterTracks.isHurt(track.id, now),
        angry: info.angry === true && !def.boss,
        ...(act ? { act: { k: act.k, progress: actProgress(info, now), ...(act.k === 'cast' ? { spell: act.spell } : {}) } } : {}),
      })
    }
    for (const dead of monsterTracks.falling(now)) {
      views.push({ id: -dead.info.id, kind: dead.info.kind, x: dead.x, y: dead.y, size: monsterDef(dead.info.kind).size, facing: dead.facing, hurt: true, angry: false, dying: dead.fall })
    }
    return views
  }

  // A creature hurt (or killed) where it was drawn (units): the damage rising off it, a spark, and its cry, from there.
  const creatureHurt = (spot: { x: number; y: number }, amount: number, sound: SoundId): void => {
    const now = performance.now()
    numbers.push({ ...tilesOf(spot), text: `-${amount}`, at: now })
    sparks.push({ ...tilesOf(spot), at: now, color: 0xd9483b })
    sounds.play(sound, tilesOf(spot))
  }

  // The middle of a trap's floor in a copy of the dungeon, in tiles.
  const trapMiddle = (slot: number, index: number): { x: number; y: number } => {
    const tiles = DUNGEON_TRAPS[index].tiles
    const corner = dungeonCorner(slot)
    return {
      x: corner.x + tiles.reduce((sum, tile) => sum + tile.x, 0) / Math.max(1, tiles.length) + 0.5,
      y: corner.y + tiles.reduce((sum, tile) => sum + tile.y, 0) / Math.max(1, tiles.length) + 0.5,
    }
  }

  // The spike traps going off: set off, then up for a second (the server's TRAP_ACTIVE), then back down.
  const trapViews = (now: number): TrapView[] => {
    const views: TrapView[] = []
    for (const [key, fired] of trapsSetOff) {
      const since = now - fired.upAt
      if (since > TRAP_UP_MS + TRAP_DOWN_MS) {
        trapsSetOff.delete(key)
        continue
      }
      if (since >= 0 && !fired.sounded) {
        fired.sounded = true
        sounds.play('trap/spikes', trapMiddle(fired.slot, fired.trap))
      }
      const trap = DUNGEON_TRAPS[fired.trap]
      const corner = dungeonCorner(fired.slot)
      const world = (tile: { x: number; y: number }): { x: number; y: number } => ({ x: corner.x + tile.x, y: corner.y + tile.y })
      const up = since < 0 ? 0 : since < TRAP_RISE_MS ? since / TRAP_RISE_MS : since < TRAP_UP_MS ? 1 : 1 - (since - TRAP_UP_MS) / TRAP_DOWN_MS
      views.push({
        tiles: trap.tiles.map(world),
        ...(trap.wall ? { wall: { tiles: trap.wall.tiles.map(world), dir: trap.wall.dir } } : {}),
        up: Math.max(0, Math.min(1, up)),
        arming: since < 0,
      })
    }
    return views
  }

  // The altars in view in the middle of a ritual, or glowing after one (see ritual-timeline.ts for how it is shown).
  // Travelling by waystone: asks to go (held still at once, so what the server plays matches), unless already going.
  const travel = (from: number, to: number): void => {
    if (warps.has(mirror.playerId) || performance.now() < heldUntil) return
    const seq = send({ k: 'warp', id: from, to })
    if (seq === undefined) return
    warpSeq = seq
    warpTo = to
    heldUntil = performance.now() + WARP_TICKS * TICK_MS + WARP_GRACE_MS
  }

  // A waystone's panel: its name, and every other waystone, how far and which way.
  const waystoneView = (stone: WaystoneEntity): WaystoneView => ({
    id: stone.id,
    name: stone.name ?? '',
    destinations: waystoneList
      .filter((other) => other.id !== stone.id)
      .map((other) => ({
        id: other.id,
        title: waystoneTitle(other),
        distance: Math.round(Math.hypot(other.x - stone.x, other.y - stone.y)),
        direction: compassWay(other.x - stone.x, other.y - stone.y),
      })),
    travelling: warps.has(mirror.playerId) || performance.now() < heldUntil,
    ...(warpTo !== undefined ? { travellingTo: warpTo } : {}),
  })

  // Each player travelling by waystone, and how far through the charge; a warp never heard to end is forgotten.
  const warpViews = (now: number, playerX: number, playerY: number, remoteTick: number): WarpView[] => {
    const shown: WarpView[] = []
    for (const [id, warp] of warps) {
      if (now > warp.until + WARP_GRACE_MS) {
        warps.delete(id)
        continue
      }
      const spot = id === mirror.playerId ? { x: playerX, y: playerY } : remotes.positionOf(id, remoteTick)
      const player = spot ? (id === mirror.playerId ? spot : tilesOf(spot)) : undefined
      shown.push({ x: warp.from.x, y: warp.from.y, t: Math.min(1, Math.max(0, (now - warp.at) / (warp.until - warp.at))), ...(player ? { player } : {}) })
    }
    return shown
  }

  const warpFlashViews = (now: number): WarpFlashView[] => {
    for (let i = warpFlashes.length - 1; i >= 0; i--) if (now - warpFlashes[i].at > WARP_FLASH_MS) warpFlashes.splice(i, 1)
    return warpFlashes.map((flash) => ({ x: flash.x, y: flash.y, age: (now - flash.at) / WARP_FLASH_MS, arriving: flash.arriving, salt: flash.salt, stone: flash.stone }))
  }

  const ritualViews = (alpha: number): RitualView[] => {
    const bounds = view.visible()
    // Far enough out that the beams from pedestals and barrels in view are drawn.
    const margin = 3
    const found: RitualView[] = []
    for (const entity of mirror.world.ofKind('altar')) {
      if (entity.recipe === 0 && entity.glow === 0) continue
      if (entity.x < bounds.left - margin || entity.x > bounds.right + margin || entity.y < bounds.top - margin || entity.y > bounds.bottom + margin) continue
      const busy = entity.recipe !== 0
      found.push({
        id: entity.id,
        x: entity.x,
        y: entity.y,
        t: busy ? ritualFraction(entity, alpha) : 1,
        offerings: offeringsOf(entity.offerings),
        glow: busy ? 0 : Math.max(0, (entity.glow - alpha) / ALTAR_GLOW_TICKS),
      })
    }
    return found
  }

  const visibleBuildings = (remoteTick: number, rituals: readonly RitualView[]): BuildingView[] => {
    const bounds = view.visible()
    // The liquid a ritual has taken from a barrel but not yet drawn off on its beam: the barrel still shows it, draining
    // as it goes (by tile, "x,y").
    const undrawn = new Map<string, { liquid: number; buckets: number }>()
    for (const ritual of rituals) {
      const windows = offeringWindows(ritual.offerings)
      ritual.offerings.forEach((offering, i) => {
        if (!offering.liquid) return
        const spot = `${ritual.x + offering.dx},${ritual.y + offering.dy}`
        const left = offering.count * (1 - drawnAt(windows[i], ritual.t))
        const there = undrawn.get(spot)
        undrawn.set(spot, { liquid: offering.liquid, buckets: (there?.buckets ?? 0) + left })
      })
    }
    // Where the players are, in units, for opening gates.
    const walkers = [local.position, ...remotes.positionsAt(remoteTick)]
    const tied = tiedFences()
    const viewOf = (entity: Entity): BuildingView => {
      if (entity.kind === 'fence' || entity.kind === 'gate') {
        const connect = fenceMask((x, y) => mirror.world.entityAt(x, y)?.kind, entity.x, entity.y)
        const open = entity.kind === 'gate' && gateIsOpen(entity, walkers)
        return { ...entity, connect, open, ...(tied.has(entity.id) ? { tied: true } : {}) }
      }
      if ('lit' in entity) return { ...entity, lit: entity.lit === 1, ...(isSmoking(entity) ? { smoking: true } : {}) }
      if (entity.kind === 'barrel') {
        const plan = barrelPlan(entity)
        const composting = plan.ready && plan.recipe?.output === itemByKey('compost')?.id
        const drawing = undrawn.get(`${entity.x},${entity.y}`)
        const liquid = entity.amount > 0 ? entity.liquid : (drawing?.liquid ?? 0)
        const amount = Math.min(BARREL_CAPACITY, entity.amount + (drawing?.buckets ?? 0))
        return { ...entity, barrel: { sealed: entity.sealed === 1, liquid: LIQUIDS[liquid] ?? '', fill: amount / BARREL_CAPACITY, composting } }
      }
      if (entity.kind === 'pedestal' || entity.kind === 'altar') {
        const on = entity.inv.slots[0]
        return isFilled(on) ? { ...entity, shown: on.item } : entity
      }
      if (entity.kind === 'rack') {
        const rack = entity.inv.slots[RACK_OUTPUT].count > 0 ? 'done' : entity.inv.slots[RACK_INPUT].count > 0 ? 'drying' : 'empty'
        return { ...entity, rack }
      }
      if (entity.kind === 'stump' || entity.kind === 'workbench') {
        const tool = entity.inv.slots[STATION_LAYOUT[entity.kind].tool]
        return isFilled(tool) ? { ...entity, tool: tool.item } : entity
      }
      if (entity.kind === 'plot') {
        const stage = entity.crop !== 0 ? cropStage(entity.crop, entity.growth) : undefined
        return stage !== undefined ? { ...entity, cropStage: stage, water: entity.water } : { ...entity, water: entity.water }
      }
      return entity
    }
    // Wide enough that a tree whose canopy reaches into view is drawn.
    const margin = 1
    const found: BuildingView[] = []
    for (const chunkId of mirror.world.chunkIds) {
      const { cx, cy } = chunkCoords(chunkId)
      if ((cx + 1) * CHUNK_SIZE <= bounds.left - margin || cx * CHUNK_SIZE > bounds.right + margin) continue
      if ((cy + 1) * CHUNK_SIZE <= bounds.top - margin || cy * CHUNK_SIZE > bounds.bottom + margin) continue
      for (const entity of mirror.world.chunk(chunkId)!.entities) {
        if (entity.x < bounds.left - margin || entity.x > bounds.right + margin) continue
        if (entity.y < bounds.top - margin || entity.y > bounds.bottom + margin) continue
        if (inFog(entity.x, entity.y)) continue
        found.push(viewOf(entity))
      }
    }
    return found
  }

  // A player's pose while their latest attack is still being made (and this player's while they charge one).
  const poseOf = (id: number, now: number): PlayerPose | undefined => {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const flash = flashes[i]
      if (flash.id !== id) continue
      if (now - flash.at < attackDurationMs(flash.weapon, flash.charged)) return attackPose(flash.weapon, now - flash.at, flash.charged)
      break
    }
    if (id === mirror.playerId && charging) return chargePose(charging.weapon, now - charging.since, chargeMs(charging.weapon))
    return undefined
  }
  // A spin turns its player round and round.
  const spunFacing = (facing: number, pose: PlayerPose | undefined): number =>
    pose?.kind === 'spin' ? facing + pose.progress * pose.turns * Math.PI * 2 : facing
  // A player just hurt flickers while they cannot be hurt again (see HURT_GRACE_TICKS).
  const blinking = (id: number, now: number): boolean => {
    const since = now - (playerHitAt.get(id) ?? Number.NEGATIVE_INFINITY)
    return since < HURT_GRACE_TICKS * TICK_MS && Math.floor(since / BLINK_MS) % 2 === 1
  }

  const players = (x: number, y: number, remoteTick: number, now: number): PlayerView[] => {
    const list: PlayerView[] = []
    if (placed) {
      const inventory = predictedInventory()
      const holding = inventory.slots[selectedSlot]
      const me: PlayerView = {
        id: mirror.playerId,
        name: roster.get(mirror.playerId) ?? name,
        x: x / SUB,
        y: y / SUB,
        facing: local.facing,
        local: true,
        held: holding && holding.count > 0 ? holding.item : 0,
        armor: [0, 1, 2].map((i) => {
          const worn = inventory.slots[ARMOR_SLOT + i]
          return worn && worn.count > 0 ? worn.item : 0
        }),
      }
      // Its arms, making an attack.
      const pose = poseOf(mirror.playerId, now)
      if (pose) {
        me.pose = pose
        me.facing = spunFacing(me.facing, pose)
      }
      if (now - (playerHitAt.get(mirror.playerId) ?? Number.NEGATIVE_INFINITY) < SHAKE_MS) me.hurt = true
      if (blinking(mirror.playerId, now)) me.blink = true
      list.push(me)
    }
    const present = new Set<number>()
    for (const remote of remotes.positionsAt(remoteTick)) {
      present.add(remote.id)
      if (inFog(remote.x / SUB, remote.y / SUB)) continue
      // Facing the way it is going, or the way it last went; aboard a raft, the way it last walked on the raft, turning
      // as the raft turns.
      const raft = raftTracks.riders.get(remote.id)
      const raftPose = raft !== undefined ? raftTracks.poseAt(raft, remoteTick) : undefined
      let facing: number
      if (raftPose) {
        const on = toRaft(raftPose, remote)
        const was = remoteOnRaft.get(remote.id)
        if (was && was.raft === raft && Math.hypot(on.x - was.x, on.y - was.y) > 1) remoteFacing.set(remote.id, Math.atan2(on.y - was.y, on.x - was.x))
        if (!was || was.raft !== raft) remoteFacing.set(remote.id, (remoteFacing.get(remote.id) ?? Math.PI / 2) - raftPose.angle)
        remoteOnRaft.set(remote.id, { raft: raft!, ...on })
        facing = (remoteFacing.get(remote.id) ?? Math.PI / 2) + raftPose.angle
      } else {
        const was = remoteOnRaft.get(remote.id)
        if (was) {
          // Just stepped off: facing the same way in the world as on the raft.
          const left = raftTracks.poseAt(was.raft, remoteTick)
          remoteFacing.set(remote.id, (remoteFacing.get(remote.id) ?? Math.PI / 2) + (left?.angle ?? 0))
          remoteOnRaft.delete(remote.id)
        }
        if (remote.dx !== 0 || remote.dy !== 0) remoteFacing.set(remote.id, Math.atan2(remote.dy, remote.dx))
        facing = remoteFacing.get(remote.id) ?? Math.PI / 2
      }
      const hurt = now - (playerHitAt.get(remote.id) ?? Number.NEGATIVE_INFINITY) < SHAKE_MS
      const theirs = gear.get(remote.id)
      const pose = poseOf(remote.id, now)
      list.push({
        id: remote.id,
        name: roster.get(remote.id) ?? '',
        x: remote.x / SUB,
        y: remote.y / SUB,
        facing: spunFacing(facing, pose),
        local: false,
        ...(hurt ? { hurt } : {}),
        ...(blinking(remote.id, now) ? { blink: true } : {}),
        ...(theirs ? { held: theirs.held, armor: theirs.armor } : {}),
        ...(pose ? { pose } : {}),
      })
    }
    for (const id of remoteFacing.keys()) if (!present.has(id)) remoteFacing.delete(id)
    for (const id of remoteOnRaft.keys()) if (!present.has(id)) remoteOnRaft.delete(id)
    return list
  }

  const overlay = (buildings: readonly BuildingView[]): OverlayView => {
    // Holding a weapon or tool, a click is an attack the way the mouse points, not at a tile: no tile lights up.
    const hover = pointer && !pause.isOpen && heldWeapon().key === 'hand' ? tileUnderPointer() : undefined
    const target = hover && hoveredAnimal === undefined && !inFog(hover.x, hover.y) ? punchable(hover.x, hover.y) : undefined
    // With something that can be put down in the picked slot, a ghost of it under the mouse, red where it cannot go.
    let ghost: GhostView | undefined
    let raftGhost: OverlayView['raftGhost']
    if (hover && !target && welcomed) {
      const inventory = predictedInventory()
      const held = inventory.slots[selectedSlot]
      const kind = held && held.count > 0 ? getItem(held.item).places : undefined
      if (held && held.count > 0 && isRaftItem(held.item)) {
        const spot = raftSpot(hover.x, hover.y)
        raftGhost = 'pose' in spot ? { x: spot.pose.x / SUB, y: spot.pose.y / SUB, valid: true } : { x: hover.x + 0.5, y: hover.y + 0.5, valid: false }
      }
      if (kind) {
        const valid = !prediction.occupies(hover.x, hover.y) && checkPlace(mirror.world, local.position, inventory, selectedSlot, hover.x, hover.y, mirror.terrain).ok
        ghost = { kind, x: hover.x, y: hover.y, dir: 0, valid }
      }
    }
    const bars: Array<OverlayView['bars'][number]> = []
    for (const building of buildings) {
      // Whatever is broken a little at a time (not what goes at a hit).
      if (!(BUILDINGS[building.kind].natural || BUILDINGS[building.kind].breakable) || BUILDINGS[building.kind].maxHp <= 1) continue
      const entity = mirror.world.entity(building.id)
      if (!entity) continue
      const max = BUILDINGS[entity.kind].maxHp
      const left = hpOf(entity)
      if (left < max && left > 0) bars.push({ x: entity.x, y: entity.y, fraction: left / max, tall: entity.kind === 'tree' })
    }
    const removing: Array<{ x: number; y: number }> = []
    for (const id of prediction.removals()) {
      const entity = mirror.world.entity(id)
      if (entity) removing.push({ x: entity.x, y: entity.y })
    }
    const opened = openBuilding !== undefined ? mirror.world.entity(openBuilding) : undefined
    // A named chest under the mouse shows its name.
    const hovered = hover ? mirror.world.entityAt(hover.x, hover.y) : undefined
    const named = hovered?.kind === 'chest' && hovered.name ? { x: hovered.x, y: hovered.y, name: hovered.name } : undefined
    return {
      ...(hover ? { hover } : {}),
      ...(target ? { target: { x: target.x, y: target.y } } : {}),
      ...(ghost ? { ghost } : {}),
      ...(raftGhost ? { raftGhost } : {}),
      pending: prediction.builds(playerInventory).map((build) => ({ ...build, valid: true })),
      removing,
      bars,
      ...(opened ? { selected: { x: opened.x, y: opened.y } } : {}),
      ...(named ? { label: { x: named.x, y: named.y, text: named.name } } : {}),
    }
  }

  // ---- the page's elements, ten times a second

  // Whether the list of who is playing is held open (Tab).
  let showingPlayers = false

  // The map: explored as the player goes, and drawn while it is open (see map-view.ts).
  const updateMap = (): void => {
    if (!mirror.terrain || !placed) return
    const me = { ...tilesOf(local.position), facing: local.facing }
    map.update({
      terrain: mirror.terrain,
      key: `${mirror.seed}:${worldName}:${name}`,
      me,
      others: remotes
        .positionsAt(lastRemoteTick)
        .filter((remote) => !isInDungeons(tileOfUnits(remote.x), tileOfUnits(remote.y)) && !inFog(remote.x / SUB, remote.y / SUB))
        .map((remote) => ({ ...tilesOf(remote), name: roster.get(remote.id) ?? '?' })),
      away: isInDungeons(tileOfUnits(local.position.x), tileOfUnits(local.position.y)),
      loadedChunks: mirror.world.chunkIds,
      things: (chunk) => mirror.world.chunk(chunk)?.entities ?? [],
      fogLifted: truesight,
    })
  }

  const updateUi = (): void => {
    updateMap()
    hud.showPlayers(
      showingPlayers && !pause.isOpen
        ? {
            title: solo ? worldName : `${worldName} · ${code}`,
            players: [...roster.entries()]
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, playerName]) => ({ name: playerName, you: id === mirror.playerId, host: playerName.toLowerCase() === room.host.toLowerCase() })),
          }
        : undefined,
    )
    hud.update({
      code: solo ? worldName : `${worldName} · ${code}`,
      players: [...roster.values()],
      pingMs: connection.clock.ready ? connection.clock.rttMs : undefined,
    })
    const predicted = prediction.predictInventories(playerInventory, mirror.world)
    // A boss that is after someone: its name and health over the top of the screen.
    const boss = [...monsterTracks.info.values()].find((info) => monsterDef(info.kind).boss && info.angry)
    bossBar.hidden = !boss
    if (boss) {
      const def = monsterDef(boss.kind)
      if (bossName.textContent !== def.name) bossName.textContent = def.name
      bossFill.style.transform = `scaleX(${Math.max(0, Math.min(1, boss.hp / boss.maxHp))})`
      const hpText = `${Math.max(0, boss.hp)} / ${boss.maxHp}`
      if (bossHp.textContent !== hpText) bossHp.textContent = hpText
      if (bossNotchesFor !== boss.maxHp) {
        bossNotchesFor = boss.maxHp
        bossNotches.replaceChildren()
        for (let at = BOSS_NOTCH; at < boss.maxHp; at += BOSS_NOTCH) {
          const notch = element('i')
          notch.style.left = `${(at / boss.maxHp) * 100}%`
          bossNotches.append(notch)
        }
      }
    }
    // The server is told which slot the player holds, so the others see it in their hand.
    if (welcomed && holdSent !== selectedSlot) {
      holdSent = selectedSlot
      send({ k: 'hold', slot: selectedSlot })
    }
    hotbar.update({
      slots: predicted.player.slots.slice(0, HOTBAR_SLOTS),
      selected: selectedSlot,
      keys: HOTBAR_ACTIONS.map((action) => settings.keyLabel(action)),
      health,
      body: bodyTenths / 10,
      food: predicted.player.slots[FOOD_SLOT] ?? { item: NO_ITEM, count: 0 },
      foodKey: settings.keyLabel('eat'),
      foodReady: 1 - Math.max(0, eatReadyAt - performance.now()) / (EAT_COOLDOWN_TICKS * TICK_MS),
    })
    const opened = openBuilding !== undefined ? mirror.world.entity(openBuilding) : undefined
    if (openBuilding !== undefined && (!opened || !hasInventory(opened))) openBuilding = undefined
    // Walked off well out of reach of what is open: it closes.
    if (opened && openBuilding !== undefined && Math.sqrt(distanceToTileSquared(local.position.x, local.position.y, opened.x, opened.y)) > PLAYER_REACH * CLOSE_AWAY) closePanels()
    panels.show(inventoryOpen || opened ? panelsView(opened, predicted) : undefined)
    // A waystone's panel: closed when it is gone or walked away from (or arrived away from).
    const stone = openWaystone !== undefined ? mirror.world.entity(openWaystone) : undefined
    const stoneOpen = stone?.kind === 'waystone' && Math.sqrt(distanceToTileSquared(local.position.x, local.position.y, stone.x, stone.y)) <= PLAYER_REACH * CLOSE_AWAY
    if (!stoneOpen) openWaystone = undefined
    waystonePanel.show(stoneOpen && stone.kind === 'waystone' ? waystoneView(stone) : undefined)
    // A work station only works while someone has it open, so the server is told which one this player has.
    const using = opened && isStation(opened) ? opened.id : 0
    // And whether its inventory is open with nothing else, which hand crafting only goes on while.
    const hand = inventoryOpen && !opened
    if (using !== usingStation || hand !== handOpen) {
      usingStation = using
      handOpen = hand
      send({ k: 'use', id: using, ...(hand ? { hand: true as const } : {}) })
    }
  }
  let usingStation = 0
  let handOpen = false

  // A machine's button: a campfire's Light and Put out, a barrel's Seal and Unseal. (A station's Craft is under each of
  // its recipes: see `machineRecipe`.)
  const pressMachine = (id: number, buttonId: string): void => {
    if (buttonId === 'light' || buttonId === 'douse' || buttonId === 'seal' || buttonId === 'unseal') send({ k: 'machine', id, action: buttonId })
  }

  // How many times over the player has what a recipe takes (each input `need` of it: an item, or any of a kind), up to
  // `times`.
  const timesAfford = (player: Inventory, inputs: ReadonlyArray<readonly [Match, number]>, times: number): number =>
    Math.min(times, ...inputs.map(([match, need]) => Math.floor(countMatching(player, match) / need)))

  // The Craft button under a station's recipe (the stump's or the workbench's, which work alike): what it takes for
  // `times` more (or as many as the player has, with Infinity) goes in from the player's inventory, and it starts; the
  // tool it needs goes into its tool slot (the server swaps it in, and gives back any other tool there). It keeps going
  // while what is in it is enough.
  const machineRecipe = (id: number, index: number, times: number): void => {
    const machine = mirror.world.entity(id)
    if (machine?.kind === 'altar') return startRitual(machine, index)
    if (!machine || !isStation(machine)) return
    const recipe = STATION_RECIPES[machine.kind][index]
    if (!recipe) return
    // Busy making something else (that carries on); what it would make has nowhere to go (the output slot holds
    // something else, or is full); nothing to make it from; or the tool it needs neither there nor on the player: it
    // does not start.
    const station = prediction.predictInventories(playerInventory, mirror.world).buildings.get(id) ?? machine.inv
    const player = predictedInventory()
    if (machine.active !== 0 && machine.recipe - 1 !== index) return craftFailed()
    if (!fitsIn(station, STATION_LAYOUT[machine.kind].output, recipe.output, recipe.count)) return craftFailed()
    const ready = recipe.inputs.every(([item, need]) => stationHas(machine.kind, station, item) >= need)
    if (timesAfford(player, oneKindEach(machine.kind, station, player, recipe.inputs), times) === 0 && !ready) return craftFailed()
    if (recipe.tool && stationTool(machine.kind, station) !== recipe.tool && !player.slots.some((slot) => slot.count > 0 && getItem(slot.item).tool === recipe.tool)) {
      return craftFailed()
    }
    sounds.play(craftSound(times))
    // As many more as the player has of each ingredient, each one kind only (see `oneKindEach`), in it they go.
    const inputs = oneKindEach(machine.kind, station, player, recipe.inputs)
    const more = timesAfford(player, inputs, times)
    if (more > 0) for (const [item, need] of inputs) if (typeof item === 'number') send({ k: 'put', id, item, max: need * more })
    send({ k: 'work', id, recipe: index })
  }

  // What is on the pedestals and in the barrels round an altar.
  const surroundingsOf = (altar: Entity): ReturnType<typeof altarSurroundings> => altarSurroundings(altar.x, altar.y, (x, y) => mirror.world.entityAt(x, y))

  // The Craft button under one of an altar's rituals: it starts if everything it takes is round the altar, nothing else is
  // under way there, and there is room on it for what it makes (the server takes it all, and the altar does the rest,
  // and does it again while it can).
  const startRitual = (altar: Extract<Entity, { kind: 'altar' }>, index: number): void => {
    const recipe = ALTAR_RECIPES[index]
    if (!recipe || altarBusy(altar) || !altarRoomFor(altar, recipe) || !planRitual(recipe, surroundingsOf(altar))) return craftFailed()
    sounds.play('craft/one')
    send({ k: 'work', id: altar.id, recipe: index })
  }

  // A hand recipe, `times` times (as many as the player can make, with Infinity).
  const craftByHand = (index: number, times: number): void => {
    const recipe = getRecipe(index)
    if (!recipe) return
    const inventory = predictedInventory()
    const count = timesAfford(inventory, recipe.inputs, times)
    if (count === 0 || roomFor(inventory, recipe.output, recipe.count) < recipe.count) return craftFailed()
    sounds.play(craftSound(times))
    for (let i = 0; i < count; i++) send({ k: 'craft', recipe: index })
  }

  // Eats one of what is in the food slot, if the cooldown is over and the player is hurt (else just a sound). Food that
  // hurts (a truesight flesh) is eaten whatever the player's health, so long as it would not knock them out (else they
  // are told why not).
  let eatReadyAt = 0
  const eat = (): void => {
    const held = predictedInventory().slots[FOOD_SLOT]
    const food = held && held.count > 0 ? getItem(held.item) : undefined
    const now = performance.now()
    if (!food || (!food.heals && !food.hurts) || now < eatReadyAt) return void sounds.play('craft/fail')
    if (food.hurts !== undefined && health <= food.hurts) {
      hud.toast(REFUSALS.wouldKill, 'error')
      return void sounds.play('craft/fail')
    }
    if (!food.hurts && health >= PLAYER_MAX_HEALTH) return void sounds.play('craft/fail')
    send({ k: 'eat', slot: FOOD_SLOT })
    eatReadyAt = now + EAT_COOLDOWN_TICKS * TICK_MS
    if (food.truesight) expectingSight = true
    sounds.play('eat')
  }

  // Sleeps in a sleeping bag: the screen dims for a moment, and the player will wake up here.
  const sleepIn = (id: number): void => {
    send({ k: 'sleep', id })
    sounds.play('sleep')
    const dim = document.createElement('div')
    dim.className = 'sleep-fade'
    stage.append(dim)
    setTimeout(() => dim.remove(), 1600)
    hud.toast('Spawn point set.')
  }

  // A craft that cannot be done: its sound, and nothing more.
  const craftFailed = (): void => sounds.play('craft/fail')
  // The sound of a craft: one (a click), some (shift: five), or all you can (ctrl).
  const craftSound = (times: number): SoundId => (times === 1 ? 'craft/one' : Number.isFinite(times) ? 'craft/some' : 'craft/all')

  // The hand recipes (the "player" station in stations.json), grouped by category.
  const craftingBook = (player: Inventory): BookEntry[] => {
    const categories = [...new Set(RECIPES.map((recipe) => recipe.category))]
    return [...RECIPES]
      .sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category))
      .map((recipe) => ({
        id: recipe.id,
        category: recipe.category,
        output: recipe.output,
        count: recipe.count,
        inputs: recipe.inputs.map(([item, need]) => ({ item, need, have: countOf(player, item) })),
        ready: canAfford(player, recipe),
      }))
  }

  // What is being made by hand, as the server last said (see StateMessage's `c`), moved on by the time since.
  const handCrafting = (): PanelsView['crafting'] => {
    if (!craftState) return undefined
    const recipe = getRecipe(craftState.recipe)
    if (!recipe) return undefined
    return { name: getItem(recipe.output).name, fraction: handFraction(), queued: craftState.queued }
  }
  // How far along it is (0 to 1), drawn every frame (see `setHandProgress`).
  const handFraction = (): number => {
    const recipe = craftState ? getRecipe(craftState.recipe) : undefined
    if (!recipe) return 0
    return Math.min(1, craftElapsed(performance.now()) / Math.ceil(recipe.ticks / PLAYER_CRAFT_SPEED))
  }

  const panelsView = (opened: Entity | undefined, predicted: ReturnType<Prediction['predictInventories']>): PanelsView => {
    if (!opened || !hasInventory(opened)) {
      return { player: predicted.player.slots, selected: selectedSlot, recipes: craftingBook(predicted.player), ...(handCrafting() ? { crafting: handCrafting() } : {}) }
    }
    const def = BUILDINGS[opened.kind]
    return {
      player: predicted.player.slots,
      selected: selectedSlot,
      building: {
        id: opened.id,
        kind: opened.kind,
        title: def.name,
        ...(opened.kind === 'chest' && opened.name ? { name: opened.name } : {}),
        slots: (predicted.buildings.get(opened.id) ?? opened.inv).slots,
        ...(opened.kind === 'miner' ? { mining: { item: opened.ore } } : {}),
        ...machinePanel(opened, predicted.player, predicted.buildings.get(opened.id) ?? opened.inv),
        acceptsDeposits: def.acceptsDeposits,
        inReach: isWithinReach(local.position, opened.x, opened.y),
        ...(opened.kind === 'barrel' && opened.sealed ? { locked: true } : {}),
        ...(chestGuarded(opened) ? { locked: true, guarded: true } : {}),
      },
    }
  }

  // Whether a chest is a dungeon's with its lich still standing in its copy (the server keeps it shut till it falls).
  const chestGuarded = (opened: Entity): boolean => {
    const slot = dungeonSlotAt(opened.x, opened.y)
    if (opened.kind !== 'chest' || slot === undefined) return false
    for (const { info, x, y } of monsterTracks.drawn()) if (monsterDef(info.kind).boss && dungeonSlotAt(tileOfUnits(x), tileOfUnits(y)) === slot) return true
    return false
  }

  const machinePanel = (opened: Entity, player: Inventory, inv: Inventory): { machine?: MachineView } => {
    const machine = machineView(opened, player, inv, opened.kind === 'altar' ? surroundingsOf(opened) : undefined)
    return machine ? { machine } : {}
  }

  // ---- the debug view

  const debugView = (): DebugView => {
    const bounds = view.visible()
    const inView = (tile: { x: number; y: number }): boolean =>
      tile.x >= bounds.left && tile.x <= bounds.right && tile.y >= bounds.top && tile.y <= bounds.bottom
    const links: Array<DebugView['links'][number]> = []
    for (const id of mirror.world.linkIds) {
      const link = mirror.world.link(id)!
      const ends = linkEnds(link)
      if (ends && (inView(ends.from) || inView(ends.to))) links.push({ ...ends, remote: ends.remote, blocked: link.blocked })
    }
    return { chunks: mirror.world.chunkIds, desynced: [...mirror.desynced], links }
  }

  // Where a link's two ends are. Where this page has only one end, the other is worked out from which way it faces.
  const linkEnds = (link: Link): { from: { x: number; y: number }; to: { x: number; y: number }; remote: boolean } | undefined => {
    const from = mirror.world.entity(link.from)
    const to = mirror.world.entity(link.to)
    if (from && to) return { from, to, remote: false }
    if (from && isBeltLike(from)) return { from, to: { x: from.x + DIR_X[from.dir], y: from.y + DIR_Y[from.dir] }, remote: true }
    if (to && isBeltLike(to)) {
      const side = link.entry === 'back' ? opposite(to.dir) : link.entry === 'left' ? rotateCCW(to.dir) : rotateCW(to.dir)
      return { from: { x: to.x + DIR_X[side], y: to.y + DIR_Y[side] }, to, remote: true }
    }
    return undefined
  }

  const debugLines = (now: number): string[] => {
    const clock = connection.clock
    let remoteLinks = 0
    for (const id of mirror.world.linkIds) {
      const link = mirror.world.link(id)!
      if (!mirror.world.entity(link.from) || !mirror.world.entity(link.to)) remoteLinks++
    }
    const serverTick = clock.ready ? Math.floor(clock.serverTick(now)) : 0
    const lag = connection.lag
    return [
      `server tick   ~${serverTick}`,
      `world tick    ${mirror.simTick}  (${serverTick - mirror.simTick} behind, log to ${mirror.through})`,
      `rtt           ${Math.round(clock.rttMs)} ms`,
      `chunks        ${mirror.world.chunkIds.length} simulated`,
      `links         ${mirror.world.linkIds.length} (${remoteLinks} take the server's word)`,
      `desyncs       ${mirror.desyncs}${mirror.desynced.size ? ` (${mirror.desynced.size} waiting)` : ''}`,
      `commands      ${prediction.size} waiting`,
      `position      ${(local.position.x / SUB).toFixed(1)}, ${(local.position.y / SUB).toFixed(1)}`,
      `view          ${view.describe()}, zoom ${zoom.toFixed(2)}×`,
      `drawn         ${view.stats().calls} draw calls, ${Math.round(view.stats().triangles / 1000)}k triangles`,
      ...timer.lines(),
      ...(lag.latencyMs || lag.jitterMs || lag.loss ? [`lag sim       ${lag.latencyMs} ms +${lag.jitterMs} jitter, ${Math.round(lag.loss * 100)}% loss`] : []),
      ...(import.meta.env.DEV ? ['F9            break a chunk here, to test desync repair'] : []),
      `animals       ${animalTracks.info.size} near, monsters ${monsterTracks.info.size}`,
      ...animalLines(),
      ...plotLines(),
    ]
  }

  // The garden plot under the mouse: its crop, and how watered it is.
  const plotLines = (): string[] => {
    const hover = pointer ? tileUnderPointer() : undefined
    const plot = hover ? mirror.world.entityAt(hover.x, hover.y) : undefined
    if (plot?.kind !== 'plot') return []
    const crop = getCrop(plot.crop)
    const grown = crop ? `${crop.name} ${Math.floor((plot.growth * 100) / growthNeeded(crop.growTicks))}% grown` : 'nothing planted'
    return ['', `Garden plot   ${grown}`, plot.water > 0 ? `watered (${Math.ceil((plot.water * WATER_FALL_EVERY) / TPS)} s left)` : 'dry']
  }

  // The animal under the mouse, and its genetics.
  const animalLines = (): string[] => {
    const info = hoveredAnimal !== undefined ? animalTracks.info.get(hoveredAnimal) : undefined
    if (!info) return []
    const def = animalDef(info.kind)
    const leader = info.leader ? (roster.get(info.leader) ?? `player ${info.leader}`) : 'nobody'
    return [
      '',
      `${def.name} #${info.id}   ${info.sex === 'f' ? 'female' : 'male'}, ${info.growth < 100 ? `baby (${info.growth}% grown)` : 'adult'}`,
      `doing         ${info.doing}`,
      `hp ${info.hp}/${def.hp}   hunger ${info.hunger}% (hungry at ${Math.round((def.life.hungryAt * 100) / 1000)}%)   ${info.fed ? 'well fed' : 'not well fed'}   led by ${leader}`,
      ...(def.milk !== undefined ? [`milk          ${info.milk} ready`] : []),
      ...def.stats.map((stat, i) => `${stat.label.padEnd(18)}${info.stats[i]}   (wild ${stat.base} ± ${stat.spread})`),
    ]
  }

  // ---- leaving

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    clearTimeout(connectTimer)
    connection.close()
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('contextmenu', onContextMenu)
    disposeTooltips()
    map.dispose()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('pointerdown', unlockSound, true)
    window.removeEventListener('keydown', unlockSound, true)
    unsubscribeSettings()
    pause.dispose()
    panels.dispose()
    snow.dispose()
    frost.dispose()
    sounds.dispose()
    view.destroy()
  }
  const leave = (message?: string, isError = false): void => {
    if (disposed) return
    dispose()
    onLeave(message, isError)
  }

  return dispose
}

// Whether every number in a value is a finite number.
function finiteThroughout(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(finiteThroughout)
  if (value && typeof value === 'object') return Object.values(value).every(finiteThroughout)
  return true
}

// How far a crop that has grown `growth` of what it needs has got, as one of the 3D models' CROP_GROWTH_STAGES (the
// last only once it is fully grown), or undefined for no crop.
function cropStage(cropId: number, growth: number): number | undefined {
  const crop = getCrop(cropId)
  if (!crop) return undefined
  const needed = growthNeeded(crop.growTicks)
  const last = CROP_GROWTH_STAGES - 1
  return growth >= needed ? last : Math.min(last - 1, Math.floor((growth / needed) * last))
}
