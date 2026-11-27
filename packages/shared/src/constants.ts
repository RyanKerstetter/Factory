// Numbers the server and every client must agree on. Everything in the factory simulation is a whole
// number: positions are in fixed-point units (`SUB` to a tile), times are in ticks.

export const GAME_TITLE = 'Survival Game'

// The simulation ticks this many times a second, on the server and in every client's copy of the factory.
export const TPS = 30
export const TICK_MS = 1000 / TPS

// Fixed point: a tile is SUB units across.
export const SUB = 256

// The world is split into square chunks of CHUNK_SIZE tiles. A client simulates only the chunks near it.
export const CHUNK_SIZE = 32
// The world is WORLD_RADIUS_CHUNKS chunks out from 0,0 in every direction (chunks -R .. R-1), so 64,000 tiles across:
// open sea as far as anyone will ever sail (hours by raft), the islands in the middle. As many chunks as a chunk's ID
// has room for (see chunkId), less a margin.
export const WORLD_RADIUS_CHUNKS = 1000
export const WORLD_MIN_TILE = -WORLD_RADIUS_CHUNKS * CHUNK_SIZE
export const WORLD_MAX_TILE = WORLD_RADIUS_CHUNKS * CHUNK_SIZE - 1

// Belts. An item's place on a belt is how far along it is, from 0 (where it came in) to BELT_LENGTH (the far edge,
// where it waits to go into whatever is in front). Items keep at least BELT_GAP apart, so a belt holds BELT_CAPACITY.
// BELT_LENGTH and every place an item can come in are multiples of BELT_SPEED, so items never stop short of an edge.
export const BELT_LENGTH = SUB
export const BELT_SPEED = 16 // units a tick: 16 ticks a tile, 1.875 tiles a second
export const BELT_GAP = 64
export const BELT_CAPACITY = BELT_LENGTH / BELT_GAP
// Where an item fed in from the side of a straight belt is put: its middle.
export const BELT_SIDE_ENTRY = BELT_LENGTH / 2

// Inventories.
export const STACK_SIZE = 50
export const MINER_SLOTS = 1
export const CHEST_SLOTS = 23
// The longest name a chest (or a waystone) can be given.
export const CHEST_NAME_LENGTH = 24
export const FEEDER_SLOTS = 6
// The player's inventory: the hotbar (its first HOTBAR_SLOTS slots, picked with 1 to 9), the rest of the inventory,
// the ammunition slot (AMMO_SLOT), which only takes ammunition (items tagged "ammo": arrows, sling stones), and last
// the three armour slots (head, body, feet, from ARMOR_SLOT on), which each take only armour worn there, and last the
// food slot (FOOD_SLOT), which takes only food, and is what F eats from (once every EAT_COOLDOWN_TICKS); and the
// trash slot (TRASH_SLOT), which takes anything, nothing goes into by itself, and which throws away what is in it when
// something else is put there.
export const HOTBAR_SLOTS = 9
export const AMMO_SLOT = 36
export const ARMOR_SLOT = AMMO_SLOT + 1
export const FOOD_SLOT = ARMOR_SLOT + 3
export const TRASH_SLOT = FOOD_SLOT + 1
export const PLAYER_SLOTS = TRASH_SLOT + 1
export const EAT_COOLDOWN_TICKS = 5 * TPS

// Plants. Each tick, RANDOM_TICKS_PER_CHUNK tiles of every chunk are picked at random (from the seed, the tick and the
// chunk, so every copy picks the same ones), and whatever stands on a picked tile gets a random tick: a sapling grows
// a stage. A tile is picked about every 11 seconds, so a sapling takes SAPLING_STAGES of those (about 45 seconds on
// average, sooner or later by chance) to become a tree.
export const RANDOM_TICKS_PER_CHUNK = 3
export const SAPLING_STAGES = 4
// A berry sprout (planted from berries) takes this many random ticks to become a bush, about 100 seconds on average.
export const SPROUT_STAGES = 9
// A sunflower seedling grows into a sunflower over this many random ticks (about a minute).
export const SEEDLING_STAGES = 6
// A young cactus (planted from a cactus, on sand) grows into a cactus over this many random ticks (about a minute and a
// half).
export const CACTUS_STAGES = 8

// A rope (leading an animal or a raft, or tying one to a fence) is a spring: slack up to LEAD_LENGTH, and past it it pulls
// both its ends towards each other, ROPE_PULL for each unit it is stretched (see `ropeForce` in animals.ts). Each end
// is sped up by that over its weight (`mass` in animals.json, against PLAYER_MASS; anything lighter than ROPE_MIN_MASS
// counts as that, so a chicken does not whip about), loses ROPE_FRICTION of its rope speed each tick (so nothing slides
// on past the other), and never goes faster than ROPE_MAX_SPEED on it (units a tick) (see `ropeStep`). So a deer
// (heavy) running off barely slows, and drags its player along faster than they could walk; a cow (lighter than a
// player) follows them. A fence does not give at all, and holds what is tied to it within ROPE_HELD (once it has been
// drawn in that far: one tied from further off is drawn in first). A rope pulled past LEAD_BREAK snaps.
export const LEAD_LENGTH = 3 * SUB
export const LEAD_BREAK = 10 * SUB
export const ROPE_PULL = 0.08
export const ROPE_FRICTION = 0.4
export const ROPE_MIN_MASS = 0.6
export const ROPE_MAX_SPEED = 110
export const ROPE_HELD = Math.round(4.5 * SUB)
export const PLAYER_MASS = 1
// A gate is open while a player's middle is within this of its middle.
export const GATE_OPEN_RADIUS = Math.round(1.4 * SUB)

// A player's health, out of PLAYER_MAX_HEALTH.
export const PLAYER_MAX_HEALTH = 100

// The fewest ticks between two punches by the same player.
export const PUNCH_COOLDOWN_TICKS = 8

// Walking through a berry bush is slower: a player whose middle is over one moves at this percentage of its speed
// (100 is no slower; lower is slower). The server and the page both read it, so changing it here changes both.
export const BUSH_SPEED_PERCENT = 30

// Items on the ground. What a punch knocks loose is dropped around the plant (unless a game turns this off, when it
// goes straight into the puncher's inventory), and a player who walks within PICKUP_RADIUS of an item picks it up, once
// it has been on the ground PICKUP_DELAY_TICKS (so it is seen popping out). An item nobody picks up is gone after
// DROP_LIFETIME_TICKS (two minutes). A player drops an item DROP_THROW tiles off, towards the mouse, so it is not
// picked straight back up.
export const DROP_ITEMS_ON_GROUND = true
export const PICKUP_RADIUS = SUB
export const PICKUP_DELAY_TICKS = 5
export const DROP_LIFETIME_TICKS = TPS * 60 * 2
export const DROP_THROW = 1.5

// Players. Speeds are units a tick; the diagonal one is the straight one over the square root of two, rounded.
export const PLAYER_SPEED = 51 // about 6 tiles a second
export const PLAYER_SPEED_DIAGONAL = 36
// After a hit that hurt them, a player is not hurt again for this many ticks (a moment to get away), so they cannot be
// hit over and over at once; their page shows it with them flickering. The cold, which bites through anything, still
// does.
export const HURT_GRACE_TICKS = Math.round(0.5 * TPS)

// Half the width of the square a player takes up, in units, for walking into buildings (it is drawn at 0.8 of a tile).
export const PLAYER_HALF_SIZE = 77
// How far from the middle of the player the middle of a tile can be for the player to build on it, remove what is
// on it or use it, in units.
export const PLAYER_REACH = 10 * SUB
// Where a player starts: the middle of tile 0,0.
export const PLAYER_SPAWN = { x: SUB / 2, y: SUB / 2 }
// The most movement inputs the server plays for one player in a tick, so a client that sends extra cannot go faster.
export const MAX_INPUTS_PER_TICK = 2
// A player whose inputs have queued up on the server (two or more waiting) for this many ticks in a row has an extra
// one played, so the server is never more than about a tick behind where they really are (see GameRoom.step).
export const INPUT_BACKLOG_TICKS = 3
// Inputs the server keeps waiting for a player; older ones are dropped beyond this.
export const MAX_QUEUED_INPUTS = 30

// Chunks are simulated by a client when they are within SUBSCRIBE_RADIUS chunks of the player's chunk (in both
// directions), and dropped again when they are more than UNSUBSCRIBE_RADIUS away, so walking back and forth over a
// chunk edge does not load and drop the same chunks over and over.
export const SUBSCRIBE_RADIUS = 2
export const UNSUBSCRIBE_RADIUS = 3

// Each chunk's state is hashed every HASH_INTERVAL ticks (each chunk on its own tick, so the work is spread out),
// and a client that gets a different hash is sent the chunk again.
export const HASH_INTERVAL = 30

// Commands. A command runs on the first tick after it reaches the server (a client stamps it with a tick the server has
// already run; see TickClock.commandTick), so what a player does takes effect as soon as the network allows. One
// stamped more than MAX_COMMAND_LEAD ticks ahead of the server is refused.
export const MAX_COMMAND_LEAD = TPS * 5

// The longest message (in characters of JSON) the server puts on the wire. Bigger batches are split.
export const MAX_PACKET_CHARS = 12_000

// ---- the camera's zoom (the page's camera.ts uses these)
//
// Zoom is how big things are drawn: 1 is normal, 2 twice as big (zoomed in), 0.5 half (zoomed out).
export const ZOOM_MIN = 1.5
export const ZOOM_MAX = 3
export const DEFAULT_ZOOM = 2
// How much one notch of the mouse wheel zooms: 1.15 is 15% in or out a notch. A touchpad's small scrolls zoom a
// matching bit less.
export const ZOOM_PER_NOTCH = 1.15
// How long the zoom takes to catch up with the wheel, in milliseconds (roughly to two thirds of the way). 0 is instant;
// bigger is floatier.
export const ZOOM_SMOOTHING_MS = 90
