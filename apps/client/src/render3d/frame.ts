import type { BeltShape, BuildingKind, Direction, ItemId, LichSpell, Offering, Terrain } from '../../../../packages/shared/src/index.ts'

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
  // A fence or gate (or wooden wall or door): which of its neighbours it joins up with (FENCE_N, FENCE_E, FENCE_S, FENCE_W
  // added together). A wooden floor: which of its neighbours have a floor too.
  connect?: number
  // A fence with an animal or a raft tied to it.
  tied?: boolean
  // A gate: whether it is open (a player is going through it).
  open?: boolean
  // Farmland: how far what grows in it has got, as one of the 3D models' stages (see cropStage in game.ts), if
  // anything grows in it.
  cropStage?: number
  // A campfire or an oven: whether it is burning.
  lit?: boolean
  // A stump or a workbench: the tool in its tool slot (its item), shown stuck in it or resting on it.
  tool?: ItemId
  // Something stuck in the ground (a piece of flint): what it is.
  item?: ItemId
  // A barrel: whether it is sealed, the liquid in it (by name, '' for none) and how full it is (0 to 1), and whether it
  // is making compost.
  barrel?: { sealed: boolean; liquid: string; fill: number; composting: boolean }
  // A drying rack: nothing on it, a hide drying, or a dried hide waiting to be taken.
  rack?: 'empty' | 'drying' | 'done'
  // Farmland: how watered it is, 0 to 100.
  water?: number
  // A feed trough: how full of food it is, 0 (empty) to 1 (every slot a full stack).
  feed?: number
  // A pedestal or an altar: what is on it, floating over it.
  shown?: ItemId
  // A fire cooking leaves: it smokes.
  smoking?: boolean
}
// A shape painted on the ground: polygons (tiles), in a colour, filled and outlined this strongly (0 to 1).
export type GroundMark = { polygons: Array<Array<{ x: number; y: number }>>; color: number; fill: number; stroke: number }
// The fighting, in tiles: shapes on the ground (what is about to be hit, a spell coming, the debug view's hitboxes);
// what is in flight; sparks where things were hit; and damage numbers rising off what was hurt (`age` 0 to 1 as each
// fades).
export type AttackView = {
  marks: GroundMark[]
  // The air swishing behind a weapon as it swings, tracing exactly what the attack covers (`progress` 0 to 1 through
  // the swing): a sweep round the player `arc` wide from `inner` to `outer` tiles out (a swing), a straight streak
  // `outer` long and `width` wide (a jab or thrust), or a ring `outer` across, `distance` ahead (a strike or slam).
  swishes: Swish[]
  // `fall`: for an icicle, how far it has fallen, 0 (high above) to 1 (landing); `lift`: for something lobbed up and
  // over (a goblin shaman's hex), how high it is (tiles).
  shots: Array<{ id: number; item: number; x: number; y: number; angle: number; fall?: number; lift?: number }>
  sparks: Array<{ x: number; y: number; age: number; color: number }>
  numbers: Array<{ x: number; y: number; text: string; age: number }>
  // Soft clouds (see clouds.ts): frost, poison, a blizzard's snow.
  puffs: PuffView[]
}
// A soft puff of a cloud, round and fading out to its edge, facing the screen: where it is (tiles; `height` over the
// ground), how big across (tiles), its colour, and how strong (0 to 1).
export type PuffView = { x: number; y: number; height: number; size: number; color: number; alpha: number }
// An animal, in tiles. `size` is how big a grown one of its kind is drawn; `leader` is where the player leading it on a
// rope is; `hurt` while it has just been hit.
export type AnimalView = {
  id: number
  kind: string
  x: number
  y: number
  size: number
  baby: boolean
  // Which way it last walked, in radians (as a player's `facing`).
  facing: number
  hovered: boolean
  hurt: boolean
  // A hostile one that is after a player (shown with a mark over it).
  angry: boolean
  // A male (drawn as such: antlers, a mane, a comb).
  male: boolean
  // One just killed, falling over: how far through it is, 0 to 1.
  dying?: number
  leader?: { x: number; y: number }
  // A scarab curling up to roll, or rolling, `progress` 0 to 1 of the way through.
  act?: { k: 'curl' | 'roll'; progress: number }
  // A hunter biting (a wolf, a scarab), 0 to 1 of the way through its lunge.
  bite?: number
}

// A monster (see monsters.ts), in tiles: which way it faces, whether it has just been hurt or is after a player, how far
// through falling over it is if it was just killed, and what it is doing: winding up a thrust, aiming its bow, or
// casting (which spell), `progress` 0 to 1 of the way through.
export type MonsterView = {
  id: number
  kind: string
  x: number
  y: number
  size: number
  facing: number
  hurt: boolean
  angry: boolean
  dying?: number
  // (`thrust` and `hurl`: a goblin's jab and throw going, just after its windup; `smash`: a mummy's arms coming down
  // in its slam; `swipe`: a mummy's plain blow.)
  act?: { k: 'swing' | 'charge' | 'dash' | 'aim' | 'cast' | 'jab' | 'throw' | 'slam' | 'thrust' | 'hurl' | 'smash' | 'swipe'; progress: number; spell?: LichSpell }
}

// A spike trap of the dungeon, in world tiles: the floor it covers, the wall its spikes come out of (and which way),
// and how far its spikes are up, 0 (down) to 1, and whether it is about to go off (set off, not yet up).
export type TrapView = {
  tiles: ReadonlyArray<{ x: number; y: number }>
  wall?: { tiles: ReadonlyArray<{ x: number; y: number }>; dir: { x: number; y: number } }
  up: number
  arming: boolean
}
// An item on the ground, in tiles, and how many ticks it has lain there (for its landing hop).
export type DropView = { id: number; item: ItemId; x: number; y: number; age: number }
// A player, in tiles. `facing` is which way they look, in radians: 0 is east, a quarter turn (π/2) is south. `hurt`
// while they have just been hit; `held` is the item in their hand (0 or none for nothing), `armor` what they wear (head,
// body, feet: item IDs), and `pose` what they are doing with what they hold.
export type PlayerView = {
  id: number
  name: string
  x: number
  y: number
  facing: number
  local: boolean
  hurt?: boolean
  // Just hurt, and not hurt again for a moment (see HURT_GRACE_TICKS): it flickers, and this is when it is not drawn.
  blink?: boolean
  held?: number
  armor?: readonly number[]
  pose?: PlayerPose
}

// How a player's arms are posed as they attack, `progress` 0 to 1 of the way through:
// - swing: swept round from one side to the other through `arc`; thrust: straight out and back; strike: raised
//   overhead and brought down in front;
// - draw: a bow drawn, the string pulled back; whirl: a sling whirled once round over the head;
// - release: a shot let go;
// - charge: a weapon raised back, being charged (the attack button held down), shaking once it is ready (`progress` 1);
// - brace: a dash being charged, crouched low and leaning in, the weapon levelled low at the side (as a skeleton
//   gathers to charge); lunge: the dash, leaning hard into it, the weapon straight out in front;
// - spin: arm out, turning round and round, `turns` times;
// - row: an oar reached out the way it is aimed, dipped in, and pulled back in towards the player.
export type PlayerPose =
  | { kind: 'swing'; progress: number; arc: number }
  | { kind: 'spin'; progress: number; turns: number }
  | { kind: 'thrust' | 'strike' | 'draw' | 'whirl' | 'release' | 'charge' | 'brace' | 'lunge' | 'row'; progress: number }

// A raft (see rafts.ts): its middle, in tiles, and which way it is turned (radians, as a player's facing).
// A raft, in tiles; `rope`: where the rope on its post runs to (the hand of the player leading it, or the fence it is
// tied to), if it is on one.
export type RaftView = { id: number; x: number; y: number; angle: number; rope?: { x: number; y: number } }

export type Swish = {
  x: number
  y: number
  angle: number
  shape: 'arc' | 'band' | 'ring'
  arc: number
  inner: number
  outer: number
  width: number
  distance: number
  progress: number
  // A band traced from its far end back in to the player (an oar's pull), not out from them.
  pull?: boolean
  // Its colour (white unless it says: a monster's is red).
  tint?: number
}
export type GhostView = { kind: BuildingKind; x: number; y: number; dir: Direction; valid: boolean; shape?: BeltShape }
export type OverlayView = {
  hover?: { x: number; y: number }
  // The building about to be placed, under the mouse.
  ghost?: GhostView
  // A raft about to be put down: where its middle goes (tiles), and whether it can go there.
  raftGhost?: { x: number; y: number; valid: boolean }
  // Buildings asked for and not confirmed yet.
  pending: readonly GhostView[]
  // Tiles whose buildings are being taken away.
  removing: ReadonlyArray<{ x: number; y: number }>
  // The building whose inventory is open.
  selected?: { x: number; y: number }
  // What a left click would hit (bare-handed, or holding a tool).
  target?: { x: number; y: number }
  // Health bars over what has been hit: how much is left, 0 to 1, and whether it is a tall one (a tree).
  bars: ReadonlyArray<{ x: number; y: number; fraction: number; tall: boolean }>
  // A name shown over the building under the mouse (a chest's), at its tile.
  label?: { x: number; y: number; text: string }
}
// An altar's ritual under way, or just over (see altar.ts and ritual-timeline.ts): the altar's tile, how far through it is
// (0 to 1), what it took from where, and how much of its glow afterwards is left (1 down to 0; 0 while it goes on).
export type RitualView = { id: number; x: number; y: number; t: number; offerings: readonly Offering[]; glow: number }
// A player travelling by waystone (see waystones.ts and waystone-effects.ts): the stone they go from (its tile), how far
// through the charge it is (0 to 1), and where they are (tiles), if they are in view.
export type WarpView = { x: number; y: number; t: number; player?: { x: number; y: number } }
// A flash where a player went from a waystone or arrived at one (tiles), `age` 0 to 1 through it, a number to turn its
// sparks by, and the stone (its tile) whose lights glow with it.
export type WarpFlashView = { x: number; y: number; age: number; arriving: boolean; salt: number; stone?: { x: number; y: number } }
export type DebugView = {
  chunks: readonly number[]
  desynced: readonly number[]
  links: ReadonlyArray<{ from: { x: number; y: number }; to: { x: number; y: number }; remote: boolean; blocked: boolean }>
}

export type WorldFrame = {
  // The land (undefined until the world's arrives).
  terrain: Terrain | undefined
  // Whether the player has truesight: without it the far islands are under fog (see fog.ts), and nothing on them is in
  // the frame.
  fogLifted: boolean
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
  monsters: readonly MonsterView[]
  traps: readonly TrapView[]
  rafts: readonly RaftView[]
  attacks: AttackView
  overlay: OverlayView
  rituals: readonly RitualView[]
  warps: readonly WarpView[]
  warpFlashes: readonly WarpFlashView[]
  debug?: DebugView
}
