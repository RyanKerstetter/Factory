# Factory Game

A multiplayer sandbox factory game in the browser, built with TypeScript, PixiJS, Geckos (WebRTC) and Vite. For now it
is the start of the game: players punch trees and bushes for what they drop and plant acorns, together in one world. The
factory (miners, belts, extractors, chests) and ore deposits are built and simulated but put away for later.

## Run it

```sh
npm install
npm run dev
```

Open the address Vite prints (port `5173`). Type your name, then:

- **Create game**: a new world, with a name (no two worlds share one), a seed (empty for a random one), a **world size**
  (Small, Medium, Large, Extra large) and how bumpy its coastlines are (0, near round, to 100, deep bays and long
  points); the size and bumpiness are for **Play offline** too. Its name and six-letter code are at the top left; click
  them to copy an invite link (whoever opens it lands on Join game with the code filled in).
- **Load game**: the saved worlds that are not running. **Load** starts one again where it was left. **Export** downloads
  a world as a `.json` file, and **Import from file** adds one (under a new name if its own is taken). **Delete** removes
  a saved world for good, after asking (`DELETE /api/saves/<code>`; not one that is running).
- **Join game**: the worlds running now, by name, with who is in them; or one by its code.

**Saving.** The server keeps each world as a file, `<code>.json.gz` (gzipped JSON), in its saves folder (`SAVES_DIR`, by default `saves`
where the server is started): every minute (`SAVE_EVERY_MS` in `apps/server/src/index.ts`), when the world closes (ten
minutes after the last player leaves), and when the server is stopped with Ctrl+C. Restart the server and the world is
in Load game. A save holds the seed (the ground is worked out from it again), only what differs from what the seed
grows in each chunk (what was built, changed, or grown since, and the IDs of what the seed grew that is gone: the rest
is grown again on loading, with the same IDs, so a world nobody has changed much is a few KB), the animals, and every
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
| `npm run typecheck` | Type-checks the client and the server (and the shared code with each) |
| `npm run build` | Builds the client into `apps/client/dist` and type-checks the server |
| `npm start` | Builds the client once and serves it with the server, for a steadier setup than `dev` |

## Project structure

- `data/` holds the game's data as JSON, read by the shared code when it loads, which stops with a message naming the
  entry if one is wrong. The dev server picks a change up on reload; restart the game server too, since it reads them
  once.
  - `items.json`: every item: its number, key, name, picture (`icon`, under `res/`), what it puts down (`places`), its
    tool kind, its stack size, its `tags` (such as `seed` or `meat`), and the crop a seed grows (`crop`).
  - `recipes.json`: what can be crafted by hand from the inventory.
  - `stations.json`: what the stump, the workbench, the barrel and the drying rack make: what each recipe takes, the
    tool it needs, what it makes, how long it takes (`seconds`), and its category in the list.
  - In `items.json` too: how hot a fuel burns and for how long (`fuel`), what a food cooks into on a campfire and at
    what heat (`cooks`), and buckets (`bucket`). Items tagged `organic` rot to compost.
- The attacks are not in `data/`: each is different enough that they are all in one file of code,
  `packages/shared/src/attack-defs.ts`, with every number (damage, reach, arc, cooldown, windup, knockback, speeds) in
  tiles, seconds and degrees, to tweak in one place.
  - `crops.json`: what grows in garden plots: its seed, how long it takes (in random ticks, about 11 seconds each), and
    what breaking it when grown gives.
  - `animals.json`: the animals: their hp, speed, size, how hard they pull on a rope, what they eat from a feed box,
    their herd size, what they drop, milk and eggs, and their stats (see "Animals").
- `packages/shared` is everything the server and the client must agree on: the deterministic factory simulation
  (`src/sim/`), the items and buildings, world generation, player movement, the commands, and the protocol.
- `apps/server` is the game server: a small HTTP API to make and find games (`index.ts`), and one `GameRoom` per game
  (`game-room.ts`) that runs the authoritative world and decides what each client is sent. `commands.ts` runs the
  players' commands.
- `apps/client` is the page:
  - `main.ts` shows the main menu and starts a game.
  - `game.ts` runs one game: the connection, the page's copy of the factory, the player's input, and each frame. It
    works out what to draw and hands it on; it draws nothing itself.
  - `factory-mirror.ts` is the page's copy of the factory, simulated from the server's log (see "Networking").
    `local-player.ts` predicts the player's own movement, `remote-players.ts` smooths the others,
    `prediction.ts` draws what the player has asked for before the server answers, `tick-clock.ts` keeps time with the
    server, and `connection.ts` is the Geckos channel.
  - The world is drawn by a `GameView` (`render/game-view.ts`), handed a plain `WorldFrame` each frame; neither view
    knows anything of the network or the simulation. **Esc → Settings → Graphics** picks which (from the next world
    you enter):
    - **3D** (the default), `render3d/`: three.js, seen from the south at an angle through an orthographic camera, with
      the grid square to the screen (north is up), as in 2D. Every model is built in code from simple
      low-poly shapes in `render3d/models.ts` (one function per thing: the caveman, trees, bushes, rocks, grass, each
      building, cows and chickens, arrows and spears); `ground.ts` is the ground and ponds; `paint.ts` paints the
      indicators and tile frames onto the ground and makes the words; `three-view.ts` puts it together (camera,
      sunlight and shadows, picking what is under the mouse). Items on the ground use their icons.
    - **2D**, `render/`: PixiJS, flat from above, from the pictures under `res/`. `WorldRenderer` stacks its layers in
      a fixed order (ground and ore, buildings, items on belts, the placement overlay, players, the debug view).
  - `ui/` is the page's own elements over the canvas: the menu, the build bar, the inventory panels, the top bar, the
    Escape menu and the debug text.
- `res/` holds the art (see "Art").
- `tests/` runs with `node:test` through `tsx`. `helpers.ts` wires a real `GameRoom` to real `FactoryMirror` clients
  through the same reliable stream the page uses, over a pretend network that can lose and shuffle messages.

## The world

The world is a chain of **biomes**, one per step of the game, in the sea (`packages/shared/src/terrain.ts`). Each is a
rough disc round a middle, its radius set by the world size (`WORLD_SIZES`) and its coast pushed in and out by noise
(the bumpiness, up to `MAX_BUMP_PERCENT` of the radius). A biome joins the one before and after it in the chain side by
side, cutting into it by `BIOME_OVERLAP_PERCENT` of the smaller radius (and a band along the line between their
middles is always land, so no bay cuts them apart); biomes that are not next to each other keep at least `OCEAN_GAP`
tiles of sea between them. The sea is water: nobody walks into it. The order and each biome's size, temperature and
what grows back in it are `BIOMES`.

The sea is pale on the **shelf** by the land, out to about `SHELF_TILES` (give or take a little, so its edge wanders),
and dark in the **deep ocean** beyond. The forest has sand beaches; the mountains' rock runs straight down into the
water. Ponds never form within `POND_SHORE` tiles of the sea (`world-gen.ts`).

The ground is drawn as a picture of each chunk, a few pixels to a tile (`apps/client/src/render/ground-colors.ts`,
shared by the 2D and 3D views), 8 pixels to a tile and drawn with its pixels sharp (no filtering), as pixel art. Every
tile is drawn as what it is, edge to edge, with nothing softened or blended across the edges between tiles: sea or land,
forest or mountain, a beach tile, a pond tile, shelf or deep ocean. Water is flat and all of one depth: the shelf one
pale colour and the deep ocean one dark colour, a hard line between them, and a strip of foam along the land's edge. A
pond is close blues in patches and pixel grain (never darker in the middle), with short pale glints and now and then a
lily pad; its edge where it meets land is a single broken pixel of earth in several browns and pebbles, with gaps of
shallow water.

**Surf** (3D): waves of white foam roll in over the sea near the land and break on it, a wash of froth thinning away
after each, one every `SURF_PERIOD` seconds, a little sooner or later along the shore, out to `SURF_REACH` tiles
(`apps/client/src/render3d/ground.ts`). They are drawn in pixels the size of the ground's. Within a land tile the colour varies in patches of
grass and rock and a pixel grain; snow is either there or not (a hard edge), lying where the air makes it cold enough,
its line wandering `SNOW_LINE_WANDER` degrees either way of where the air alone would put it. The ground is level
everywhere (nothing dips under the water).

- **Forest** (round the spawn): trees, berry bushes, grass, flint and ponds; chickens and deer.
- **Mountains**: rocks, thick on the ground; wolves; skeletons' camps; the way into the dungeon; and the cold. It is
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
lose `COLD_DAMAGE` every `COLD_DAMAGE_EVERY` ticks. There is no thermometer: the cold is seen. As your body cools,
**frost** creeps in over the edges of the view, rime and ferns of ice reaching further in the colder you are, until in
deadly cold only a small clear patch is left in the middle and the ice throbs (`frost-view.ts`, `frostOf`). Snow blows
over the view in cold air (`SNOW_STARTS_AT` to `SNOW_FULL_AT`), to a near whiteout. The server keeps each body's
temperature and sends it with the player's health (in tenths of a degree); the page slows its player by it the same way.

**Armour** goes in the three armour slots in the inventory (head, body, feet): click a piece to put it on or take it
off, or drag it. Each piece has a `warmth` (degrees warmer it keeps you) and a `defense` (`armor` in `items.json`):
every hit on you does the sum of your armour's defense less, but always at least 1 (`damageAfterArmor`: a hit of 8
through 6 armour does 2). Made at the workbench: **leather armor** and **leather boots** (leather and twine), and the **wolf helmet**
(leather, twine and wolf fangs), which keeps you warmest of all: with the leather armor and boots it is enough to stay
in the ice crypt without slowing. Worn, the leather armor is a tunic with a laced front, shoulder pads, sleeves down the
upper arms (which swing with them), a belt and a skirt of flaps over the tops of the legs.

Being hurt makes a thud and a grunt (the `hurt` sound); others being hurt, a dull thump.

**Skeletons' camps** (`campSites` in `terrain.ts`, `tendCamps` in `apps/server/src/animals.ts`): a few in the mountains,
where the air is from `CAMP_WARMEST` down to `CAMP_COLDEST`: a dead fire, a tent and bones, kept by `CAMP_MIN` to
`CAMP_MAX` skeletons. Skeletons are hostile, but not pack hunters: a skeleton that sees you comes for you by itself;
hurt one, and it calls the others near it (`packOnSight: false` in its `hunt`). They drop bones and essence. Every
third skeleton round a camp is a **skeleton archer** (`skeleton-archer`, with a bow and a quiver; two more guard the
dungeon, `a` in its layout): it comes into range of you (`shoot.range` in its `hunt`, 5 tiles) where it has a clear
shot, stands and aims for a second (`shoot.aim`; a thin red line shows where, and it turns to follow you), then looses
an arrow, which flies straight through other skeletons (and every other animal) and is dodged by stepping off the
line. Archers drop bones and a few arrows. One that
is killed comes back `CAMP_RESPAWN_TICKS` (150 s) later, but only once a player is within
`CAMP_ACTIVE` tiles of the camp and none within `CAMP_UNSEEN`, so they never appear in front of you.

**The dungeon** (`packages/shared/src/dungeon.ts`, `apps/server/src/dungeons.ts`) is an **ice crypt**: frosted
flagstones between walls of ice, colder than anywhere outside (`DUNGEON_AIR`, −40°C), with a few flakes drifting down.
Its way in is a stone arch over steps going down, deep in the mountains' snow (`dungeonEntrance` in `terrain.ts`,
`DUNGEON_SHARE` of the way in). Step
onto it and you are taken into a copy of the dungeon of your own, or the copy a friend is in now. Its skeletons stand
guard (`guards` in the layout). At the top is the **frost lich's hall**, a great round chamber
(`BOSS_HALL_RADIUS` in `dungeon.ts`: tiles from its middle to its wall) through one doorway: walk in and an ice door seals it behind you, the lich
wakes, and its health shows across the top of the screen, as a number (hp / max) and a bar marked off every 50 hp
(`BOSS_NOTCH` in `game.ts`). It has 400 hp, and it never moves from the middle of its hall (nothing knocks it about):
you move round it, dodging what it casts, and what it casts depends on how far away you are:
  - every `SHARD_EVERY` (1.5 s), in turn, a **ring of ice shards** flying out all round it, then a **shotgun burst**
    (`BURST_COUNT` shards fanned at each player in the hall);
  - come within `WAVE_TRIGGER` tiles and it lets out a **wave of cold air** (no more than every `WAVE_EVERY`): it
    gathers round the lich for a moment, then a blue ring rolls out to `WAVE_RADIUS` tiles, hurting and throwing back
    everyone its front passes over (once a wave; it can be dashed through). So it cannot just be stood beside and
    hacked at;
  - stay further than `ICICLE_FROM` tiles and **icicles** fall where you stand (a blue ring shows where each will land
    as it falls).

The hall starts at `BOSS_AIR` (−40°C: you need
the wolf helmet, leather armour and boots not to be slowed) and gets a degree colder every `BOSS_COLD_EVERY` (4 s), so a
slow fight freezes you. Kill it and the door opens, and its chest (full of `LOOT`) with it; until then the chest is
"guarded". If everyone in the hall dies or gets out, after a moment the door opens and the lich is whole again. The
stairs out (where you came in) take you back to just outside the arch. A copy nobody has been in for `CLOSE_AFTER` is
cleared away, so the next visit starts fresh. The layout is the `LAYOUT` text in `dungeon.ts` (`#` rock, `.` floor, `S`
start, `E` stairs out, `k` a skeleton, `M` the lich, `C` its chest, `D` the doorway): edit it to change the dungeon.
The lich is `frost-lich` in `animals.json` (`boss: true`, which keeps it in its place); its spells are at the top of
`apps/server/src/dungeons.ts` (the wave's speed and reach, which the page draws too, in `dungeon.ts`). Any hostile
animal with `keepAway` in its `hunt` keeps that far from the player it is after. Copies sit far out at sea in a corner of the world, where nobody can walk to; nothing can be built or broken
in them (but a spear stuck in the floor can be knocked loose), and none of it is saved (a player saved inside one comes
back outside the arch).

A world's size and bumpiness are kept in its save (`terrain`); a world saved before biomes gets the default
(`DEFAULT_TERRAIN`), and grows differently from then on.

## Playing

The keys are the defaults; every key can be changed in **Esc → Settings → Controls** (kept in the browser).

| Key | Action |
| --- | --- |
| W A S D (or arrows) | Walk |
| Left click (hold) | Basic attack with what the picked slot holds, towards the mouse (see "Fighting"); held over grown crops, picks them all as fast as you sweep |
| Right click (hold) | Holding a weapon or tool: its special attack (wind up while held, let go to strike; Q calls it off). Bare-handed (or holding something that is not a weapon): open or toggle a chest, station, gate or feed box; sleep in a sleeping bag; put down what you hold; lead or milk an animal with a rope or bucket; use a bucket on a pond, barrel or plot, or empty it on bare ground |
| Q | Put away what you hold (no slot picked: bare hands); again to go back to the slot you were on |
| F | Eat from the food slot (to the right of the hotbar): food gives back health (its `heals` in `items.json`, more for better food), once every `EAT_COOLDOWN_TICKS` (5 s); the slot is grey while you cannot eat, its colour coming back as the cooldown runs down |
| 1 – 9 over the inventory | Swap the stack under the mouse with that hotbar slot |
| 1 – 9 | Pick a hotbar slot |
| E or Tab | Your inventory |
| Mouse wheel | Zoom |
| Esc | Close panels, open the menu, or go back from the settings |
| F3 | Debug view |
| F9 | (Development builds) break this page's copy of a chunk, to watch a desync be found and repaired |

- **Tree**: punching does not hurt it, but every `STICK_EVERY` punches knock one of its sticks loose, with a leaf (a
  knife strips bark instead of a stick, still without hurting it). A tree holds
  `TREE_STICKS` (3) and grows one back every `TREE_STICK_REGROW` of its random ticks (about half a minute); with none
  left, punching it does nothing. Only an **axe** chops it down (`maxHp` / 2 hits), for logs, acorns, leaves and
  whatever sticks are still on it. Trees are solid.
- **Bush**: each punch breaks it a little, and an axe twice as fast. It drops twine each time `TWINE_EVERY` of its hp
  has gone, and berries when it is gone. Bushes can be walked through, at `BUSH_SPEED_PERCENT` speed, with a quiet
  rustle.
- **Rock** (in the mountains): cannot be broken by hand; only a **pickaxe** breaks it (`maxHp` / 2 hits). When it is
  gone it drops 2–4 stone and 1–2 flint. Rocks lie in groups and are solid.
- **Flint** also lies in the forest from the start, a piece here and there: hit it (with anything) to knock it loose,
  then pick it up. It is a "loose item" (`loose` in `buildings.ts`), as is a thrown spear stuck in the ground.
- **Grass** grows in clumps, and spreads back quickly where it has been eaten (`GRASS_SPREAD_TICKS` in
  `game-room.ts`), until a patch (tufts touching, corners too) is `GRASS_PATCH_MAX` (15) big. Pulled up by hand it gives a wheat seed `GRASS_SEED_CHANCE` (30) percent of the time; cut with a
  knife it gives hay.
- **Berry bushes** come back slowly too, so a world never runs out: now and then (`BERRY_SPREAD_TICKS`, a minute) a
  chunk near a player grows a berry sprout beside a bush in a patch of fewer than five, or, with none, somewhere in it.
  Neither grass nor bushes grow back within `WILD_KEEP_CLEAR` tiles of anything a player has put down.

### Farming

- **Stump** (3 logs): right click to open it. It has a tool slot and an input slot, and an output slot, with your
  inventory under it and its recipes at the side. Pick one and press **Craft**: its tool and enough input for one
  more go in from your inventory (Shift: five more; Ctrl: all you have), and it keeps working through them (an axe
  and a log make two planks; a knife and a log make a wooden spear; three twine make a rope, no tool needed), but only
  while you stay at it: close it or
  walk off and it stops, keeping how far it had got. An axe left in it is drawn stuck in the stump. What it makes is
  `data/stations.json`.
- **Fences and gates** (planks and rope): fences join the fences and gates beside them (I, L, T and X shapes) and stop
  players and animals, but only where the post and rails are drawn (`fences.ts`), so you can walk close round them. A
  gate opens by itself while a player is within `GATE_OPEN_RADIUS` of it. Right click it to open it and keep it open,
  or shut it and keep it shut; a gate shut by hand opens by itself again once a player walks over it. Animals only get
  through an open gate, even on a rope, so open it before leading one through.
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
- **Rope** (3 twine, at a stump): right click an animal with it to lead it. A led animal wanders slowly; past `LEAD_LENGTH` the
  rope pulls you and it together, the lighter one more (`mass` in `animals.json`), so a cow pulling the other way
  slows you down. Right click it again to take the rope back. A rope pulled past `LEAD_BREAK` snaps.
- Players and animals that end up on top of each other are pushed apart, the lighter one more.

### The workshop

- **Workbench** (20 planks, 10 stone, by hand): pick a recipe in the list at the side and press **Craft**: what it
  takes for one more goes into its three input slots from your inventory (Shift: five more; Ctrl: as many as you
  can), and it keeps making it while what is in it is enough. Press again to add more. It only works while you stay
  at it. It has a **tool slot**: a recipe that needs a tool (an axe for planks, a knife for a spear) needs it there,
  not just on you (Craft puts it in from your inventory if it has none). Pressing Craft for another recipe while it is
  making one does not stop it: it makes the fail sound. Hand crafting takes Shift and Ctrl the same way. Its
  sections: **Tools** (planks, rope, and the pickaxe, axe and knife: all the stump makes, and more), **Weapons**,
  **Buildings**, **Farming** and **Liquids** (`data/stations.json`). A recipe with a `tool` (a knife for a spear or a
  bow) needs it on you, and does not use it up.
- **Campfire** (logs and stone, by hand): put fuel in and **Light** it. Each fuel can only get the fire so hot (sticks
  250°, planks 300°, logs 400°, charcoal 800°: `fuel` in `items.json`; the fuel slot is under the cooking slot), and the heat gauge climbs to it and falls when
  the fuel runs out. A log burnt leaves charcoal one time in four. Food in its cook slot cooks once the fire is hot
  enough, faster the hotter it is. Barrels and drying racks beside it (or one tile further, at half) get its heat,
  over a chunk's edge too (the server works that out every `BORDER_HEAT_EVERY` ticks and sends it, rounded down to
  `BORDER_HEAT_STEP`).
- **Drying rack** (workbench): dries one hide at a time into a dried hide, in two minutes cold, as fast again for every
  100° from a campfire beside it (`"rack"` in `data/stations.json`). A wet hide hangs dark on it while it dries, and
  the dried one pale and flat.
- **Bucket** (workbench): right click a pond with it to fill it, and a barrel to pour it in (or, empty, to fill it from
  the barrel); right click bare ground to empty it out. **Ponds** are part of the ground, worked out from the seed (`waterAt` in `world-gen.ts`); nothing grows,
  is built or walks on them.
- **Barrel** (workbench): holds eight buckets of liquid (water, tannin, milk: what the items in `items.json` with a
  `bucket` hold), and solids in three slots. It starts open: you see what is in it, a liquid in its colour at its
  level. **Seal** it (a lid goes on) for what needs sealing (a sealed barrel takes nothing in and gives nothing out).
  What it makes is `"barrel"` in `data/stations.json` (the first recipe whose ingredients are in it is the one it
  works on; each has its own `seconds`, and can say the liquid and how many buckets of it, solids, solids
  `perBucket` or `liquidPerSolid`, a `heat`, what it makes, what the liquid turns into, how much of the liquid it uses
  up, whether it must be `sealed`, and whether it must be `dry`). Its progress shows in its arrow. As it comes:
  - **Compost**: every 8 organic things (leaves, crops, seeds, acorns, berries, eggs) rot into one compost in a
    minute, in an open barrel with no liquid in it (a heap with flies over it shows it working).
  - **Tannin**: water with one bark for every bucket of it, boiled (`BOIL_HEAT`, 250°, from a campfire beside it), all turns into
    tannin in a minute and a half. With too little bark it does not start.
  - **Leather**: every dried hide in it is tanned at once, using a bucket of tannin each, in four minutes. Without a
    bucket for every hide it does not start; putting more hides in starts it again.
  - **Milk**: a bucket of milk can be poured into a barrel too, and drawn out again with an empty bucket, like water.

### Fighting

What you attack with is what the picked hotbar slot holds, if it is a weapon (`packages/shared/src/attack-defs.ts`), or
your fists (Q puts away what you hold, or pick any slot without a weapon). The axe, pickaxe and knife are weapons too. Every attack
puts every weapon on one cooldown, so switching does not get round it. Attacks go towards the mouse, from where you
stand.

- **What you see**: your character holds what is picked (a weapon or tool's model; anything else's picture) and wears
  their armour, and every other player sees the same. Attacks are animated: a swing sweeps the weapon round through its
  arc, a thrust goes straight out, the pickaxe comes down from overhead; a bow is drawn back as it charges, a sling
  whirled over the head, a spear raised and pulled back to throw. Behind the weapon the air **swishes**: a pale streak
  tracing exactly what the attack covers (the same numbers the server judges hits by, `attack-shapes.ts`), so there is
  no indicator on the ground. You stand still while an attack is made, so the swing is not dragged about.
- Attacks do not go through walls: what an attack reaches must have nothing solid (a dungeon wall, a tree, a rock)
  between it and you (`attackClear` in `weapons.ts`), and shots stop at walls.
- You only attack bare-handed (an empty slot, or Q) or with a weapon or tool: holding anything else, a click does not
  attack.
- With a weapon or tool held, an attack goes exactly the way the mouse points, whatever is under it: no tile lights up
  under the mouse, and a tree or rock there does not pull the aim to its middle.
- **Left click: basic attack**, on a short cooldown. Fists jab (a short, straight rectangle out in front, not a
  swing); the knife, axe and club swing (the knife short); the pickaxe strikes (a small circle a tile ahead, not a
  sweep); spears thrust (a long, straight rectangle). Every attack slows you for `ATTACK_SLOW_TICKS` (half a second),
  so you cannot fight and run at full speed. Each hits **everything** in its
  shape (animals, plants, rocks and buildings), so lining things up clears them faster. Each thing hit shakes, with a
  spark and a sound. A weapon's `damage` is what it does to animals, and to the resources it is for: an axe to trees
  and what you put down, a pickaxe to rocks; a bush takes anything's. Resource hp is in weapon damage (a tree 30, ten
  hits with an axe). The **bow** and **sling** are held to charge (you walk slowly), and shoot an arrow or a sling stone
  when let go, harder the longer they were held. With nothing to shoot, they are not drawn back at all. A shot is drawn flying until it reaches what it hit. Arrows that
  miss can be picked up again.
- **Right click: special attack**, with a weapon or tool held (bare hands have none: their right click is for using
  things). Held for its windup, aimed where the mouse is when you let go. It never hurts plants or buildings. Axe: a
  heavy, narrow chop. Pickaxe: a slam on everything round a spot in front. Knife: a long lunge forward (3.5 tiles)
  straight through whatever is in the way, hurting everything along it and a stab's reach past its end. Club: a wide swing that stuns. Spears: thrown (charged like a shot; they stack to 5, and land to be picked up
  again). Bow: three arrows at once, no windup, and a hop backwards. Sling: a close bash that knocks back. A lunge, a
  hop and every knockback carry the player over a few ticks (`DASH_TICKS`, `KNOCKBACK_TICKS`), quick but smooth. A
  dash goes with your movement inputs after the one you attacked on (`dashOf`), the way your page aimed it (`dir`
  in the attack, so both go exactly the same way), so your page moves you through it exactly as the server does. The
  attack can reach the server after some of those inputs have been played (it comes by the reliable stream, the inputs
  do not): the server then takes the dash's steps for them at once, and tells the page which of its attacks it has
  dashed for (`d` in the state), so the page does not take back the steps it has already shown in the meantime.
- Animals hit by anything flash red, call out, show the damage they took as a rising number, are knocked back or
  stunned as the attack says, and run from whoever hit them. One killed shows the killing blow's number too, keels
  over, and shrinks away into its drops (which show once it has fallen).
- Hover over an item for what it is good for: a weapon's damage (and its special's), food's healing, armour's warmth
  and defense.
- Attacks on animals are judged against where you **saw** them: the page draws animals a little in the past, so each
  attack says which tick it was drawing them at, and the server checks it against where they were then (up to
  `MAX_REWIND_TICKS`, half a second, back; `Animals.nearAt` in `apps/server/src/animals.ts`). Arrows, stones and thrown
  spears fly on the server as they are, so they are not judged this way. An animal only flashes once the server says it
  was hurt.
- **Health** (20, `PLAYER_MAX_HEALTH`) is the top edge of the hotbar. Eat to get it back (F). Messages show above both.
- A **sleeping bag** (3 leather, crafted by hand) is put down like a building; right-click it to sleep in it, and you
  wake up beside it whenever you are knocked out, until it is taken away (then the spawn again). It is kept in the save.
- A hostile animal (a wolf, a skeleton) that is after a player has a red **!** over it and a red ring under it.
- **PvP**: players hurt each other with every attack (melee, shots, throws), judged where the attacker saw them, as
  for animals. A player hit flashes red with the damage rising off them, and one knocked out (no health left) wakes up
  at the spawn with all their health. The **host** (the player who made the game: the first to join it, kept in its
  save) can turn it off or on in **Esc → Settings → Game**; it is on to start with.

### Animals

Animals wander in herds, keeping near others of their kind, and graze. A herd turns up now and then in new ground, and
every 45 seconds near a player with few animals around, of a kind that lives in the biome there (`biomes` in
`animals.json`: chickens and deer in the forest, wolves in the mountains; cows nowhere for now, though they are all
still in the game; skeletons only in their camps and the dungeon); wild ones far from everyone are let go (your own,
ones you have led, fed or bred, stay). How fast they get hungry, grow, breed and so on is each kind's `life` and
`stats` in `data/animals.json`; the rest is at the top of `apps/server/src/animals.ts`.

- **Deer** are skittish (`temper`): one runs from any player within `fleeRadius` tiles, or that hurts it, at
  `fleePace` times its speed (faster than a player runs), and its herd runs with it. Hunt them with a bow, sling or
  thrown spear. They eat berries from a feed box, which is how they are bred. They drop meat (raw steak) and hides.
  A deer is heavy on a rope (`mass`): it keeps running from you, and drags you along rather than being led.
- **Wolves** are hostile and territorial (`hunt` in `animals.json`): a wolf leaves a player alone until they come
  within `aggroRadius` tiles or hurt it, and then it goes for them, and so does every wolf of its pack within
  `packRadius` tiles. They chase at `pace` times their speed (faster than a player: you cannot outrun them, only get
  past their `leash`), bite for `damage` every `cooldown` seconds from close up (their size and yours, and `reach`
  between), and give up once the player is more than `leash` tiles from where they live, and run home fast
  (`RETURN_PACE`); hit one on the way and it turns on you again. With `flank`, a pack does not run straight in: they spread round you
  `FLANK_RING` tiles out, at least `FLANK_SPREAD` apart, and dart in to bite from their side, falling back between bites
  (`flankPlace` in `animals.ts`). Fences keep them out. They drop hides and fangs.
- **Noticing.** A hostile animal only notices a player it can see (a dungeon's walls hide you), within its leash of
  home. One that gives up a chase goes home and will not take another up by itself for `CALM_TICKS`, so one at the edge
  of its ground does not keep giving up and coming back.
- **Pathfinding.** A hunter whose straight way to you is blocked (a wall, a fence, a tree) finds a way round over the
  tiles near it (`findPath` in `animals.ts`), never cutting corners; wolves only flank in the open.
- **Male and female** look different at a glance: a bull is dark and long-horned, a cow pied with an udder; a rooster
  has a tall comb and a dark sweeping tail, a hen is brown with a small comb; a buck has antlers; a male wolf is bigger
  and darker with a heavy black mane. In 2D, males are bigger and darker, with a small crest.
- **Hunger.** It fills from 0 to 100% over `hungerMinutes`. At `hungryAt` or more an animal goes for the nearest tuft
  of grass within `grassRadius` tiles and eats it (taking `grassFills` off its hunger); at half of `hungryAt` it only
  nibbles grass right beside it. Not well fed and at half of `hungryAt`, it goes to a feed box with food it likes
  first. Grass never makes it well fed; a feed box does, for `wellFedMinutes`.

- **Stats and genetics.** Every animal is male or female and has stats: a cow its meat, milk and growth time; a
  chicken its meat, egg lay time and growth time. A wild one gets each stat's base give or take its spread
  (`animals.json`).
- **Breeding.** Two adults of a kind, one of each sex, both well fed (from a feed box), not bred in the last
  `breedCooldownMinutes`, within 8 tiles of each other, and not crowded (fewer than 16 of the kind within 12 tiles),
  go to each other and have a baby. Breeding uses up being well fed. The baby's stats are the average of its parents', give or take a little.
  It is drawn small and grows up over its growth time.
- **Products.** A hen lays an egg on the ground every egg lay time. A cow builds up milk (one every `milkMinutes`, up to
  her milk stat); right click her holding an empty bucket to milk her: it becomes a bucket of milk, one bucket
  a click, and she keeps the rest of her milk for the next.
- **Food and gates.** A hungry animal goes for whichever is nearer, grass it can see or a feed box with something it
  eats. It only goes through an open gate to get to food, or on a rope; wandering, it stays on its side.
- **Killing.** A grown animal drops about its meat stat in meat (steak or raw chicken) and its hide or feathers; a
  baby drops nothing.
- **Debug view (F3):** hover over an animal to see what it is doing, its sex, age, hp, hunger (and where it counts as
  hungry), whether it is well fed, who leads it, and its stats against its kind's wild range.
- **Sapling**: planted from an acorn with a right click. It grows a stage on each of its random ticks (see below) and
  becomes a tree after four, about 45 seconds on average. Punching it digs the acorn back up.
- **Berry sprout**: planted from berries. It grows a stage on each of three random ticks (about 35 seconds in all),
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
when picked up). Drag a stack onto any slot, of your inventory or of what is open: onto a stack of its kind it fills it
up to a stack and the rest stays where it came from; onto another kind they swap. Drag with the right button to move
half a stack. Drag a stack off the panels to drop it on the ground there (a tile and a half off, towards where you let
go; it never lands past a fence or a wall). With a building open, click a stack to move it across; Shift-click to move
every one of that kind. With only your inventory open, click a stack in the hotbar to move it up into the inventory (as
high as it goes), or one in the inventory to move it down into the hotbar. Over a stack, 1–9 swaps it with that hotbar
slot. Moving items makes a soft tick. An open chest or station closes as soon as you walk out of reach.

**Chests** have a name (type it in the box at the top of the chest; it shows over the chest when you hover it), **Sort**
(stacks merged, in item order) and **Top up** (each stack the chest has is filled to a full stack from your inventory,
not the hotbar, and no further: nothing new goes in).

Solid things stand in the way with their own shape, not their whole tile (`BUILDING_BOUNDS` in `buildings.ts`): a
tree's trunk, a barrel's round, a drying rack's two posts.

**Crafting** by hand (tools, the stump, the campfire, the workbench) is beside the inventory (with no chest open): a list that scrolls, grouped by category (`category` in
`data/recipes.json`), what you cannot make yet greyed out. Click one to see what it takes (green where you have enough,
red where not) and craft it. Sticks, twine and flint make a makeshift pickaxe, axe or knife (the knife cuts grass for
hay and kills animals faster). Hover over any item for its name. The recipes are in `data/recipes.json`; tools do not stack (`"stack": 1` in
`data/items.json`). What each tool does to what it hits is `hitDamage` in `packages/shared/src/tools.ts`.

The world grows trees (scattered, and thicker where a forest is), bushes (in patches of 1–5), rocks (in groups of 2–5) and flint, from the
seed, the first time a player comes near each chunk. How much grows is `DEFAULT_PLANT_GENERATION` in `world-gen.ts`
(trees in the open and in forest, how much is forest, how often a bush patch or a group of rocks appears and how many
it has, flint per 1000 tiles, and the clearing round the spawn); a game can be given its own with the room's
`plantGeneration` option. Nothing grows within five tiles of the spawn. A player inside something solid (a tree
that has just grown where they stand) is pushed out to the nearest place they fit.

**Put away for later:** ore deposits are off (`ORE_DEPOSITS` in `world-gen.ts`), and nothing in the game builds the
factory's buildings any more. The simulation, the server's `build`/`remove` commands and their tests are all still
there, ready to be given back to the player.

## Art

The 3D view's models are built in code (`apps/client/src/render3d/models.ts`; there are no model files yet); it uses
the pictures below only for items lying on the ground. Everything else here is the 2D view and the page's icons.

Every picture is named in `apps/client/src/render/art-catalog.ts`, with the file it comes from under `res/`. **To replace
a placeholder, save a PNG at its path.** The game uses the file wherever there is one and draws a flat placeholder where
there is not; no code changes. The dev server picks a new file up on reload (a hosted build needs `npm run build`). In
development the console lists every file still missing.

| Picture | File | Notes |
| --- | --- | --- |
| Ground | `res/tiles/ground.png` | Fills a tile and repeats |
| Ore deposit | `res/tiles/ore-<ore>.png` | One per ore, such as `ore-iron.png` |
| Item | Its `icon` in `data/items.json` (an ore's is `res/icons/ores/<ore>.png`) | The garden plot and feed box are placeholders until they have an `icon` |
| Animal | `res/entities/<kind>.png` | There for cows and chickens. Drawn facing left (`ANIMAL_ART_FACES_LEFT`), turned the way they walk; babies smaller |
| Grass | `res/buildings/grass-tuft.png` | There |
| Crop | `res/buildings/crops/<crop>/<crop>-sprout.png`, `-mid.png`, `-full.png` | There for wheat. A tile wide, as tall as the picture, standing in its plot (2D; the 3D view models its six stages) |
| Fence | `res/buildings/fence/fence-<n>.png` | Placeholders. 16 pictures, one for each set of sides it joins: n is north 1 + east 2 + south 4 + west 8 |
| Gate | `res/buildings/gate/gate-<h or v>-<open or shut>.png` | Placeholders. `h` runs east to west |
| Stump, plot, feed box | `res/icons/buildings/stump.png`, `res/buildings/plot.png`, `res/buildings/feed-box.png` | The stump is drawn from its icon; the others are placeholders |
| Sapling | `res/buildings/sapling.png` | There. Drawn small, growing as the sapling does |
| Rock | `res/buildings/rocks/rock1.png` … `rock6.png` | There. Each rock is drawn with one of them, picked by its tile (`ROCK_VARIANTS` in the art catalog) |
| Tree, bush | `res/plants/tree.png`, `bush.png` | Placeholders until drawn. Seen from above; a tree is drawn 1.6 tiles across, its trunk on its tile. A berry sprout is `res/plants/berry-sprout.png` (a placeholder: leaves, no berries), drawn bigger as it grows |
| Miner, chest | `res/buildings/miner.png`, `chest.png` | Fills a tile |
| Belt, extractor | `res/buildings/belt.png`, `extractor.png` | Facing east (right); turned for the other ways |
| Belt corner | `res/buildings/belt-curve.png`, `extractor-curve.png` | Fed from the top, carrying out to the right; flipped for the other way |
| Player | `res/player/player.png` | A placeholder caveman. Seen from above, facing south (down); turned to face the way the player walks. Drawn at 0.8 of a tile |

Any size works; square pixel art at 32 or 64 pixels looks best, since tiles are 64 pixels at normal zoom and everything is
sampled nearest so it stays crisp. Items are drawn a quarter of a tile across on belts (16 pixels at normal zoom). The
placeholders themselves are in `render/placeholders.ts`.

## Sound

The sounds are in `apps/client/src/audio/sounds.ts`: punching a tree (`punch-wood`), punching a bush or sapling
(`punch-leaves`), hitting a rock (`punch-stone`), a tree falling (`break-tree`), a bush cleared (`break-bush`), a rock
broken (`break-rock`), planting (`plant`), picking an item up
(`pickup`), pushing through a bush (`rustle`), eating (`eat`), sleeping (`sleep`), crafting (`craft-one` for a click,
`craft-some` for shift, `craft-all` for ctrl, and `craft-fail` when it cannot be done: nothing to make it from, or the
output slot full of something else), and footsteps. Each
is made up with Web Audio until there is a file for it. **To replace one, save a file under `res/sounds/`** named after
it, with any number of numbered variants picked at random: `punch-wood.ogg`, `break-tree.ogg`, `step-grass.ogg` or
`step-grass-1.ogg`, `step-grass-2.ogg`, ... (`.ogg`, `.mp3` or `.wav`).

**Esc → Settings → Audio** has a master volume, and under it one for effects (punching, falling, planting, picking up)
and one for footsteps (steps and rustling), and a mute. They are kept in the browser.

Footsteps sound like the ground underfoot: `surfaceAt` says what surface a tile is (everything is `grass` for now), and
each surface has its own `step-<surface>` sound. A new surface is a name in `Surface`, a case in `surfaceAt`, and a
recipe in `FOOTSTEPS` or files of its own.

## Networking

The server is the authority. For the factory it sends the **inputs**, not the state: every client runs the same
deterministic simulation of the chunks near it, a few ticks behind the server, driven only by the server's log. Players'
positions are ordinary state replication.

**Animals** are not part of that simulation: they cross chunk edges freely, so the server alone runs them
(`apps/server/src/animals.ts`). Where the ones in a player's chunks are goes with the players' positions in each state
message (`n`), and pages draw them a little in the past like other players; what each one is (`AnimalInfo`: kind, sex,
stats, growth, hp, hunger, who leads it) goes on the log whenever it changes (`animal` / `animal-` events). What they do
to the world (grazing a tuft, eating from a feed box, laying an egg) is logged as world events like a command's. A rope
pulls the player on the server; the page pulls its own predicted player the same way (`ropePull`), towards where it last
saw the animal, so being dragged feels immediate and the reconcile only has to tidy up.

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
- Plants are generated by the server, not by each client: the first time a player comes near a chunk, the server grows
  its trees and bushes (`plantsInChunk`) as ordinary buildings, and clients get them in the chunk's snapshot. After
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

The page sends **intents** (`commands.ts`: build, remove, take from, put into) stamped with the tick to run on: its
estimate of the server's tick, plus the time to get there, plus a margin of two ticks (`TickClock.commandTick`). They go
over the same kind of reliable stream the other way. The server runs each on its tick against the world as it is then:
it does it, does as much as it can ("take up to 50"), or turns it down, and logs the result. One that arrives late runs on
the next tick; one stamped more than five seconds ahead is turned down.

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
again, in case one is lost). The server plays them on its own copy, at most two a tick. When the server says where the
player is and which input it has played up to, the page replays the inputs it has not played on top of that
(`LocalPlayer.reconcile`): rollback for one entity. Movement is whole numbers, so this lands exactly where the page had
the player unless something was lost. Players stop against solid buildings (`stepPlayer` with `solidIn(world)`);
the page checks against its copy of the factory, which is a few ticks behind, so next to a building that has just gone
up or come down the server can disagree for a moment and the reconcile puts it right. A player only collides with tiles
it is not already over, so one caught under a new chest walks out. Other players are drawn three ticks in the past, between two positions the
server sent.

### Timing

The page works out the server's tick from when its state messages arrive (`TickClock`) and draws the factory a few
ticks behind that (the playout delay, which grows when the log is late and shrinks back slowly), stepping it at the
server's rate and drawing items between their last two positions so they glide at any frame rate.

### Not built yet

Global systems such as power grids and logistics networks, which are virtual server-only objects that clients never
simulate and only receive logged results for (`grid 12 satisfaction=0.83 from T`), and display-only values sent
throttled to the clients viewing them. Their place is phase B and the log, and nothing here assumes they are absent.

## Adding a building or an item

- **An item**: add it to `data/items.json` with the next `id` (the numbers are part of the protocol); its `key` is how
  recipes and the code name it. An ore gets a placeholder icon and deposits at once (drop its pictures in `res/icons/ores/` and
  `res/tiles/`); anything else is a `plant` item, with its picture in `res/icons/items/` and, if it has its own
  placeholder, a painter in `ITEM_PLACEHOLDERS`. An item with `places` is put down as that building with a right click.
- **A recipe, crop or station recipe**: add it to its file in `data/`. A crop needs its seed item to say `"crop"`, and
  its pictures in `res/buildings/crops/<crop>/`.
- **An animal**: add it to `data/animals.json` (it needs a `growth` stat; `milk` needs a `milk` stat and `lays` an
  `eggTime` one), and its picture as `res/entities/<kind>.png`.
- **A plant**: like a building (below), with `natural: true` and its `maxHp` in `BUILDINGS`; what a hit drops is in
  `hit` in `apps/server/src/commands.ts`, and what a random tick does in `randomTick` in `sim/entity.ts`.
- **A building**: add it to `BuildingKind`, `BUILDINGS` and `BUILDING_KINDS` in `buildings.ts`; give it state and a
  phase A step in `sim/entity.ts` (and its snapshot and hash there); say what its ports offer and take in
  `sim/ports.ts`; say what it links to in `sim/links.ts`; and give it a picture in `render/art-catalog.ts` and
  `render/placeholders.ts`. The compiler points at every `switch` that needs a case.

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
| `SAVES_DIR` | `saves` | Where the worlds are saved, a file each |

To host it, open TCP `5173` (the page; Vite forwards the API and signalling to the server) and UDP `10000` (WebRTC).
Running worlds are saved to `SAVES_DIR` every minute, and close (saved) ten minutes after the last player leaves.
