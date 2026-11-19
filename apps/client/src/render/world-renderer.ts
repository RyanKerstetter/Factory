import { Container } from 'pixi.js'
import type { BeltShape, BuildingKind, Direction, ItemId } from '../../../../packages/shared/src/index.ts'
import { cameraTransform, visibleTiles, type Camera } from '../camera.ts'
import type { Art } from './art.ts'
import { AnimalLayer } from './animal-layer.ts'
import { AttackLayer } from './attack-layer.ts'
import { BuildingLayer } from './building-layer.ts'
import { DebugLayer } from './debug-layer.ts'
import { DropLayer } from './drop-layer.ts'
import { GroundLayer } from './ground-layer.ts'
import { ItemLayer } from './item-layer.ts'
import { OverlayLayer } from './overlay-layer.ts'
import { PlayerLayer } from './player-layer.ts'

// Everything the world is drawn from on one frame, as plain data worked out by game.ts, so nothing here knows about
// the network or the simulation. Positions are in tiles.

export type LaneItemView = { item: ItemId; pos: number; prev: number }
export type BuildingView = {
  id: number
  kind: BuildingKind
  x: number
  y: number
  dir: Direction
  // How a belt is laid, and the items on it.
  shape?: BeltShape
  lane?: readonly LaneItemView[]
  // How far a sapling has grown.
  stage?: number
  // A fence or gate: which of its neighbours it joins up with (FENCE_N, FENCE_E, FENCE_S, FENCE_W added together).
  connect?: number
  // A gate: whether it is open (a player is going through it).
  open?: boolean
  // A garden plot: the picture of what grows in it, if anything (see `cropArt`).
  cropArt?: string
  // A campfire: whether it is burning.
  lit?: boolean
  // A stump: the tool in its tool slot (its item), shown stuck in it.
  tool?: ItemId
  // Something stuck in the ground (a piece of flint, a thrown spear): what it is.
  item?: ItemId
  // A barrel: whether it is sealed, the liquid in it (by name, '' for none) and how full it is (0 to 1), and whether it
  // is making compost.
  barrel?: { sealed: boolean; liquid: string; fill: number; composting: boolean }
  // A drying rack: nothing on it, a hide drying, or a dried hide waiting to be taken.
  rack?: 'empty' | 'drying' | 'done'
  // A garden plot: how watered it is, 0 to 100.
  water?: number
}
// The player's attacks, in tiles: shapes on the ground (what the attack being held covers, and the flash of one
// landing), each a set of polygons with its colour and how strongly it is filled and outlined; what is in flight; sparks
// where things were hit; and damage numbers rising off animals (`age` 0 to 1 as each fades).
export type AttackView = {
  marks: Array<{ polygons: Array<Array<{ x: number; y: number }>>; color: number; fill: number; stroke: number }>
  shots: Array<{ id: number; item: number; x: number; y: number; angle: number }>
  sparks: Array<{ x: number; y: number; age: number; color: number }>
  numbers: Array<{ x: number; y: number; text: string; age: number }>
}
// An animal, in tiles. `size` is how big a grown one of its kind is drawn; `leader` is where the player leading it on a
// rope is; `hurt` while it has just been hit.
export type AnimalView = {
  id: number
  kind: string
  x: number
  y: number
  size: number
  baby: boolean
  facingLeft: boolean
  // Which way it last walked, in radians (as a player's `facing`).
  facing: number
  hovered: boolean
  hurt: boolean
  leader?: { x: number; y: number }
}
// `facing` is which way the player looks, in radians: 0 is east, a quarter turn (π/2) is south.
// An item on the ground, in tiles, and how many ticks it has lain there (for its landing hop).
export type DropView = { id: number; item: ItemId; x: number; y: number; age: number }
// `swing` is how far through an attack the player is, 0 to 1, while it is attacking.
export type PlayerView = { id: number; name: string; x: number; y: number; facing: number; local: boolean; swing?: number }
export type GhostView = { kind: BuildingKind; x: number; y: number; dir: Direction; valid: boolean; shape?: BeltShape }
export type OverlayView = {
  hover?: { x: number; y: number }
  // The building about to be placed, under the mouse.
  ghost?: GhostView
  // Buildings asked for and not confirmed yet.
  pending: readonly GhostView[]
  // Tiles whose buildings are being taken away.
  removing: ReadonlyArray<{ x: number; y: number }>
  // The building whose inventory is open.
  selected?: { x: number; y: number }
  // The plant a left click would punch.
  target?: { x: number; y: number }
  // Health bars over plants that have been punched: how much is left, 0 to 1, and whether the plant is a tall one.
  bars: ReadonlyArray<{ x: number; y: number; fraction: number; tall: boolean }>
}
export type DebugView = {
  chunks: readonly number[]
  desynced: readonly number[]
  links: ReadonlyArray<{ from: { x: number; y: number }; to: { x: number; y: number }; remote: boolean; blocked: boolean }>
}

export type WorldFrame = {
  seed: number
  buildings: readonly BuildingView[]
  // The IDs of the buildings being taken away, drawn faded.
  removingIds: ReadonlySet<number>
  // How hard each plant that was just punched still sways, 1 down to 0, by ID.
  shaking: ReadonlyMap<number, number>
  // The time, in milliseconds, for anything that moves on its own.
  now: number
  // How far from the factory's last tick towards the next it is drawn, 0 to 1.
  alpha: number
  players: readonly PlayerView[]
  drops: readonly DropView[]
  animals: readonly AnimalView[]
  attacks: AttackView
  overlay: OverlayView
  debug?: DebugView
}

// The world, drawn as layers in a fixed order, bottom to top:
//
//   ground     bare ground and ore deposits (GroundLayer)
//   buildings  one sprite per building and plant, in order of rows (BuildingLayer)
//   items      the items moving on the belts (ItemLayer)
//   drops      the items lying on the ground (DropLayer)
//   animals    the animals, and the ropes leading them (AnimalLayer)
//   overlay    the hovered tile, the building being placed, unconfirmed buildings, removals (OverlayLayer)
//   players    the players and their names (PlayerLayer)
//   debug      chunk edges and links, while the debug view is on (DebugLayer)
//
// `scene` holds them all in world pixels; the camera moves and scales it.
export class WorldRenderer {
  readonly scene = new Container()
  private readonly ground: GroundLayer
  private readonly buildings: BuildingLayer
  private readonly items: ItemLayer
  private readonly drops: DropLayer
  private readonly animals: AnimalLayer
  private readonly attacks: AttackLayer
  private readonly overlay: OverlayLayer
  private readonly players: PlayerLayer
  private readonly debug = new DebugLayer()

  constructor(art: Art) {
    this.ground = new GroundLayer(art)
    this.buildings = new BuildingLayer(art)
    this.items = new ItemLayer(art)
    this.drops = new DropLayer(art)
    this.animals = new AnimalLayer(art)
    this.attacks = new AttackLayer(art)
    this.overlay = new OverlayLayer(art)
    this.players = new PlayerLayer(art)
    this.scene.addChild(this.ground.view, this.buildings.view, this.items.view, this.drops.view, this.animals.view, this.overlay.view, this.players.view, this.attacks.view, this.debug.view)
  }

  update(frame: WorldFrame, camera: Camera): void {
    const { x, y, scale } = cameraTransform(camera)
    this.scene.position.set(x, y)
    this.scene.scale.set(scale)
    this.ground.update(frame.seed, visibleTiles(camera))
    this.buildings.update(frame.buildings, frame.removingIds, frame.shaking, frame.now)
    this.items.update(frame.buildings, frame.alpha)
    this.drops.update(frame.drops, frame.now)
    this.animals.update(frame.animals, scale)
    this.attacks.update(frame.attacks, scale)
    this.overlay.update(frame.overlay, scale)
    this.players.update(frame.players, scale)
    this.debug.update(frame.debug, scale)
  }
}
