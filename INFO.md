# Factory Game

A multiplayer sandbox factory game in the browser, built with TypeScript, three.js, Geckos (WebRTC) and Vite. For now it
is the start of the game: players punch trees and bushes for what they drop and plant acorns, together in one world. The
factory (miners, belts, extractors, chests) and ore deposits are built and simulated but put away for later.

## Run it

```sh
npm install
npm run dev
```

Open the address Vite prints (port `5173`). Type your name, then:

- **Create game**: a new world, with a name (no two worlds share one), a seed (empty for a random one), a **world size**
  (Small, Medium, Large, Extra large); the size is for **Play offline** too. Its name and six-letter code are at the top left; click
  them to copy an invite link (whoever opens it lands on Join game with the code filled in).
- **Load game**: the saved worlds that are not running. **Load** starts one again where it was left. **Export** downloads
  a world as a `.json` file, and **Import from file** adds one (under a new name if its own is taken). **Delete** removes
  a saved world for good, after asking (`DELETE /api/saves/<code>`; not one that is running).
- **Join game**: the worlds running now, by name, with who is in them; or one by its code.

**Saving.** The server keeps each world as a file, `<code>.json.gz` (gzipped JSON), in its saves folder (`SAVES_DIR`; by default outside the project, so git never touches it:
`%APPDATA%\FactoryGame\saves` on Windows, `~/Library/Application Support/FactoryGame/saves` on a Mac,
`~/.local/share/factory-game/saves` elsewhere: `defaultSavesDir` in `apps/server/src/save-folder.ts`; worlds in the old
place, `saves` where the server is started, are copied there when it starts, the old files left as they were): every minute (`SAVE_EVERY_MS` in `apps/server/src/index.ts`), when the world closes (ten
minutes after the last player leaves), and when the server is stopped with Ctrl+C. Restart the server and the world is
in Load game. A save holds the seed (the ground is worked out from it again), only what differs from what the seed
grows in each chunk (what was built, changed, or grown since, and the IDs of what the seed grew that is gone: the rest
is grown again on loading, with the same IDs, so a world nobody has changed much is a few KB; what the seed grows in
each chunk is worked out once and kept, `generatedOf` and `pristineOf` in `game-room.ts`, so a save, every minute,
only compares and takes a few milliseconds even with whole islands), the animals, and every
player who has played there, by name: come back with the same name and you are where you were,
with what you had. So two players in one game cannot share a name. Items are saved with their keys, so a save still
loads after `items.json` changes (an item taken out of the game is dropped). Changing how the world grows
(`DEFAULT_PLANT_GENERATION`, or data the generator reads) changes the untouched parts of old saves when they load: the
server logs a warning for each chunk that grows differently than when it was saved. Exports are the same gzipped file;
imports take that or its unzipped JSON. The format is `apps/server/src/save.ts`.

**Singleplayer**: **Play offline** on the menu makes a world that runs in your own browser, on your own computer: the
game server's `GameRoom` runs in a Web Worker (`apps/client/src/local-server.worker.ts`), and the page talks to it
through the same messages and reliable streams as over the network (`connectLocal` in `connection.ts`), so it plays
exactly as a hosted game does. Nothing goes to a server (the page itself still has to be served, by `npm run dev` or
any static host of `npm run build`'s output), and nobody else can join. It is not saved yet: closing the tab ends it.

| Command | What it does |
| --- | --- |
| `npm run dev` | Client (Vite, port 5173) and server together, both reloading on changes |
| `npm run dev:client` / `npm run dev:server` | One side only |
| `npm test` | The tests in `tests/` |
| `npm run typecheck` | Type-checks the client and the server (and the shared code with each), and the tests |
| `npm run build` | Builds the client into `apps/client/dist` and type-checks the server |
| `npm start` | Builds the client once and serves it with the server, for a steadier setup than `dev` |

## Project structure

- `data/` holds the game's data as JSON, read by the shared code when it loads (each file by its own reader in
  `packages/shared/src`, all checking it the same way with `data-check.ts`), which stops with a message naming the
  entry if one is wrong, a misspelt field included. The dev server picks a change up on reload; restart the game server
  too, since it reads them once.
  - `items.json`: what every item is: its number, key, name, picture (`icon`, under `res/`), what it puts down
    (`places`), its tool kind, its stack size, its `tags` (such as `seed` or `meat`), the crop a seed grows (`crop`),
    how hot a fuel burns and for how long (`fuel`), and buckets (`bucket`). Items tagged `organic` rot to compost.
  - The numbers to tune, each file by item key, beside others of their kind:
    - `weapons.json`: every weapon's attack (damage, harvest, reach, arc or width, cooldown, windup, speed, ammo, and what it does held down: `charged`; see
      the comment at the top of `packages/shared/src/weapons.ts` for what each means). `hand` is bare hands.
    - `food.json`: how much each food heals (`heals`). Only what is eaten is in it; what a fire cooks is in
      `stations.json`.
    - `armor.json`: each piece's slot (head, body, feet), `warmth` and `defense`.
    A key there that is not an item, or a field that belongs in one of them left in `items.json`, stops the game at
    start-up with a message saying which.
  - `stations.json`: what the player makes by hand (`"player"`: the first tools, and the stump), and what the stump,
    the workbench, the fires, the barrel and the drying rack make. `"fire"` is what a
    campfire cooks, at what heat, for how long; `"oven"` is a station of its own, `{ "includes": ["fire"], "recipes":
    [...] }`: its own recipes (dough into bread) and everything a campfire cooks besides. For the rest: what each recipe takes, the
    tool it needs, what it makes, how long it takes (`seconds`), and its category in the list.
  - `crops.json`: what grows in garden plots: its seed, how long it takes (in random ticks, about 11 seconds each), and
    what breaking it when grown gives.
  - `animals.json`: the animals: their hp, armour, speed, size, how hard they pull on a rope, what they eat from a feed
    box, their herd size, what they drop, milk and eggs, and their stats (see "Animals").
  - `monsters.json`: the monsters (skeletons, skeleton archers, the frost lich and its wisps): their hp, armour, speed,
    size, how far they notice a player and chase one, their attack, and what they drop (see "Monsters"). The frost
    lich's attack is its spells: how often it casts, and each spell's radius, damage, timing and counts (see the comment
    at the top of `packages/shared/src/monsters.ts`).
  - `buildings.json`: how many hit points each building has (`{ "tree": { "hp": 30 }, ... }`), counted in a weapon's
    `harvest` (an axe's is 3, so 6 hp is two hits): every plant, rock and building that is hit, but saplings, berry
    sprouts and loose flint, which always take one (`HP_FROM_DATA` in `packages/shared/src/buildings.ts`). Each one
    must be there, and nothing else.
  - `drops.json`: what trees, bushes, rocks, grass, saplings and sprouts drop (each item `min` to `max`, and a
    `chance` in percent if it is not always), and how many punches knock a stick loose (`packages/shared/src/drops-data.ts`).
  - `world-gen.json`: how the world grows (`packages/shared/src/world-gen-data.ts`): how much grows (trees, bushes,
    rocks, grass, flint), the cells the patches are laid out over, the ponds (how often, how big), the skeletons'
    camps (where, how many skeletons and archers, how far they patrol, how soon one comes back) and the way into the
    dungeon. A save keeps the plant numbers it was made with; the rest changes old worlds' untouched ground too.
- `packages/shared` is everything the server and the client must agree on: the deterministic factory simulation
  (`src/sim/`), the items and buildings, inventories (`inventory.ts`, with the slot helpers the machines are built on:
  `countIn`, `takeIn`, `fitsIn`, `putIn`), the stations (`stations.ts`, `machines.ts`), weapons (`weapons.ts`), the
  cold (`cold.ts`), world generation, the dungeon's layout (`dungeon.ts`), player movement, the commands, and the
  protocol. The stump and the workbench are one kind of machine, a station (`StationEntity`, `isStation`), laid out by
  `STATION_LAYOUT`; a station's recipes can take in another's (`includes` in `stations.json`: the workbench makes
  everything the stump does).
- `apps/server` is the game server: a small HTTP API to make and find games (`index.ts`), and one `GameRoom` per game
  (`game-room.ts`) that runs the authoritative world and decides what each client is sent. `commands.ts` runs the
  players' commands; `combat.ts` the attacks and everything that flies; `rafts.ts` the rafts on the water; `animals.ts` the animals and `monsters.ts` the
  monsters, which find their way about with `steering.ts`; `dungeons.ts` the dungeon's copies, and `frost-lich.ts` the
  boss fight. What the animals and the monsters have in common is `creatures.ts`'s `CreatureSet`: keeping them by ID
  and by chunk, where each was on the last few ticks (`PositionHistory`, which also keeps the players', so an attack is
  judged against where its player saw them), and taking a blow (knockback, stun). A new kind of creature extends it.
  `save.ts` reads and writes saves, bringing an older save's buildings up to date as it loads (`upgradeEntity`).
- `apps/client` is the page:
  - `main.ts` shows the main menu and starts a game.
  - `game.ts` runs one game: the connection, the page's copy of the factory, the player's input, and each frame. It
    works out what to draw and hands it on; it draws nothing itself.
  - `factory-mirror.ts` is the page's copy of the factory, simulated from the server's log (see "Networking").
    `local-player.ts` predicts the player's own movement, `remote-players.ts` smooths the others,
    `creature-tracks.ts` keeps the animals and the monsters near the player (where each has been, which way it faces,
    when it was hurt, and those falling over), `prediction.ts` draws what the player has asked for before the server
    answers, `tick-clock.ts` keeps time with the server, and `connection.ts` is the connection: a Geckos channel, or the
    Web Worker of a singleplayer world, behind the same reliable streams.
  - `snow.ts` says where snow lies, the same for the ground, the map and footsteps; `liquids.ts` gives each liquid its
    colour wherever it is shown; `ground-marks.ts` works out the shapes painted on the ground (the lich's spells, the
    debug view's hitboxes; a skeleton's attacks and your own charging show nothing on the ground).
  - The world is drawn in 3D with three.js (`render3d/`), handed a plain `WorldFrame` (`render3d/frame.ts`) each frame;
    it knows nothing of the network or the simulation. It is seen from the south at an angle through an orthographic
    camera, with the grid square to the screen (north is up). Every model is built in code from simple low-poly shapes
    in `render3d/models.ts` (one function per thing: the caveman, trees, bushes, rocks, grass, each building, the
    animals and monsters, arrows); `ground-colors.ts` paints each chunk's ground; `ground.ts` lays it down, with the
    sea's surf and the dungeon's walls; `paint.ts` paints the indicators and tile frames onto the ground and makes the
    words; `three-view.ts` puts it together (camera, sunlight and shadows, picking what is under the mouse), keeping each
    thing's model from frame to frame by its ID and reusing the effects (sparks, numbers, bars) with `reuse.ts`. Items
    on the ground use their icons.
  - `ui/` is the page's own elements over the canvas: the menu, the inventory and station panels, the hotbar (with
    health and body temperature), the top bar and its messages, the list of who is playing, the map (`map-view.ts`),
    the Escape menu and the debug text. `icons.ts` gives every item its picture; `overlay-canvas.ts` is the canvas an
    effect over the whole screen is drawn on (the snowstorm, the frost).
- `res/` holds the item icons and sounds (see "Art" and "Sound").
- `tests/` runs with `node:test` through `tsx`. `helpers.ts` wires a real `GameRoom` to real `FactoryMirror` clients
  through the same reliable stream the page uses, over a pretend network that can lose and shuffle messages.

## The world

The world is a chain of **biomes**, one per step of the game, each an **island** of its own in a sea that goes on
every way (`packages/shared/src/terrain.ts`; the numbers are `islands` in `data/world-gen.json`). Each is a rough
disc round a middle, its radius set by the world size (`WORLD_SIZES`) and its coast pushed in and out by noise, as
ragged in every world (`bumpiness` 60: up to `MAX_BUMP_PERCENT` of the radius at 100). Each island lies a short way
over the sea from the one before it: on the side facing its neighbour (within 30° of the line between their middles,
easing off to 70°) its coast still wiggles and has bays, but reaches out at most `facingBump` tiles past its radius
(`wanderAt`), and the islands are placed far enough apart (`gap` more than both of those) that the two coasts can
never meet, however the noise falls. So the only way over is by raft: the narrowest crossing is usually 10 to 12
tiles (6 at the least, 30 or so at the most). Islands not next to each other in the chain keep at least `OCEAN_GAP`
tiles of sea between them. The sea is water: nobody walks into it. The order and each biome's size, temperature and
what grows back in it are `BIOMES`.

The sea is pale on the **shelf** by the land, out to about `shelf` tiles (6; give or take a little, so its edge
wanders), further on a side facing the next island (up to `shelfFacing` more, the more squarely it faces it), and
all the way across between two neighbours: a band of shallows about `shelfJoin` tiles each side of the line between
their middles, wandering a little (`shelfWidthAt`), so the pale water shows which way to go. Which tiles are shelf is
worked out in one place (`isShelf`, in `packages/shared/src/coast.ts`: the distance to land against that width, its
edge wandering by the same noise everywhere), and the ground's picture, the map and a raft's speed all use it, so they
agree to the tile. Beyond is the dark
**deep ocean**, which slows a raft (see Raft). There is nothing out in it, as far as anyone could sail: the world is
`WORLD_RADIUS_CHUNKS` (1000) chunks out each way, 32,000 tiles. The forest has sand beaches; the mountains' rock runs straight down into the
water. Ponds never form within `POND_SHORE` tiles of the sea (`world-gen.ts`).

The ground is drawn as a picture of each chunk (`apps/client/src/render3d/ground-colors.ts`), 8 pixels to a tile and
drawn with its pixels sharp (no filtering), as pixel art. Every tile is drawn as what it is, edge to edge, with nothing
softened or blended across the edges between tiles: sea or land, forest or mountain, a beach tile, a pond tile, shelf or
deep ocean. Water is flat and all of one depth: the shelf one pale colour and the deep ocean one dark colour, a hard line
between them.
Within a land tile the colour varies in patches of grass and rock and a pixel grain. In the mountains it is snow or rock,
never a mix, a whole tile at a time: snow lies where the air makes it cold enough, and the line between them runs along
the tiles' edges (`isSnowAt`, in `ground-colors.ts`, which the map uses too), wandering
`SNOW_LINE_WANDER` degrees either way of where the air alone would put it, in big tongues and bays, and is bumpy along
its length (`SNOW_BUMPS`). The land is level everywhere; only the water lies lower.

**Water** lies a little below the ground (`WATER_DEPTH` in `apps/client/src/render3d/ground.ts`), set into it with a
bank down to it: earth by a pond, sand by the forest's sea, rock in the mountains. The water itself is flat colour: a pond
one blue, the sea one pale blue over the shelf and one dark blue over the deep.

**Surf**: waves of white foam roll in over the sea near the land and break on it, a wash of froth thinning away after
each, one every `SURF_PERIOD` seconds, a little sooner or later along the shore, out to `SURF_REACH` tiles
(`ground.ts`). They are drawn in pixels the size of the ground's.

- **Forest** (round the spawn): trees, berry bushes, grass and flint; chickens and deer. (It had ponds; no biome
  has them now, `ponds` in BIOMES in `terrain.ts`, but the code is kept for a biome to come. Fresh water is from a
  well.)
- **Mountains** (an island a short way over the sea from the forest: take a raft): rocks, thick on the ground; wolves; skeletons'
  camps; the way into the dungeon; and the cold. It is
  mild where they meet the forest and colder the further in you go (`temperature` in `BIOMES`: 12°C at the edge to
  −58°C at the far side, bent by `curve` so the cold is deep in; the first half or so is out of the snow; it is about
  −35°C, deadly, at the way into the dungeon).

**The cold** (`terrain.ts`, `cold.ts`). A player's **body** has a temperature of its own (it starts at
`BODY_NORMAL`), which drifts towards the temperature round them: the air's, plus the `warmth` of the armour they wear.
It cools by `BODY_COOLING` degrees a second plus `BODY_COOLING_GAP` percent of how much colder it is round them (so
the bitter cold gets in within seconds), and warms likewise (`BODY_WARMING`). Within `CAMPFIRE_WARMTH_RADIUS` tiles of
a lit **campfire** it warms towards that `CAMPFIRE_WARMTH` degrees warmer, and never less than `CAMPFIRE_COMFORT`: you
can always warm up by a fire. It is the body, not the air, that counts: below `COLD_AT` (0°C) you slow down, more and
more the colder you get, to `FREEZING_SPEED_PERCENT` at `DEADLY_COLD_AT` (−25°C) (`coldSpeedPercent`); below that you
lose `COLD_DAMAGE` (6) every `COLD_DAMAGE_EVERY` ticks (2 seconds), and no armour stops it. The body's temperature is
shown beside the health bar, over the hotbar: a gauge from deadly cold to warm, in degrees, its colour going from warm
to cold, freezing and deadly (hover it for what that means). The cold is seen too: as your body cools, **frost** creeps
in over the edges of the view, rime and ferns of ice reaching further in the colder you are, until in deadly cold only a
small clear patch is left in the middle and the ice throbs (`frost-view.ts`, `frostOf`). Snow blows over the view in
cold air (`SNOW_STARTS_AT` to `SNOW_FULL_AT`), to a near whiteout. The server keeps each body's temperature and sends it
with the player's health (in tenths of a degree); the page slows its player by it the same way.

**Armour** goes in the three armour slots in the inventory (head, body, feet): click a piece to put it on or take it
off, or drag it. Each piece has a `warmth` (degrees warmer it keeps you) and a `defense` (`armor.json`):
every hit on you does the sum of your armour's defense less, but always at least 1 (`damageAfterArmor`: a hit of 15
through 10 armour does 5). The cold, and the frost lich's blizzard, go straight through armour. Made at the workbench:
**leather armor** (defense 4) and **leather boots** (2), of leather and fiber, and the **wolf helmet** (4; leather,
fiber and wolf fangs), which keeps you warmest of all: with the leather armor and boots it is enough to stay in the ice
crypt without slowing. Worn, the leather armor is a tunic fitted close over the body, with low shoulder pads, sleeves
down the upper arms (which swing with them), a belt and a skirt of flaps over the tops of the legs; the caveman under it
is lean and in proportion (long legs, a flat torso wider at the shoulders, a neck and a modest head), so armour does
not make him bulky. Worn boots go on the feet and step with them.

Being hurt makes a thud and a grunt (the `hurt` sound); others being hurt, a dull thump, from where they are.

**Skeletons' camps** (`campSites` in `terrain.ts`, `tendCamps` in `apps/server/src/monsters.ts`): a few in the
mountains, where the air is from `CAMP_WARMEST` down to `CAMP_COLDEST`: a dead fire, a tent and bones, each kept by
4 to 5 skeletons, 1 or 2 of them skeleton archers (see "Monsters"; the numbers are `camps` in `data/world-gen.json`).
They **patrol**: each walks slowly to a spot within `patrolRadius` (11 tiles) of the fire, stands a while, and picks
another, the one furthest from where the others are and are going, so they spread out round the camp rather than
clump. Alert one and the whole camp comes, wherever each is. One that is killed comes back `respawnSeconds` (150 s)
later, but only once a player is within `CAMP_ACTIVE` tiles of the camp and none within `CAMP_UNSEEN`, so they never
appear in front of you.

**The dungeon** (`packages/shared/src/dungeon.ts`, `apps/server/src/dungeons.ts`) is an **ice crypt**: frosted
flagstones between walls of ice, colder than anywhere outside (`DUNGEON_AIR`, −40°C), with a few flakes drifting down.
Its way in is a stone arch over steps going down, deep in the mountains' snow (`dungeonEntrance` in `terrain.ts`,
`DUNGEON_SHARE` of the way in). Step onto it and you are taken into a copy of the dungeon of your own, or the copy a
friend is in now.

- **The way through.** From the stairs it goes through every room in turn, each with its guards in it: the guard room,
  the archery, the crypt (each about the guard room's size, with a few pillars at the sides), and then the **door** to
  the frost lich's rooms, a slab of ice that stays shut until every guard in the copy is dead. The rooms are far
  enough apart that a guard never notices a player in another room, and small enough that a guard hit (or one that
  notices you) calls every other guard in its room: each is within `ALERT_RADIUS` (10 tiles) of the rest, with no
  pillar between them. That is the layout's doing, not the code's (`tests/dungeon.test.ts` checks both).
- **Spike traps** lie in the floor, and in the walls, shooting out across the floor beside the wall (`WALL_SPIKE_REACH`
  tiles). They are hard to see: a few small holes, the colour of the floor. Step on one (you, or a monster: skeletons walk into them too) and it clicks; `TRAP_DELAY`
  (0.4 s) later its spikes come up, for `TRAP_ACTIVE` (1 s), hurting everything on it once, players and monsters alike
  (`TRAP_DAMAGE`, 25, less a monster's armour; a wall's spikes push away from the wall too; the lich, which never moves,
  is not hurt); then it takes `TRAP_RECHARGE` (5 s) to be ready again. So the way past one
  is to set it off, step back, and go while it recharges.
- **The lich's rooms.** Through the door is a **waiting room** (smoother stone), and across the mouth of the lich's
  **hall** (a great round chamber, `BOSS_HALL_RADIUS` tiles from its middle to its wall) a glowing **line**. Whoever
  crosses it starts the fight: the door shuts behind everyone in the lich's rooms (nobody else gets in, but whoever is
  in the waiting room can still go on in and fight), the lich wakes, and its health shows across the top of the screen,
  as a number (hp / max) and a bar marked off every 50 hp (`BOSS_NOTCH` in `game.ts`). It has its `hp` in `data/monsters.json` (800) with one player
  there, and 80% of that more for each player after the first (`BOSS_HP_PER_PLAYER`: 1.8 times for two, 1440; 2.6 times for
  three, 2080).
- **The fight** (`apps/server/src/frost-lich.ts`). The lich never moves from the middle of its hall (nothing knocks it
  about or stuns it): you move round it, dodging what it casts. Every `CAST_EVERY` (3.2 s) it casts a spell: for
  `CAST_TICKS` (a second) it raises its glowing staff, which tells you the spell: **held high overhead for icicles**, **levelled at you for
  shards** (it faces you as it casts), lifted a little for the rest (`STAFF_HIGH`, `STAFF_LEVEL` and the rest in
  `three-view.ts`) (nothing is drawn on the ground round it: a blizzard's reach and where called-up
  archers will come are), and then the spell goes off. As it
  starts, it picks by where the players are: if more are within `closeRange` (5.5 tiles) of it than further off
  (a tie either way, at random), one of its close spells, else one of its far ones:
  - **close**: a **blizzard**, a whirl of cold wind out to the close range for 4 seconds (it shows where as the cast
    comes), hurting everyone in it 8 every half second, armour or not; or **frozen wisps**, 4 waves of them over 6 seconds,
    each wave one wisp for every player at once (so 4 for each player in all), on a ring halfway out to the wall (anywhere else in the hall if no spot there will do),
    never within 5 tiles of a player: each drifts after the nearest player, slower than you run, pushing the other
    wisps away rather than bunching up, and bursts against them (26), and is gone after 15 seconds;
  - **far**: **icicles** falling from the ceiling where each player stands (and 4 more near), a blue ring
    showing where each will land just under a second before (40 each); or a **shotgun** of 6 ice shards fanned at each
    player (18 each);
  - and now and then (a quarter of its casts), instead, it **calls up skeleton archers**: 3 for one
    player, and 2 more for each player after the first (5 for two, 7 for three), round the edge of the hall, set on the players at once (a purple ring shows where as the cast comes). It
    calls up no more until every one of those is dead and it has cast 10 times since.
  Every number here is the lich's `attack` in `data/monsters.json`, to tweak.
- The lich's rooms start at `BOSS_AIR` (−40°C: you need the wolf helmet, leather armour and boots not to be slowed) and
  get a degree colder every `BOSS_COLD_EVERY` (6 s), so a slow fight freezes you. Kill it and the door opens, and its
  chest (full of `LOOT`) with it; until then the chest is "guarded". If everyone in its rooms dies or gets out, after
  `GIVE_UP_AFTER` (3 s) the door opens and the lich is whole again.

The stairs out (where you came in) take you back to just outside the arch, and so do the stairs at the top of the
lich's hall, set into the wall beside its chest (`X` in the layout, `hallExit`; the chest stands against that wall), so nobody has to walk all the way back: they are sealed
with a slab of ice until the lich falls (`seal` in `dungeons.ts`), and open for good once it has. A copy nobody has been in for `CLOSE_AFTER`
is cleared away, so the next visit starts fresh. The layout is the text in `dungeon.ts` (`BELOW_HALL`, its legend in the
comment over it; `bossHall` makes the hall): edit it to change the dungeon. Copies sit in a far corner of the world (`DUNGEON_ORIGIN`,
31,000 tiles out each way), further than anyone could sail; nothing can be built or broken in them, and none of it is saved (a player saved inside
one comes back outside the arch).

A world's size is kept in its save (`terrain`); a world saved before biomes gets the default (`DEFAULT_TERRAIN`), and
grows differently from then on. (Older saves also kept a bumpiness, which is now dropped: every world is as bumpy.)

## Playing

The keys are the defaults; every key can be changed in **Esc → Settings → Controls** (kept in the browser).

| Key | Action |
| --- | --- |
| W A S D (or arrows) | Walk |
| Left click (hold) | Attack with what the picked slot holds, towards the mouse (see "Fighting"); held over grown crops, picks them all as fast as you sweep |
| Right click | Use, whatever you hold (it never attacks): open or toggle a chest, station, gate or feed box; sleep in a sleeping bag; put down what you hold; lead or milk an animal with a rope or bucket; use a bucket on a pond, barrel or plot, or empty it on bare ground |
| Q | Put away what you hold (no slot picked: bare hands); again to go back to the slot you were on |
| F | Eat from the food slot (to the right of the hotbar): food gives back health (its `heals` in `food.json`, more for better food), once every `EAT_COOLDOWN_TICKS` (5 s); the slot is grey while you cannot eat, its colour coming back as the cooldown runs down |
| 1 – 9 over the inventory | Swap the stack under the mouse with that hotbar slot |
| 1 – 9 | Pick a hotbar slot |
| E | Your inventory |
| Tab (hold) | Who is playing: everyone in the world by name (the host and you marked), under the world's name and code. A line at the top left, under the world's name, says when someone joins or leaves |
| M | The map: the world as far as you have explored it (within `map.reveal` tiles of where you have been, 12, in `data/world-gen.json`; kept in this browser, for each world and name, a 64-tile square at a time, so it goes on as far as you sail), with everyone on it, and the trees, bushes, rocks and what players have built drawn on it as little pictures (`GLYPHS` in `map-view.ts`; as they are now where the page has the ground loaded, else as the seed grew them); drag it with the left button to look around (a double click brings it back to you); scroll the mouse wheel over it, or press its + and − buttons, to zoom in and out (from a quarter to four times its size, about the mouse; kept until the page is closed); nothing to make first |
| Mouse wheel | Zoom |
| Esc | Close panels, open the menu (Settings, Respawn, invite link, leave), or go back from the settings |
| F3 | Debug view: the numbers at the top left, and hitboxes: every body's round space (players yellow, animals blue, monsters red) and the solid parts of what stands on the ground round you (magenta) |
| F9 | (Development builds) break this page's copy of a chunk, to watch a desync be found and repaired |

- **Tree**: punching does not hurt it, but every `STICK_EVERY` punches knock a stick loose, with a leaf, for as long as
  it is punched: it never runs out (a knife strips bark instead of a stick, still without hurting it). Only an **axe**
  chops it down (`maxHp` / 2 hits), for logs, acorns, leaves and a stick (`felled` in `drops.json`). A tree keeps no
  count of sticks or bark, only of the punches towards the next. Trees are solid.
- **Bush**: each punch breaks it a little, and an axe twice as fast. When it is gone it drops 2 fiber and its
  berries (`drops.json`). It is drawn as leafy cards crossing through its middle, pictures of leaves with gaps that
  show the cards behind; a berry sprout grows through three looks on its way to a bush (a tiny seedling, a small leafy
  clump, then nearly a bush with green berries), and a sapling three on its way to a tree. Bushes can be walked through, at `BUSH_SPEED_PERCENT` speed, with a quiet
  rustle.
- **Rock** (in the mountains): cannot be broken by hand; only a **pickaxe** breaks it (`maxHp` / 2 hits). When it is
  gone it drops 2–4 stone and 1–2 flint. Rocks lie in groups and are solid.
- **Flint** also lies in the forest from the start, a piece here and there: hit it (with anything) to knock it loose,
  then pick it up. It is drawn as a few sharp flakes of dark flint lying on their sides on the ground. It is a "loose item" (`loose` in `buildings.ts`).
- **Grass** grows in clumps, and spreads back slowly where it has been eaten (a tuft every `GRASS_SPREAD_TICKS`, 15 s,
  in each chunk near a player, in `game-room.ts`), until a patch (tufts touching, corners too) is `GRASS_PATCH_MAX` (15) big. How: every 15 s,
  each chunk near a player (or with something built in it) with fewer than `GRASS_MAX_PER_CHUNK` (40) tufts picks one
  of its tufts at random and a tile beside it, and grows a tuft there if that tuft's patch is under 15, the tile is
  free, and (for wild grass) it is in the forest, out of the spawn's clearing and more than `WILD_KEEP_CLEAR` (4) tiles
  from anything built; a chunk with none gets one anywhere. Grass that is already by something built (planted, or there
  first) spreads there regardless, and anywhere, so grass planted in a pen grows into a lawn, even while you are away.
  Pulled up by hand it gives a wheat seed 30 percent of the time and a **grass seed** half the time; cut with a
  knife it gives hay (`drops.json`). A grass seed planted (put down like a building) is a tuft of grass.
- **Where plants take root**: grass, berry bushes and saplings, planted or spreading, only on ground with soil: not
  on sand (a beach: forest land right beside the sea, `isSandAt` in `terrain.ts`) and not in the mountains (rock and
  snow: their biome's `soil` is false). Planting there is refused ("Nothing grows there."); spreading skips it
  (`canGrowAt`). Nor is anything grown on the beaches when the world is made (`plantAt` in `world-gen.ts`; a world
  made before that keeps the few it had, and its coast's chunks log that they grow differently now when it is loaded).
- **Berry bushes** come back slowly too, so a world never runs out: now and then (`BERRY_SPREAD_TICKS`, a minute) a
  chunk near a player grows a berry sprout beside a bush in a patch of fewer than five, or, with none, somewhere in it.
  Neither grass nor bushes grow back within `WILD_KEEP_CLEAR` tiles of anything a player has put down.

### Farming

- **Stump** (3 logs, by hand): right click to open it. It works exactly as the workbench does (the same code,
  `packages/shared/src/stations.ts`): its **tool slot** on the left (marked only by a small knife in its corner), then
  its four input slots, two by two (`STATION_LAYOUT`), an arrow that fills as it works, and its output slot, with your
  inventory under it and its recipes to the right (every panel has its recipes on the right). No slot of any station
  or machine has a label. While it works, a small line at the foot of its panel says what it is making ("Crafting
  planks"; every machine has one: "Cooking raw steak", "Making tannin", "Drying hide"). A station recipe's
  input can be any item of a kind (`"#cooked meat": 1`, by a tag in `items.json`): Craft puts in whichever of it you
  have.
  Pick one and press **Craft**: the tool it needs goes into the tool slot from your inventory (a different tool there
  comes back out to you: with a knife in it, picking planks takes the knife out and puts your axe in), and enough
  input for one more (Shift: five more; Ctrl: all you have; an ingredient that is any of a kind, like a breakfast
  sandwich's cooked meat, goes in as one kind only, the one already in it or else the one you have most of, so the
  four input slots never fill with every kind you have: `oneKindEach` in `stations.ts`), and it keeps working through them, but only while you
  stay at it: close it or walk off and it stops, keeping how far it had got. A tool Craft put in comes back to you when
  you leave the station (close it, open something else, walk off, or leave the game), if it is still in the tool slot
  and you have room for it; with no room it stays there. A tool you put in by hand (or took out and put back) stays
  (`returnLentTools` in `apps/server/src/game-room.ts`, which keeps which tools Craft lent, and to whom; the server only:
  a restart forgets them). A recipe can be made when its tool is on you or already in the tool slot. It makes planks (an axe and a log make two), a wooden spear (a knife and a log), a club (two logs),
  a **breakfast sandwich** (bread, salt, any cooked meat and a fried egg: 80 health), and the stations: the
  workbench (20 planks, 10 stone), the campfire (3 logs, 5 stone) and the sleeping bag (3 leather). An axe or a knife
  left in it is drawn stuck in the stump. Idle, the line at the foot of its panel says "Not crafting" (a fire "Not
  cooking", a barrel "Not making anything", a rack "Not drying"). What it makes is `"stump"` in
  `data/stations.json`.
- **Fences and gates** (planks and rope, at the stump): fences join the fences and gates beside them (I, L, T and X shapes) and stop
  players and animals, but only where the post and rails are drawn (`fences.ts`), so you can walk close round them. A
  gate opens by itself while a player is within `GATE_OPEN_RADIUS` of it. Right click it to open it and keep it open,
  or shut it and keep it shut; a gate shut by hand opens by itself again once a player walks over it. Animals only get
  through an open gate, even on a rope, so open it before leading one through.
  - **Tying up**: right click a fence, then right click an animal or a raft (within `TIE_REACH`, 5 tiles, of the fence),
    and it is tied to the fence on a rope: the rope you were leading it on, or else one from your things. A fence holds
    one; it is drawn with the rope wound round its post, and the rope runs from there to what is tied. Tied, it is held
    to the post as if led there (the same spring, but the fence does not give: drawn in to `LEAD_LENGTH`, and once drawn in, never further than
    `ROPE_HELD`, 4.5 tiles) (an animal wanders slowly round it; a raft is pulled back to it,
    however it is rowed), and the fence does not give. Right click the fence again to untie it, the rope back in your
    things. A right click anywhere else after the fence ties nothing. Animals and rafts stay tied when the game is
    saved; if the fence is taken down, the rope falls off (`tie` and `untie` in the server's `commands.ts`).
- **Garden plot** (workbench): right click it with a seed to plant it. The crop grows on the plot's random ticks; hit it
  when it is grown for the harvest and 1–3 seeds back, which leaves the plot as it was. A crop still growing can only
  be dug up (for its seed back) with a tool, not fists. Harvesting is your attack: whatever your punch or swing covers
  is harvested, so a swing along a row takes several. The soil is dark when watered and pales as it dries. It costs 3
  planks and a compost. Right click a plot with a bucket of water to water it: it grows twice as fast for
  `WATERED_SECONDS` (3 minutes, on the clock, not by chance; `entity.ts`). Wheat grows through six stages, thicker and
  taller each time, from a few shoots to a dense, golden stand of heavy heads: always in three tidy rows along the
  plot's furrows, the plants evenly spaced and all of a height, the ripe heads all nodding the same way. The debug view (F3)
  shows a plot's growth and how long its water lasts when you hover over it.
- **Breaking what you put down** (everything: fences, gates, the stump, plots, feed boxes, the workbench, campfire,
  barrel, drying rack and chests) takes an axe: a fist does nothing. It comes back as its item, with whatever was in
  it. Anything that is hit (what you put down, and trees, bushes and rocks too) and left alone for 6 seconds heals back, a point every third of a second
  (`HEAL_DELAY_TICKS`, `HEAL_EVERY_TICKS` in `game-room.ts`), and its health bar goes once it is whole.
- **Chest** (8 planks, workbench): somewhere to keep things.
- **Feed box** (planks): animals nearby eat what they like from it (cows: wheat or hay; chickens: any seed), which
  leaves them well fed for 90 seconds.
- **Rope** (3 fiber, by hand, or quicker at a stump or workbench): the first tools are bound with it. Right click an animal with it to lead it. A led animal wanders slowly. The rope is a
  **spring**: slack up to `LEAD_LENGTH` (3 tiles), and past it it pulls you and the animal towards each other, as hard
  both ways, `ROPE_PULL` for each unit it is stretched (`ropeForce`). Each of you is sped up by that over your own
  weight (`mass` in `animals.json`, against `PLAYER_MASS`, 1; anything under `ROPE_MIN_MASS`, 0.6, counts as that so
  a chicken does not whip about), loses `ROPE_FRICTION` (40%) of that rope speed each tick so nothing slides on past,
  and never goes faster than `ROPE_MAX_SPEED` on it (`ropeStep`). So a cow (lighter) follows you, slowing you a
  little; a deer (mass 9) that bolts barely slows, and drags you along faster than you walk (about 6.5 tiles a second
  standing still, more walking with it): a ride. Put on from far off, both ends are drawn in, never jumping. (All in
  `constants.ts`.) Right click it again to take the rope back. A rope pulled past `LEAD_BREAK` snaps. A rope also pulls a
  raft along by the post in its middle, and ties an animal or a raft to a fence (see Raft, and Fences).
- **Bodies block each other**: every player, animal and monster takes up a round space (its `halfSize`, a player's
  `PLAYER_HALF_SIZE`), and none can stand on another. Once everything has moved on a tick, any two that overlap are
  pushed apart, the lighter one more (`mass`; a monster is `MONSTER_MASS`, the frost lich never budges), up to
  `PUSH_PER_TICK` each, `SEPARATE_PASSES` times over, so skeletons closing in on you or deer fleeing into a corner
  spread out instead of piling up (`apps/server/src/bodies.ts`). Frozen wisps are not bodies: they burst on contact.

### The workshop

- **Workbench** (20 planks, 10 stone, at the stump): pick a recipe in the list at the side and press **Craft**: what
  it takes for one more goes into its three input slots from your inventory (Shift: five more; Ctrl: as many as you
  can), and it keeps making it while what is in it is enough. Press again to add more. It only works while you stay
  at it. Like the stump, it has a **tool slot**, on the left: a recipe that needs a tool (an axe for planks, a knife
  for a spear or a bow) can be made when the tool is on you or already in the slot, and Craft puts it in from your
  inventory, swapping out a different tool there. Tools are not used up. Pressing Craft for another recipe while it is
  making one does not stop it: it makes the fail sound. Hand crafting takes Shift and Ctrl the same way. Every recipe book,
  by hand, at the stump and at the workbench, is a grid of pictures (hover one for its name; click it to see what it
  takes and craft it) in the same groups, in this order (`category` in `data/stations.json`, `GROUP_ORDER` in
  `recipe-book.ts`): **Materials** (planks, flour, rope), **Weapons**, **Armor**, **Ammo** (arrows, sling stones),
  **Tools** (the bucket too), **Buildings** (the stations, fires, chests, fences, plots and the rest) and **Food**. A
  machine's own groups (a fire's cooking, a barrel's) come after those. The workbench makes everything the stump does
  too, and the stump everything you make by hand. The workbench also makes the mortar and pestle (a pickaxe and 4
  stone), flour (the mortar and pestle and a wheat) and the makeshift oven (20 stone): they need wheat from a garden
  plot, which only the workbench makes. The tool in its tool slot rests on its top (an axe on its side, the mortar
  and pestle standing).
- **Stations include others, and better ones are quicker.** In `data/stations.json` a station is
  `{ "speed": n, "includes": [...], "recipes": [...] }`: it also makes everything the stations it includes make (each
  recipe whose output it has no recipe of its own for, after its own), so a bigger station can always do what a
  smaller one does, and nothing is declared twice. What you make by hand is the `"player"` station (speed 1); the stump
  (speed 2) includes `"player"`, and the workbench (speed 3) includes the stump, and so the player's too. A recipe a
  station declares itself takes its own `seconds`; one it includes takes `seconds` × the speed of the station that
  declared it ÷ its own speed: a stump recipe of 3 s takes 2 s at the workbench, and the knife (4 s by hand) 2 s at the
  stump and 1.3 s at the workbench. By hand, it takes its own time too (`handCraft` in the server's `commands.ts`):
  each Craft click joins a queue, made one after the other only while the inventory is open (closing it calls the
  whole queue off: the page says so with `use`'s `hand`), a bar under the crafting book filling smoothly, frame by frame, as
  the first is made ("Making Rope (2 more)"); what it needs is taken when it is done, and if it is gone by then the rest
  of the queue is dropped. Includes can chain, but not go round in a
  circle; a station must have the input slots for what it includes (`parseStations` in `stations.ts`).
- **Campfire** (3 logs and 5 stone, at the stump): put fuel in and **Light** it. Each fuel can only get the fire so
  hot (sticks 250°, planks 300°, logs 400°, charcoal 800°: `fuel` in `items.json`; the fuel slot is under the cooking
  slot, with a flame between them that burns down as what is burning runs out, `burnFraction` in `machines.ts`), and
  the heat gauge climbs to it and falls when the fuel runs out. A log burnt leaves charcoal one time in four.
  Food in its cook slot cooks once the fire is hot enough, faster the hotter it is; its recipe list shows the heat each
  needs. Barrels and drying racks beside it (or one tile further, at half) get its heat, over a chunk's edge too (the
  server works that out every `BORDER_HEAT_EVERY` ticks and sends it, rounded down to `BORDER_HEAT_STEP`).
- **Makeshift oven** (20 stone, at the workbench): a campfire of stone, a kind of fire like it (`FireKind`, `isFireKind` in
  `buildings.ts`: it burns, warms and heats what is beside it the same, with the same panel), but it cooks
  `OVEN_COOK_SPEED` (twice) as fast, and bakes dough into bread, which a campfire will not take (`cookingOf` in
  `machines.ts`). Its picture is `icons/buildings/oven.png`, and its model is built after it: a beehive dome of stones
  laid in courses that cover it all over, an arched dark mouth framed by stones at the front, and a short chimney on
  top.
- **Drying rack** (workbench): dries one hide at a time into a dried hide, in two minutes cold, as fast again for every
  100° from a campfire beside it (`"rack"` in `data/stations.json`). A wet hide hangs dark on it while it dries, and
  the dried one pale and flat.
- **Well** (workbench: 12 stone, 2 rope, a bucket and 6 planks, no tool): a source of fresh water you can build
  anywhere, like a pond: right click it with an empty bucket for a bucket of water. Its model and picture follow
  `icons/buildings/well.png`: a round stone wall, two posts, a pitched roof and a bucket on a rope. Each slope of the
  roof is a row of planks with thin gaps between, held together by two battens pegged across them, under a ridge beam.
- **Pedestal** (workbench: 5 stone): a carved stone pedestal, after `icons/buildings/pedestal.png`: dark slate on a
  flared foot, a slim column and a wide square top. It has one slot, for a stack of anything, and what is on it floats
  over it, bobbing and spinning (drawn as its icon, a flat picture that turns: `item-pictures.ts`).
- **Altar** (workbench: 20 stone, 10 essence, 8 bone and a lich core): after `icons/buildings/altar.png`: a slab of dark
  stone set with bone, an empty stone basin, and two great curved bone horns hooking in over it, streaked with blood. The
  lich core is what the frost lich drops, and all it drops. It has one slot too, floating over it like a pedestal's.
  - **Rituals** (`packages/shared/src/altar.ts`; `"altar"` in `data/stations.json`: `inputs`, `liquids` by name and
    buckets, `output`, `count`, `seconds`). The altar draws on the pedestals and barrels in the 5 × 5 square on it
    (`ALTAR_REACH`): its panel lists its rituals, each ingredient counted on the pedestals round it and each liquid in
    the barrels. Pick one with everything there (and room on the altar for what it makes: its slot empty, or holding more of the same) and press **Craft**: the server takes it all
    at once, off the pedestals and out of the barrels, and writes down on the altar what came from where (its
    `offerings`, sent after its numbers, OFFERING_SIZE each); the altar then works through it on its own, with nobody
    at it, and what it makes lands in its slot. While it does, it takes nothing in and gives nothing out (`isClosed`,
    like a sealed barrel), and broken, it gives back the items it took (the blood is spilt). The rituals: a **lich
    core**, from 4 fangs, 4 leather, 8 essence, 8 bones, 4 charcoal, 4 breakfast sandwiches, 4 compost, 8 feathers and
    8 buckets of blood, in 15 seconds; a **worker skeleton**, from a lich core, 20 bones, 20 essence, a pickaxe, an axe,
    a knife and 8 buckets of blood, in 15 seconds; and **essence**, one from a loaf of bread, in 5 seconds.
  - **How it looks** (`ritual-timeline.ts`, `render3d/ritual-effects.ts`): a ring of light marks its reach on the
    ground. Each pedestal in turn, round the altar clockwise from the north, sends its item to it: a white beam with
    sparks running along it, the item lifted off and drawn along to circle over the altar, spinning (until its turn it
    still floats over its pedestal, though the server has taken it). Then each barrel in turn: a stream of blood drawn
    through the air to the basin (dark, glossy and lit like the liquid, with a faint dark-red haze, not a beam of
    light), drops running down it, the barrel draining as the basin fills. At the end the items circle in faster
    and closer, the blood rises out of the basin in a column into them and a white core swells between them; then a
    flash, a shockwave over the ground, sparks thrown out and a pillar of light (the altar's `glow`, ALTAR_GLOW_TICKS),
    and what it made floats over the altar.
- **Waystone** (workbench: a lich core, 10 stone and 15 essence; `packages/shared/src/waystones.ts`): after
  `icons/buildings/waystone.png`, a tall blue-grey stone with a rounded top on a dark plinth, runes cut down its face,
  and a row of dark sockets up each edge of its face, with a keystone socket at the top. Right click it for its panel:
  a box to name it (like a chest's), and every other waystone in the world, by name (or where it is, unnamed), how far
  and which way. The server keeps the list and sends it to every page (`waystones` in the log), since a page only
  knows the chunks near it. Click one to go there (the `warp` command): the stone charges for `WARP_SECONDS` (3),
  and you cannot move the while (your page sends no movement and the server plays none). Its lights come on a pair at
  a time from the bottom, the keystone last (`warpLightAt`), with a chime as each does; motes of light rise round you
  in a tightening spiral, a ring closes in under you, and a column of light swallows you. Then you are put down in front
  of the other stone (or beside it, if that is blocked: `ARRIVAL_SPOTS`), with a flash, a pillar of light and sparks
  where you left and where you arrive. Knocked more than a tile away while it charges (or with either stone broken),
  it is called off (`stepWarps` in `game-room.ts`; `warp` and `warp-` in the log tell every page, to draw it:
  `render3d/waystone-effects.ts`).
- **Worker skeleton** (an altar ritual): a skeleton bound to work, with a heart of essence glowing blue in its ribs and
  in its eyes, a leather apron and a pickaxe on its back, after `icons/monster/worker-skeleton.png`. For now it is
  only put down and stands there (the `worker` building); it will be a worker you program, running on essence.
- **Bucket** (workbench): right click a pond (or a well) with it to fill it with fresh water, or the sea for salt water, and a barrel to pour it in (or, empty, to fill it from
  the barrel); right click bare ground to empty it out. **Ponds** are part of the ground, worked out from the seed (`waterAt` in `world-gen.ts`); nothing grows,
  is built or walks on them.
- **Raft** (stump or workbench: 20 logs and 10 rope): right click water with it to put it down, square to the world: it is 1.5
  tiles a side, its middle on the tile's, and has to be all on water (a pond or the sea), clear of the shore and other
  rafts (`raftFits`; a see-through raft under the mouse shows where it will go, red where it cannot go). It goes down
  **on your rope** (see On a rope), so walk away from the water and it is pulled in after you, right up against the
  shore, to step onto. It is not a
  building: it moves, so the server keeps the rafts (`apps/server/src/rafts.ts`) and tells each page where those near
  its player are with the players' positions (`r` in the state message), and pages draw them between, like the other
  players. It is drawn as seven logs lashed together with rope over two beams, half in the water, with a short post
  standing up from its middle for a rope. Rafts are saved. Log off aboard one and you come back aboard it, wherever
  it is by then; if it is gone (or where you were is somewhere nobody can stand), you wake at your sleeping bag, or
  the spawn, instead (`join` in `game-room.ts`).
  - **On a rope**: a raft starts on the rope of whoever put it down (taken off, the rope is theirs). Right click a raft
    with a rope to put it on its post, and the raft is pulled along after you (the
    same spring, a raft weighing what a player does, but it does not pull you towards the water; as far as the water
    lets it, sliding along the shore, and it stops drifting away from you: `Rafts.tow`), so you can pull one in to the shore. Right click it again
    to take the rope back; pulled past `LEAD_BREAK`, it snaps and falls at your feet. A raft can be tied to a fence too
    (see Fences).
  - **Boarding and riding**: walk onto a raft from the shore (it has to be up against the land, or all but: your body
    over its edge, or across a gap of a few hundredths of a tile) and you are aboard, just where that step takes you:
    still out over its edge, walking on in from there at your usual pace, so stepping on is one step like any other
    (it used to put you straight onto the deck, half a tile in one tick, which was the jump). Stepping off is a walk
    too: out over the edge a step at a time while there is land just past it, and off once all of you is clear of the
    water (`stepAboard`). Aboard, where you stand is kept on
    the raft (`Aboard`, from its middle along its own axes, in `packages/shared/src/rafts.ts`), so you go where it goes and turn as it turns, facing turning with it; the
    keys still walk you the way they point on the screen, about its deck, as fast as on land. You cannot walk off it
    into the water: you stop at its edge. Where the way you walk off its edge is land (with room for all of you, across
    a gap of up to a quarter of a tile), you step off onto it. Where it is another raft beside it, you step across onto
    that one (as onto a raft from the shore). Your own page
    plays your steps aboard just as the server does, against the raft where it draws it (`LocalPlayer.follow`), so
    riding is smooth.
  - **Rowing**: the **oar** (stump or workbench: 5 planks) is held in the hand like a spear. Its left click is a pull
    stroke and nothing else: the oar starts out the way you click, its blade in the water out there, and is dragged
    back in towards you and on under and behind you, and its streak in the air runs the same way, from its far end in
    to you (`pull` on the swish). It hits like a weak jab (`"row"` in `weapons.json`). Aboard a raft, it pushes the
    raft the way you clicked. It pushes from where you stand: from the
    middle of the raft it only moves it, from near an edge it turns it too, the more the further out and the more
    across the stroke is. The water slows it down, and its turning faster (it has friction), so it drifts to a stop. It
    stops against the shore (bouncing back a little) and other rafts. **Out in the deep sea** (off the shelf, where the
    sea is drawn dark: never on the shallows between two islands) it is much slower: a stroke pushes it less than a third as hard, it tops out
    at about a quarter of its speed, and it slows faster. Every number for how rafts move is at the top of the shared
    `rafts.ts`.
- **Barrel** (stump): holds eight buckets of liquid (water, tannin, milk: what the items in `items.json` with a
  `bucket` hold), and one slot of solids. It starts open: you see what is in it, a liquid in its colour at its level,
  which changes as soon as the liquid does (water to tannin). **Seal** it (a lid goes on) for what needs sealing (a
  sealed barrel takes nothing in and gives nothing out). What it makes is `"barrel"` in `data/stations.json` (the first
  recipe whose ingredients are in it is the one it works on; each has its own `seconds`, and can say the liquid and how
  many buckets of it, solids, solids `perBucket` or `liquidPerSolid`, a `heat`, what it makes, what the liquid turns
  into, how much of the liquid it uses up, whether it must be `sealed`, and whether it must be `dry`). Its recipe list
  is in two groups, **Sealed** and **Open**, and shows a liquid as itself (a drop of its colour, not a bucket), the heat
  a recipe needs (from a campfire beside it), "No liquid" (a drop struck through) for a recipe that must be dry,
  and an ingredient that can be any of a kind ("any organic") as each of them in turn, one a second; and how it goes,
  in a few words (`barrelHow`): "1 every 30 seconds" (one at a time) or "All every 120 seconds" (the whole lot at once).
  Its progress shows in its arrow. As it comes:
  - **Compost**: every 8 organic things (leaves, crops, seeds, acorns, berries, eggs) rot into one compost in a
    minute, in an open barrel with no liquid in it (a heap with flies over it shows it working).
  - **Tannin**: water with one bark for every bucket of it, boiled (`BOIL_HEAT`, 250°, from a campfire beside it), all turns into
    tannin in a minute and a half. With too little bark it does not start.
  - **Leather**: every dried hide in it is tanned at once, using a bucket of tannin each, in four minutes. Without a
    bucket for every hide it does not start; putting more hides in starts it again.
  - **Milk**: a bucket of milk can be poured into a barrel too, and drawn out again with an empty bucket, like water.
  - **Salt**: salt water (from the sea) boiled in an open barrel (`heat` 250, from a campfire beside it) boils away a
    bucket every 30 seconds, leaving a salt each time. Salt water and fresh water are different liquids: a barrel holds
    one or the other, and only fresh water waters a plot or makes tannin.
  - **Dough**: four flour and a bucket of water mix into a dough every 10 seconds, in an open barrel, no heat needed.
    Bake it in an oven for bread (20 health).
  - **Blood**: any raw meat (steak, chicken: `#meat`) in a sealed barrel kept at 200° (a campfire beside it) turns into a
    bucket of blood every 30 seconds, one for each piece of meat. It is a liquid like the rest: draw it off with an empty
    bucket for a bucket of blood. It is made from solids alone (`liquidOut` in the recipe: `count` buckets of it each
    time), so only in a barrel with no other liquid in it (or blood already), and not past full.

### Fighting

What you attack with is what the picked hotbar slot holds, if it is a weapon (`data/weapons.json`), or
your fists (Q puts away what you hold, or pick any slot without a weapon). The axe, pickaxe and knife are weapons too.
Attacking is the **left click** only, towards the mouse, from where you stand; the right click never attacks, whatever
you hold (it is for using things). Every attack puts every weapon on one cooldown, so switching does not get round it.

| Weapon | Damage | Harvest | Attack | Held down (charged) |
| --- | --- | --- | --- | --- |
| Fists | 6 | 1 | A jab | (keeps jabbing) |
| Knife | 12 | 2 | A short swing, standing still | None: held down, it goes on swinging (for gathering) |
| Axe | 16 | 3 | A swing, standing still | None: held down, it goes on swinging |
| Pickaxe | 16 | 3 | A strike, standing still | None: held down, it goes on striking |
| Club | 24 | 4 | A swing | A slam: 40, a strip 3.2 tiles long and 0.7 wide |
| Wooden spear | 18 | 3 | A thrust | Thrown: 26, 7 tiles; sticks in the ground |
| Flint spear | 26 | 5 | A thrust | Thrown: 36, 7 tiles; sticks in the ground |
| Bow | 22 | 4 | An arrow, 24 tiles a second, 16 tiles at most, after drawing for 0.3 s | Drawn while held: 36, 38 tiles a second, 22 tiles, at once |
| Sling | 14 | 2 | A stone, 18 tiles a second, 11 tiles at most, after a whirl of 0.4 s | Whirled while held: 24, 30 tiles a second, 15 tiles, at once |
| Oar | 5 | 1 | A stroke pulled in towards you, which pushes the raft you are aboard the way you click (see Raft) | None |

- **What you see**: your character holds what is picked (a weapon or tool's model; anything else's picture) and wears
  their armour, and every other player sees the same. A weapon or tool is carried raised up and forward in the fist (a
  spear more upright), a bow hangs in the left hand, and a sling's cords hang from the fist with the stone in its
  pouch; walking, the legs stride (knees bending as each foot comes through), the arms swing against them and the body
  leans into it and twists with each step (`stride` in `three-view.ts`, its numbers at the top of the file). Attacks are animated: a swing sweeps the weapon round through its
  arc, a thrust goes straight out, the pickaxe comes down from overhead, a bow is drawn back, a sling whirled once
  round over the head (its cords straight out from the fist, the stone gone once it is flung), and each lets fly with a streak of air out from the hand. Behind the weapon the air **swishes**: a pale streak tracing
  exactly what the attack covers (the same numbers the server judges hits by, `attack-shapes.ts`), so there is no
  indicator on the ground. You stand still while an attack is made, so the swing is not dragged about.
- Swings are not stopped by walls: a melee attack hits everything in its shape, whatever is between. What flies
  (arrows, sling stones, thrown spears, a monster's shots) stops at walls and anything solid.
- You only attack bare-handed (an empty slot, or Q) or with a weapon or tool: holding anything else, a click does not
  attack.
- With a weapon or tool held, an attack goes exactly the way the mouse points, whatever is under it: no tile lights up
  under the mouse, and a tree or rock there does not pull the aim to its middle.
- **Melee**, on a short cooldown: fists jab (a short, straight rectangle out in front, not a swing); the knife, axe and
  club swing (the knife short); the pickaxe strikes (a small circle a tile ahead, not a sweep); spears thrust (a long,
  straight rectangle). Every attack slows you to `ATTACK_SPEED_PERCENT` (70%) for `ATTACK_SLOW_TICKS` (0.3 s), so you cannot fight and run at
  full speed. Each hits **everything** in its shape (creatures, plants, rocks and buildings), so lining things up
  clears them faster. Each thing hit shakes, with a spark and a sound.
- A weapon has two numbers: its `damage` is what it does to a creature (before the creature's armour), and its
  `harvest` what it does to the resources it is for: an axe to trees and what you put down, a pickaxe to rocks; a bush
  takes anything's (`resourceDamage` in `weapons.ts`). Resource hp is in harvest (a tree 30, ten hits with an axe), and
  each building's is in `data/buildings.json`.
- **The bow and sling**: a click (let go at once) draws the bow back or whirls the sling once round (its `windup`), and
  the arrow or stone flies the way you aimed, from where you are when it goes. With nothing to shoot, they are not drawn back at all. A shot is drawn flying until it reaches what it hit.
  Each flies at most its weapon's `range` (`weapons.json`: an arrow 16 tiles, 22 drawn; a stone 11, 15 whirled), and
  then comes down. Arrows and stones that miss (fall short, or hit a wall) lie where they stop, to be picked up again.
- **Charged attacks** are all timing: with a weapon that has one, nothing happens as the button goes down; it charges
  while held (a bow is drawn, a sling whirled), and the attack goes when you let go. Held its `charge` (seconds, in its
  `charged` in `weapons.json`: 0.9 s for the bow; `CHARGE_TICKS`, half a second, for one that does not say; longer if
  the cooldown is not over), it is the weapon's charged attack (`charged` in `weapons.json`, see the
  comment at the top of `weapons.ts`); let go sooner (a click), it is the plain attack. Nothing is drawn to show the
  charge: only a soft, low creak in the background when it is ready (`charge-ready`). While charging you move at `CHARGE_SPEED_PERCENT`
  (45%). The page tells the server when the button went down (the `charge` command), and the server only lets a charged
  attack through that long after. Fists and tools with no charged attack keep attacking while the button is held, as
  before.
- **A thrown spear** flies its range and sticks in the ground where it comes down (or in whoever it hits, then the
  ground there), standing there as something to knock loose: hit it with anything and it drops, to be picked up. Where
  it cannot stand (on something, in water) it lies on the ground, or sinks.
- **Melee attacks step you forward** (all but a punch, and the tools, knife, axe and pickaxe, which you use standing:
  `"steps": false` in `weapons.json`) a little over `LUNGE_TICKS`, further the slower the attack: `LUNGE_PER_SECOND`
  (1.4) tiles for each second of its cooldown (`lungeDistance` in `weapons.ts`: a knife about 0.4 tiles, a club about
  0.8, a club's charged slam 1.4), whatever keys you hold, so backing off while swinging is cut short; a dash runs you its length over `DASH_TICKS`. These steps
  go in the movement input itself (a "push", `withPush` in `movement.ts`), so the page and the server move you exactly
  the same; the server only lets a player push so far in a while (`PUSH_ALLOWANCE`, refilling at `PUSH_REFILL` a
  second, in `game-room.ts`), so a page cannot fly about.
- **A moment's grace after a hit**: once something hurts you, nothing hurts you again for `HURT_GRACE_TICKS` (half a
  second), so you cannot be hit over and over at once; you flicker while it lasts. The cold still bites through it.
- **Hitting a creature** knocks it back a little (`HIT_KNOCKBACK`, 0.45 tiles) and stuns it for a moment
  (`HIT_STUN_TICKS`, a quarter of a second), after taking off its damage less its armour (`armor` in `animals.json` and
  `monsters.json`; always at least 1). Creatures hit flash red, call out, show the damage they took as a rising number,
  and animals run from whoever hit them. One killed shows the killing blow's number too, keels over, and shrinks away
  into its drops (which show once it has fallen).
- Hover over an item for what it is good for: a weapon's damage, food's healing, armour's warmth and defense.
- Attacks on creatures are judged against where you **saw** them: the page draws them a little in the past, so each
  attack says which tick it was drawing them at, and the server checks it against where they were then (up to
  `MAX_REWIND_TICKS`, half a second, back; `nearAt` in `apps/server/src/animals.ts` and `monsters.ts`). Arrows and stones
  fly on the server as they are, so they are not judged this way. A creature only flashes once the server says it was
  hurt.
- **Health** (100, `PLAYER_MAX_HEALTH`) is the top edge of the hotbar, with your body's temperature beside it (see "The
  cold"). Eat to get it back (F): cooked steak 40, cooked chicken 30, a fried egg 16 (an egg fried on a campfire at 150°), raw steak 10, raw chicken, berries and eggs 6
  (`heals` in `food.json`). Messages show above the hotbar. A player knocked back by a hit is carried over a few ticks
  (`KNOCKBACK_TICKS` in `game-room.ts`), quick but smooth.
- A **sleeping bag** (3 leather, at the stump) is put down like a building; right-click it to sleep in it, and you
  wake up beside it whenever you are knocked out, until it is taken away (then the spawn again). It is kept in the save.
- **Respawn** (Esc → Respawn), for when you are stuck (a raft lost out at sea): back at the world spawn, or at your
  sleeping bag (refused if you have none still there). You keep your health and your things, and you are taken off
  any raft; a rope you were holding snaps once you are far enough from what is on it (the `respawn` command;
  `moveTo` in `game-room.ts`).
- A hostile creature (a wolf, a skeleton) that is after a player has a red **!** over it and a red ring under it.
- **PvP**: players hurt each other with every attack (melee and shots), judged where the attacker saw them, as for
  creatures. A player hit flashes red with the damage rising off them, and one knocked out (no health left) wakes up
  at the spawn with all their health. The **host** (the player who made the game: the first to join it, kept in its
  save) can turn it off or on in **Esc → Settings → Game**; it is on to start with.

### Monsters

The skeletons, the skeleton archers, the frost lich and its wisps are **monsters**, not animals (`data/monsters.json`,
`apps/server/src/monsters.ts`): they have no hunger, sex, stats or breeding, only their hp, armour, speed and size, how
far off they notice a player (`aggroRadius`) and how far from home they chase one (`leash`), their attack, and what they
drop. They reach the pages by their own events (`monster` / `monster-`) and positions (`m` in the state message).
Chasing and finding a way round walls is shared with the animals (`apps/server/src/steering.ts`).

- A monster keeps where it is put (a camp's skeletons patrol round their fire; a dungeon's stand in their room) until
  it sees a player within its `aggroRadius` (walls hide you), and then goes for them, calling every other monster
  within `ALERT_RADIUS` (10 tiles) that can see it (a camp's skeleton calls its whole camp); hurt, it goes for whoever
  hurt it, and calls the others the same way. It gives up once the player is
  more than its `leash` from where it keeps, or has been out of its sight for `LOST_TICKS`, and goes back.
- **Skeletons** (80 hp, armour 5) carry a rusty sword, and have two attacks (`"blade"` in `monsters.json`), each with
  its own pose and sound as it comes (nothing is drawn on the ground), so you can tell them apart at a glance:
  - Close in, a **swing**: it raises its sword up and back over its shoulder (with a creak of bones and a scrape) for
    `swing.windup` (0.7 s), then cuts round it (15 damage and a knockback), leaving a red swish where it cut.
  - From further off (2.5 to 5 tiles), at most every 4 s, and only half the times it could (`charge.chance`, 0.5:
    otherwise it closes in to swing, and thinks of charging again after `charge.cooldown`, so a fight does not open
    the same way every time), a **charge**: it crouches low with its sword drawn back, its
    eyes blazing red and trembling, with a rising rattle, for a second (`charge.windup`). It aims where you were
    `charge.lead` (0.2 s) before, so if you keep moving it ends up a little behind you. Then it **dashes** 5.5 tiles at
    18 tiles a second, straight through anyone in its way (22 damage, knocked on the way it goes), leaning in, a red
    streak and a trail of dust behind it.
  After either it stands a moment (`recover`) before it can attack again. Winding up, swinging or dashing, a skeleton is
  not knocked back or stunned by your hits: get out of the way. They drop bones and essence.
- **Skeleton archers** (60 hp, armour 3) come within 7.5 tiles of you where they have a clear shot and shoot, with no
  line to warn you: a short aim (0.7 s, then 1.15 s before the next) and arrows (14 tiles a second, 20 damage) that fly
  through other monsters and animals. They aim where you were a moment before (`lead`, 0.2 s), so one who keeps moving
  is shot behind; standing still, you are hit. They drop bones and a few arrows.
- The **frost lich** and its **frozen wisps**: see "The dungeon".

### Animals

Animals wander in herds, keeping near others of their kind, and graze. **Each island keeps its own population** of each
kind that lives there (`biomes` in `animals.json`: chickens and deer in the forest, wolves in the mountains; cows
nowhere for now, though they are all still in the game): `population`, so many for every 10,000 tiles of the biome
(chickens 4, deer 3, wolves 3.5: on a medium world about 15 chickens, 11 deer and 12 wolves). A new world is stocked
to that from the start (`Animals.populate`). Then every 30 seconds (`POPULATE_EVERY`), each biome a player is on is
counted, and each kind with fewer wild ones there than it should have gets a herd half the time (`POPULATE_CHANCE`),
the kind furthest short first, somewhere on the biome's open ground at least 40 tiles (`SPAWN_AWAY`) from every
player, so herds are never seen turning up. Only wild ones count (your own, ones you have led, fed or bred, do not),
and none is ever let go.

**Animals are only run where something is going on** (`isActive` in the server's `animals.ts`): within
`ACTIVE_RADIUS` chunks of a player (one more than the chunks a page is shown, so none is seen standing still), or in a
chunk with something built in it (anything not `natural`: a fence, a feed box, a chest, a campfire; worked out every
2 seconds, `builtChunks` in `game-room.ts`), so a farm goes on while its players are away. Everywhere else they wait
as they are (they do not get hungry, grow up or wander) until someone comes back. One on a rope is always run. How fast they get hungry, grow, breed and so on is each kind's `life` and `stats` in
`data/animals.json`; the rest is at the top of `apps/server/src/animals.ts`. Animals have armour too (`armor`):
chickens and deer none, cows 1, wolves 3.

- **Deer** are skittish (`temper`): one runs from any player within `fleeRadius` tiles, or that hurts it, at
  `fleePace` times its speed (faster than a player runs), and its herd runs with it. Hunt them with a bow or sling. They eat berries from a feed box, which is how they are bred. They drop meat (raw steak) and hides.
  A deer is heavy on a rope (`mass`): it keeps running from you, and drags you along rather than being led.
  Running, it looks ahead for where the land runs out (`fleeTo`): straight away from you if it can, else turned aside
  a sixteenth of a turn at a time either way, taking the way that leaves it furthest from you, so it runs along the
  shore and out of a corner rather than into the water. Only the shore and ponds are looked for: fences are not, so a
  herd can still be penned in.
- **Wolves** (70 hp, armour 3, a bite of 12) are hostile and territorial (`hunt` in `animals.json`): a wolf leaves a player alone until they come
  within `aggroRadius` tiles or hurt it, and then it goes for them, and so does every wolf of its pack within
  `packRadius` tiles. They chase at `pace` times their speed (faster than a player: you cannot outrun them, only get
  past their `leash`), bite for `damage` every `cooldown` seconds from close up (their size and yours, and `reach`
  between), and give up once the player is more than `leash` tiles from where they live, and run home fast
  (`RETURN_PACE`); hit one on the way and it turns on you again. With `flank`, a pack does not run straight in: they spread round you
  `FLANK_RING` tiles out, at least `FLANK_SPREAD` apart, and dart in to bite from their side, falling back between bites
  (`flankPlace` in `animals.ts`). Fences keep them out. **Hit one and it backs off**: out to that ring round you, on
  its own side, and it does not bite again for its `recoil` (1.2 s, in its `hunt`; counted from the end of the hit's
  stun), so you are not bitten straight back. They drop hides and fangs. Each **pack has its ground**
  (`territory`, 36 tiles): a pack that turns up by itself all lives at one spot, no new pack turns up within its
  territory of another, a wolf strays at most half of it (or `HOME_RANGE`) from home before heading back, and a pack
  only keeps together with its own (not another that wanders near), so packs do not clump together.
- **Noticing.** A hostile animal only notices a player it can see (a dungeon's walls hide you), within its leash of
  home. One that gives up a chase goes home and will not take another up by itself for `CALM_TICKS`, so one at the edge
  of its ground does not keep giving up and coming back.
- **Pathfinding.** A hunter whose straight way to you is blocked (a wall, a fence, a tree) finds a way round over the
  tiles near it (`findPath` in `steering.ts`, shared with the monsters), never cutting corners; wolves only flank in
  the open.
- **Male and female** look different at a glance: a bull is dark and long-horned, a cow pied with an udder; a rooster
  has a tall comb and a dark sweeping tail, a hen is brown with a small comb; a buck has antlers; a male wolf is bigger
  and darker with a heavy black mane.
- **Hunger.** It fills from 0 to 100% over `hungerMinutes`. At `hungryAt` or more an animal goes for the nearest tuft
  of grass within `grassRadius` tiles and eats it (taking `grassFills` off its hunger); at half of `hungryAt` it only
  nibbles grass right beside it. Not well fed and at half of `hungryAt`, it goes to a feed box with food it likes
  first, however near the grass is (a chicken goes to its seed box, not the grass through the fence); with such a box
  in reach (`FEEDER_RADIUS`, 10 tiles) it never grazes, and while well fed it does not eat at all, so a farm's
  planted grass is left to grow. On its way to
  food it looks again every second or two, and goes for what it would pick now (a box filled meanwhile); food it could
  not get to (it got stuck: grass through a fence) it lets be for 20 s (`SHUN_TICKS`, `foodGoal` in `animals.ts`). Grass never makes it well fed; a feed box does, for `wellFedMinutes`.

- **Stats and genetics.** Every animal is male or female and has stats: a cow its meat, milk and growth time; a
  chicken its meat, egg lay time and growth time. A wild one gets each stat's base give or take its spread
  (`animals.json`).
- **Breeding.** Two adults of a kind, one of each sex, both well fed (from a feed box), not bred in the last
  `breedCooldownMinutes`, and within 8 tiles of each other, go to each other and have a baby, however many of the kind
  are about already (a farm grows as big as you keep it fed). Breeding uses up being well fed. The baby's stats are the average of its parents', give or take a little.
  It is drawn small and grows up over its growth time.
- **Products.** A hen lays an egg on the ground every egg lay time. A cow builds up milk (one every `milkMinutes`, up to
  her milk stat); right click her holding an empty bucket to milk her: it becomes a bucket of milk, one bucket
  a click, and she keeps the rest of her milk for the next.
- **Food and gates.** A hungry animal goes for a feed box with something it eats over grass it can see. It only goes through an open gate to get to food, or on a rope; wandering, it stays on its side.
- **Killing.** A grown animal drops about its meat stat in meat (steak or raw chicken) and its hide or feathers; a
  baby drops nothing.
- **Debug view (F3):** hover over an animal to see what it is doing, its sex, age, hp, hunger (and where it counts as
  hungry), whether it is well fed, who leads it, and its stats against its kind's wild range.
- **Sapling**: planted from an acorn with a right click. It grows a stage on each of its random ticks (see below) and
  becomes a tree after four, about 45 seconds on average. Punching it digs the acorn back up.
- **Berry sprout**: planted from berries. It grows a stage on each of nine random ticks (`SPROUT_STAGES`, about 100 seconds in all),
  drawn as a young clump of light green leaves with no berries that gets bigger each stage, then becomes a full bush
  with berries; punching it before then gives the berries back.

What a punch knocks loose lands on the ground round the plant, between half a tile and a tile from its middle. Walk
within a tile of an item to pick it up (once it has lain there `PICKUP_DELAY_TICKS`, so it is seen landing; what does
not fit stays on the ground); what you pick up is listed over the hotbar on the right. Items left lying are gone after
two minutes (`DROP_LIFETIME_TICKS`). `DROP_ITEMS_ON_GROUND` (or `dropsOnGround` for one game) set to false puts drops straight into the
inventory instead. A health bar shows over a plant that has been punched. You reach 10 tiles from where you stand.

The inventory is 27 slots and, under them, the 9 slots of the hotbar, with an **ammunition** slot beside the armour:
it takes only arrows and sling stones (items tagged `ammo`), which go there first when picked up, and are shot from it
first. Beside it is the **food slot**, which takes only food: F eats from it (more of what is in it goes there by itself
when picked up). Last is the **trash** (`TRASH_SLOT`, with a red bin in it). There are no words on these slots: each
has a faint picture of what goes in it while it is empty (a helmet, a tunic and a boot for the armour, an arrow, an
apple; `SLOT_MARKS` in `inventory-view.ts`), and a tip on hovering. The trash: it holds one stack, which nothing goes
into by itself and which does not count as yours for crafting; put another kind of item there and what was in it is
thrown away for good; put more of its kind there than it has room for and the oldest of it goes, so stack after stack
of one thing can be thrown away. Drag a stack onto any slot, of your inventory or of what is open: onto a stack of its kind it
fills it up to a stack and the rest stays where it came from; onto another kind they swap. Drag with the right button
to move half a stack; drag with the middle button to leave one on each slot it passes over. Drag a stack off the panels to drop it on the ground there (a tile and a half off, towards where you let
go; it never lands past a fence or a wall). With a building open, click a stack to move it across, right click to move
half of it, middle click to move one (hold the middle button still and, after a moment, one after another, faster and
faster); Shift-click to move every one of that kind. Put into a building, it comes from the stack clicked first, then
your ordinary slots: never your food, ammunition, armour or trash slots (unless that is the one clicked), and Store all
leaves them too (`transferItems`). With only your inventory open, click a stack in the hotbar to move it up into the inventory (as
high as it goes), or one in the inventory to move it down into the hotbar. Over a stack, 1–9 swaps it with that hotbar
slot. Moving items makes a soft tick. An open chest or station closes as soon as you walk out of reach.

**Chests** have a name (type it in the box at the top of the chest; it shows over the chest when you hover it), **Sort**
(stacks merged, in item order) and **Top up** (each stack the chest has is filled to a full stack from your inventory,
not the hotbar, and no further: nothing new goes in).

Solid things stand in the way with their own shape, not their whole tile (`BUILDING_BOUNDS` in `buildings.ts`): a
tree's trunk, a barrel's round, a drying rack's frame from post to post (nobody walks through it). Each is one of a few
standard sizes (`FOOTPRINT`: `block` for the stations, fires, chests, feed boxes, wells and rocks; `small` for a
barrel; `trunk`; `frame`), never a size of its own, so two things side by side line up exactly and leave no small lip
to catch on; a new building picks the nearest one and its model is fitted to it. And a player walking straight into
the very edge of something (within `CORNER_SLIP`, a quarter of a tile, of its corner) slips round it instead of
stopping dead (`slipAround` in `movement.ts`).

**Crafting** by hand (the first tools, and the stump) is to the right of the inventory (with no chest open): a grid
of pictures that scrolls, in the groups every recipe book has (the `"player"` station in `data/stations.json`; see the workbench),
what you cannot make yet greyed out. Click one to see what it takes (green where you have enough,
red where not) and craft it. Fiber makes rope (three to one), and sticks, rope and flint make a makeshift pickaxe or axe (2 rope each) or
knife (1 rope) (the knife cuts grass for
hay and kills animals faster). Hover over any item for its name. The recipes are `"player"` in `data/stations.json` (a recipe's number in a `craft` command is its place in that
list, from 1, so a new one goes at the end); tools do not stack (`"stack": 1` in
`data/items.json`). What each weapon and tool does to what it hits is in `data/weapons.json` (see "Fighting").

The world grows trees (scattered, and thicker where a forest is), bushes (in patches of 1–5), rocks (in groups of 2–5) and flint, from the
seed: every chunk with land in it, both islands whole, when the world is made (`islandChunks` in `terrain.ts`;
`growIslands` in `game-room.ts`, a fraction of a second; a world saved before that gets the rest when it is loaded),
and any other chunk the first time a player comes near it. How much grows is `DEFAULT_PLANT_GENERATION` in `world-gen.ts`
(trees in the open and in forest, how much is forest, how often a bush patch or a group of rocks appears and how many
it has, flint per 1000 tiles, and the clearing round the spawn); a game can be given its own with the room's
`plantGeneration` option. Nothing grows within five tiles of the spawn. A player inside something solid (a tree
that has just grown where they stand) is pushed out to the nearest place they fit.

**Put away for later:** ore deposits are off (`ORE_DEPOSITS` in `world-gen.ts`), and nothing in the game builds the
factory's buildings any more. The simulation, the server's `build`/`remove` commands and their tests are all still
there, ready to be given back to the player.

## Art

The world's models are built in code (`apps/client/src/render3d/models.ts`; there are no model files yet). The pictures
under `res/` are the items' icons, shown in the inventory, the hotbar and the recipe lists, and for items lying on the
ground: each item's is its `icon` in `data/items.json` (or `icons/items/<key>.png`, an ore's `icons/ores/<key>.png`).
**To replace one, save a PNG at its path.** The game uses the file wherever there is one and draws a stand-in where
there is not (a gem in the item's colour, or a little picture for a few); no code changes (`apps/client/src/ui/icons.ts`).
The dev server picks a new file up on reload (a hosted build needs `npm run build`). Square pixel art at 32 or 64 pixels
looks best.

## Sound

The sounds are in `apps/client/src/audio/sounds.ts`: punching a tree (`punch-wood`), punching a bush or sapling
(`punch-leaves`), hitting a rock (`punch-stone`), a tree falling (`break-tree`), a bush cleared (`break-bush`), a rock
broken (`break-rock`), the attacks (`attack-jab`, `attack-swing`, `attack-thrust`, `attack-shoot`, and `attack-draw` as
a bow is drawn or a sling whirled), a charged attack ready to let go (`charge-ready`) and let go (`attack-spin`,
`attack-slam`, `attack-dash`), a skeleton raising its sword (`monster-raise`) and crouching to charge
(`monster-charge`), a creature hurt (`animal-cow`, `animal-chicken`, `animal-deer`, `animal-wolf`,
`animal-skeleton`, `hit-animal`), being hurt yourself (`hurt`), the lich casting (`cast`) and its blizzard
(`blizzard`), a spike trap set off (`trap-click`) and its spikes coming up (`trap-spikes`), planting (`plant`), picking
an item up (`pickup`), pushing through a bush (`rustle`), eating (`eat`), sleeping (`sleep`), crafting (`craft-one` for
a click, `craft-some` for shift, `craft-all` for ctrl, and `craft-fail` when it cannot be done: nothing to make it from,
or the output slot full of something else), and footsteps (on a raft's logs, a hollow wooden knock: `step-wood`; only
walking about its deck makes them, not the raft drifting). Each is made up with Web Audio until there is a file for it.
**To replace one, save a file under `res/sounds/`** named after it, with any number of numbered variants picked at
random: `punch-wood.ogg`, `break-tree.ogg`, `step-grass.ogg` or `step-grass-1.ogg`, `step-grass-2.ogg`, ... (`.ogg`,
`.mp3` or `.wav`).

**Where a sound comes from.** What happens in the world (hits, attacks, creatures, traps, spells, other players) is heard
from where it happens: quieter the further off it is, panned to its side, and not heard at all beyond `HEAR_RADIUS` (26
tiles). What the other players do (their footsteps, their attacks, their being hurt) is heard too, under a volume of its
own.

**Esc → Settings → Audio** has a master volume, and under it one for effects (punching, falling, planting, picking up),
one for footsteps (steps and rustling) and one for **other players** (half to start), and a mute. They are kept in the
browser.

**Each sound's own volume** is `SOUND_VOLUME` at the top of `sounds.ts` (1 as made, 0.5 half as loud, 2 twice as
loud), on top of the settings: tweak it to balance the sounds against each other. Footsteps are at 0.45, the rustle
of a bush at 0.6, everything else at 1.

**A new sound** is a recipe in `RECIPES` in `sounds.ts` (its key there is its name, which is all the names there are:
`SoundId`) and its volume in `SOUND_VOLUME`; the compiler asks for the volume if it is left out.

Footsteps sound like the ground underfoot: `surfaceAt` says what surface a tile is (`grass` in the forest, `sand` by the
sea, `stone` on the mountains' bare rock, `snow` exactly where the ground is drawn white (`snowOnTile` in
`apps/client/src/snow.ts`, which the ground and the map use too), `ice` in the dungeon), and each surface has its own
`step-<surface>` sound. A new surface is a name in `Surface`, a case in `surfaceAt`, and a recipe in `FOOTSTEPS` (with
its `step/<surface>` entry in `RECIPES` and `SOUND_VOLUME`) or files of its own.

## Networking

The server is the authority. For the factory it sends the **inputs**, not the state: every client runs the same
deterministic simulation of the chunks near it, a few ticks behind the server, driven only by the server's log. Players'
positions are ordinary state replication.

**Animals** are not part of that simulation: they cross chunk edges freely, so the server alone runs them
(`apps/server/src/animals.ts`). Where the ones in a player's chunks are goes with the players' positions in each state
message (`n`), and pages draw them a little in the past like other players; what each one is (`AnimalInfo`: kind, sex,
stats, growth, hp, hunger, who leads it) goes on the log whenever it changes (`animal` / `animal-` events). What they do
to the world (grazing a tuft, eating from a feed box, laying an egg) is logged as world events like a command's.
**Monsters** are the same, with their own events (`monster` / `monster-`) and positions (`m`). A rope
pulls the player on the server (the spring: `ropeForce`, `ropeStep`); the page pulls its own predicted player the same
way, towards where it reckons the animal is now (`TETHER_AHEAD` ticks past the newest position sent, going on as it
was going: `RemotePlayers.ahead`), not where it is drawn (a little in the past), so being dragged feels immediate. The
player's rope speed is part of what the page replays its inputs from: the server sends it with the player's position
(the state message's `v`). A spring is forgiving of the page's guess being a little off (a little off makes a little
difference), so the reconcile only has to tidy up.

### The factory is deterministic

- Everything in the simulation is a whole number: positions are fixed-point units (`SUB` = 256 to a tile), times are
  ticks (`TPS` = 30). No floats are read or written by the simulation.
- Random numbers come from seeded integer hashes and generators (`rng.ts`); world generation (`world-gen.ts`) is a pure
  function of the seed and the tile, so the ground is never sent: every client works it out.
- Everything is walked in a stable order: chunks by chunk ID, buildings by entity ID, links by link ID. Never in the
  order of a hash map.
- **Random ticks** (`Chunk.step`): each tick, after its buildings have moved, every chunk gives `RANDOM_TICKS_PER_CHUNK`
  of its tiles a random tick, picked by a hash of the seed, the tick and the chunk. Every copy of the chunk picks the
  same tiles, so growth is random to a player and identical everywhere. A sapling grows a stage on each.
- Plants are generated by the server, not by each client: when the world is made for the islands (and the first time
  a player comes near any other chunk), the server grows its trees and bushes (`plantsInChunk`) as ordinary buildings, and clients get them in the chunk's snapshot. After
  that they change like anything else: a punch is an `hp` world event, a fallen tree a `remove`.
- **Items on the ground** (`sim/drops.ts`) belong to the chunk they lie in, are part of its snapshot and its hash, and
  change only by world events from the server (`drop+` when one lands, `drop-` / `drop=` when it is picked up or
  expires). Any number can share a tile. The server decides pickups each tick, after movement.

### Chunks, ports and links

The world is split into chunks of 32 × 32 tiles (`sim/chunk.ts`). Anything that crosses from one building to another
goes through a **port**: a building's output port offers an item (the item waiting at the end of a belt, or the first item
in an inventory) and its input port takes items in (`sim/ports.ts`). A **link** joins an output port to an input port by
the two buildings' IDs (`sim/links.ts`). The server works out the links when a building is placed (a belt facing into
something, an extractor with an inventory behind it) and sends them to every client that simulates either end, so a
client never has to look into a chunk it does not have. A chunk never reads another chunk's memory.

Each server tick (`GameRoom.step`):

1. Movement inputs are played.
2. The commands due on this tick run, in order of (tick, player ID, sequence). What they change is written as world
   events (`sim/world-events.ts`) that the server applies to its own world with the same function the clients use.
3. **Phase A** (`FactoryWorld.stepInterior`): each chunk moves its own buildings on (belts move items, miners dig) and
   leaves what is to go elsewhere in output ports.
4. **Phase B** (`FactoryWorld.exchange`): the links, in ID order, each move at most one item from an output port to an
   input port if the receiving end takes it. This is where global networks (power, item teleporters) will resolve too.
5. **Phase C**: each client is sent its part of the log for the tick. For a link whose ends a client both simulates, it
   works the link out itself. For a link where it simulates **exactly one** end, it is sent the result: `accepted`
   with the item each time one crosses, and `blocked` / `unblocked` only when that changes. Then chunk hashes, chunks
   to start or stop simulating, and everyone's positions.

### The log

The log is a reliable, ordered stream (`reliable-stream.ts`) built on Geckos' unreliable channel: messages are numbered,
the receiver holds back any that arrive early and answers with the last number it has everything up to, and the sender
resends what is not answered in time. A tick with nothing logged sends no log message at all: each state message says
which log message was the last sent before it (`s`), so a client with that message knows the log is complete up to the
state's tick. Big batches are split under `MAX_PACKET_CHARS`.

A client (`FactoryMirror`) simulates a tick only once the log is complete for it, applying in order the commands' world
events, phase A, phase B with the server's results for its one-sided links, and then the end-of-tick events. Its
simulation never guesses, so it never rolls back.

**Joining a chunk** is a snapshot of the chunk as it is at the end of tick T, then the log from T + 1. The server
subscribes a client to the chunks within two of its player's chunk and lets go of those more than three away (so walking
back and forth over an edge does not reload chunks). The switch happens at the end of a tick on both sides, so the server
and the client always agree which links are one-sided.

**Desyncs.** Every 30 ticks (each chunk on its own tick, to spread the work) the server sends each chunk's hash to the
clients simulating it. A client whose copy hashes differently, or that is told an item left one of its buildings when the
building was not offering it, reports it and is sent the chunk again. In development the server keeps a copy of each
chunk at its hash ticks and sends it back, and the page prints what differs (`desync-diff.ts`) in the console. Press F9 to
try it.

### Commands

The page sends **intents** (`commands.ts`: build, remove, take from, put into, attack, work a station...) stamped with a tick the server
has already run: the tick of the state message that would be arriving now (`TickClock.commandTick`). So the server runs
each on the very next tick after it arrives, and a command is never held back waiting for a tick of its own: what the
player does takes effect a one-way trip after they do it, and they see it a round trip after. They go over the same kind
of reliable stream the other way. The server runs each against the world as it is then: it does it, does as much as it
can ("take up to 50"), or turns it down, and logs the result. One stamped more than five seconds ahead is turned down.

Each command has a schema in `protocol-schemas.ts`, which the server checks every request against; a command added to
`commands.ts` without one does not compile. (`punch`, a single hit on one plant, is only sent by the tests now: the
page attacks with `attack`, which hits everything in the weapon's shape.)

The stream is strictly in order, so a request the server cannot read (it fails the checks in `protocol-schemas.ts`)
must not be dropped: everything after it would wait for it forever, and the player could still walk about but nothing
they did would take effect, and what they did would undo itself when its prediction ran out. Instead it is logged
(`unreadable request`) and answered as a refused command (`invalid`), and the stream goes on. The page also refuses to
send a command with a number in it that is not a number (NaN goes over the wire as null), and tells the player when
commands have gone unanswered for a while (`STALL_WARN_MS`).

What the player sees at once is a cosmetic **prediction** drawn over the factory (`prediction.ts`): a ghost of a building
asked for, a red cross on one being removed, and items already moved between the inventory and a chest. Each is
dropped when the command's result is simulated, by which time the real thing has taken its place.

### Player movement

The player's own character is predicted: each tick's keys are an input, played at once and sent (with the last few
again, in case one is lost). The server plays them on its own copy, one a tick, and two (`MAX_INPUTS_PER_TICK`) to
catch up when more than three are waiting, or two or more have been waiting for `INPUT_BACKLOG_TICKS` ticks in a row, so
a hiccup on the way does not leave the server a tick or more behind the player for good. When the server says where the
player is and which input it has played up to, the page replays the inputs it has not played on top of that
(`LocalPlayer.reconcile`): rollback for one entity. Movement is whole numbers, so this lands exactly where the page had
the player unless something was lost. Players stop against solid buildings (`stepPlayer` with `solidIn(world)`);
the page checks against its copy of the factory, which is a few ticks behind, so next to a building that has just gone
up or come down the server can disagree for a moment and the reconcile puts it right. The player is not drawn jumping
to where it was put right: drawn where it was, it is eased there, the difference shrinking to a third every
`SMOOTHING_MS` (110 ms), unless it is more than `SMOOTHING_SNAP` (3 tiles: a teleport), drawn at once
(`LocalPlayer.smoothing`). Aboard a raft, only how far their place on its deck was put right is eased (the raft moving
on between the server's word and the page's is not a correction); stepping aboard, off, or across to another raft is
not eased at all. A player only collides with tiles
it is not already over, so one caught under a new chest walks out. Other players are drawn three ticks in the past, between two positions the
server sent.

### Timing

The page works out the server's tick from when its state messages arrive (`TickClock`). It simulates the factory as
soon as the log is complete for a tick (there is no playout delay: nothing is held back), stepping it at the server's
rate and drawing items between their last two positions so they glide at any frame rate; a long way behind, after a
stall, it catches up a slice at a time so no frame is held up for long. Other players and creatures are drawn a few
ticks in the past, between two positions the server sent.

### Leaving

A page that closes, or goes back to the menu, tells the server it is leaving (`leave`, reliable) before it lets go of
the connection, and the server takes its player out of the game at once: everyone else sees them go (and is told), and
nothing more is sent to that connection. A page that just goes quiet (a lost connection, a crashed tab) is taken out
once Geckos notices, or after `SILENT_MS` (12 seconds) without a word from it, whichever is first.

### Not built yet

Global systems such as power grids and logistics networks, which are virtual server-only objects that clients never
simulate and only receive logged results for (`grid 12 satisfaction=0.83 from T`), and display-only values sent
throttled to the clients viewing them. Their place is phase B and the log, and nothing here assumes they are absent.

## Adding a building or an item

- **An item**: add it to `data/items.json` with the next `id` (the numbers are part of the protocol); its `key` is how
  recipes and the code name it. Its picture is its `icon` under `res/` (until there is one, it is drawn as a stand-in;
  see "Art"). An item with `places` is put down as that building with a right click.
- **A recipe, crop or station recipe**: add it to its file in `data/`. A crop needs its seed item to say `"crop"`, and
  a model of its stages in `render3d/models.ts`.
- **An animal**: add it to `data/animals.json` (it needs a `growth` stat; `milk` needs a `milk` stat and `lays` an
  `eggTime` one), and its model in `render3d/models.ts` (picked by `animalModel` in `three-view.ts`).
- **A monster**: add it to `data/monsters.json` (its `attack` is one of the kinds in `packages/shared/src/monsters.ts`),
  and its model in `render3d/models.ts` (picked by `monsterModel` in `three-view.ts`). How it behaves is in
  `apps/server/src/monsters.ts`; what every creature does alike (being hit, pushed, remembered for judging attacks) is
  `CreatureSet` in `creatures.ts`, and the page keeps track of it with `CreatureTracks` (`creature-tracks.ts`).
- **A plant**: like a building (below), with `natural: true` and its hp in `data/buildings.json`; what a hit drops is in
  `hit` in `apps/server/src/commands.ts`, and what a random tick does in `randomTick` in `sim/entity.ts`.
- **A building**: add it to `BuildingKind`, `BUILDINGS` and `BUILDING_KINDS` in `buildings.ts` (and, if it is hit, its hp
  to `data/buildings.json`); give it state and a
  phase A step in `sim/entity.ts` (and its snapshot and hash there); say what its ports offer and take in
  `sim/ports.ts`; say what it links to in `sim/links.ts`; and give it a model in `render3d/models.ts` (picked by
  `buildingModel` in `three-view.ts`). The compiler points at every `switch` that needs a case. A building that works
  on items in its slots (a machine) also needs its slots in `MACHINE_SLOTS` (`sim/entity.ts`), works them with the
  slot helpers in `inventory.ts`, and shows them in its panel (`machine-views.ts` in the client). A new station is a
  kind in `STATION_KINDS` with its layout in `STATION_LAYOUT` (`stations.ts`) and its recipes in `stations.json`.
- **A change to what a building keeps** (its saved fields): bring older saves up to date in `upgradeEntity`
  (`apps/server/src/save.ts`), so worlds saved before still load.

## Testing the netcode

- Open the page with `?lag=120&jitter=40&loss=0.05` to simulate a bad network in both directions (change it live with
  `window.lag` in the console).
- F3 shows the server's tick, how far behind the factory is drawn, the round trip, the chunks simulated, how many links
  take the server's word, and desyncs. On the map it draws the simulated chunks' edges and the links: green worked out
  here, blue taken from the server, red blocked.
- `npm test` runs the simulation and netcode tests, including clients that see only one side of a chunk edge and a
  client on a lossy, shuffling network, checked against the server tick by tick.

## Settings

The camera's zoom levels (`ZOOM_MIN`, `ZOOM_MAX`, `DEFAULT_ZOOM`, `ZOOM_PER_NOTCH`, `ZOOM_SMOOTHING_MS`) are in
`packages/shared/src/constants.ts`.

Environment variables for the server and the dev server:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLIENT_PORT` | `5173` | The public web port |
| `API_PORT` | `9300` | The game API (forwarded from `/api`) |
| `GECKOS_PORT` | `9301` | Geckos signalling (forwarded from `/.wrtc`) |
| `WEBRTC_PORT_MIN` / `WEBRTC_PORT_MAX` | `10000` | The UDP port(s) the game traffic uses |
| `WEBRTC_ICE_SERVERS` | Google STUN | Comma-separated STUN/TURN URLs; empty for none |
| `DESYNC_DUMPS` | on unless `NODE_ENV=production` | Keep chunk copies for desync diffs |
| `SAVES_DIR` | your user data folder (`%APPDATA%\FactoryGame\saves` on Windows) | Where the worlds are saved, a file each |

To host it, open TCP `5173` (the page; Vite forwards the API and signalling to the server) and UDP `10000` (WebRTC).
Running worlds are saved to `SAVES_DIR` every minute, and close (saved) ten minutes after the last player leaves.
