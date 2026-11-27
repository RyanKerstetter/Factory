import * as THREE from 'three'
import {
  CHUNK_SIZE,
  chunkCoords,
  DUNGEON_LAYOUT,
  DUNGEON_SLOTS,
  dungeonEntrance,
  dungeonTile,
  gateRunsAcross,
  getItem,
  SAPLING_STAGES,
  SEEDLING_STAGES,
  CACTUS_STAGES,
  SPROUT_STAGES,
  type ItemId,
  type Terrain,
} from '../../../../packages/shared/src/index.ts'
import { cameraPitch, PX_PER_TILE, VIEW_HEIGHT, type TileBounds } from '../camera.ts'
import type { GameView, ViewStats } from './game-view.ts'
import type { AnimalView, BuildingView, GhostView, MonsterView, OverlayView, PlayerView, Swish, TrapView, WorldFrame } from './frame.ts'
import { bake, unbake } from './bake.ts'
import { Fog } from './fog.ts'
import { Ground, WALL_SPIKES } from './ground.ts'
import { floatingAt, itemMaterial, itemPlane } from './item-pictures.ts'
import * as models from './models.ts'
import { Puffs } from './puffs.ts'
import { RitualEffects } from './ritual-effects.ts'
import { WaystoneEffects } from './waystone-effects.ts'
import { GroundPaint, Label } from './paint.ts'
import { KeptById, Pool, showObject } from './reuse.ts'

// How many screen pixels a tile is across at a zoom of 1, on a view VIEW_HEIGHT pixels tall (2560 × 1440). Every view
// shows as much of the world from top to bottom as that one does, whatever its size (or the display's scaling), and
// as much more or less across as it is wider or narrower: a tile is PX_PER_TILE × (its height / VIEW_HEIGHT) across.
// The camera looks from straight south and above, so the world's grid runs square with the screen (north is up), at an
// angle that levels off as you zoom in (see cameraPitch in camera.ts).
const CAMERA_DISTANCE = 80
// Where the sunlight comes from (from the south-west and high), and how far round what the camera looks at shadows are
// worked out, in tiles.
const SUN_FROM = new THREE.Vector3(-0.6, 1.6, 0.9).normalize()
const SHADOW_SPAN = 28

const HOVER = 0xf0e6d2
const ACCENT = 0xd98a3a
const INVALID = 0xd9483b
const REMOVE = 0xc9452f
const ROPE = 0x8a6a3c
const BAR_BACK = 0x1f1308
const BAR_FILL = 0x7cc35a

// A baby is drawn this much the size of a grown one; a player turns this much of the way to its new facing each frame.
const BABY_SCALE = 0.6
const TURN_RATE = 0.35
// The frost lich's staff as it casts (tiles up, of the model; radians): lifted STAFF_LIFT for most spells, held
// STAFF_HIGH overhead for icicles, and for shards lifted STAFF_LEVELLED_LIFT and tipped STAFF_LEVEL forward, from
// upright to pointing a little down, at the player it faces.
const STAFF_LIFT = 0.25
const STAFF_HIGH = 0.6
const STAFF_LEVELLED_LIFT = 0.15
const STAFF_LEVEL = 1.75
// How a walking player moves (see `stride`): how far through a stride each tile walked takes them (in radians: 2π is
// a whole stride, a step with each foot), how far their legs swing either way from the hip, how far a knee bends as
// its foot comes forward, how far their arms swing (radians), how far they lean into it and twist with each step, and
// how much of the way they ease in or out each frame as the player starts or stops walking.
const STRIDE_PER_TILE = 2.3
const LEG_SWING = 0.62
const KNEE_BEND = 0.9
const ARM_SWING = 0.55
const STRIDE_LEAN = 0.12
const STRIDE_TWIST = 0.14
const STRIDE_EASE = 0.15
// How a weapon or tool is held, turned in the fist from pointing straight on along the arm (radians): at rest, raised
// forward and up (a spear more upright, it being long), and while attacking, nearly along the arm, a little raised.
const REST_GRIP = 1.55
const SPEAR_GRIP = 2.0
const SWING_GRIP = 0.35
// How far forward the arm holding something is held at rest (radians from hanging straight down).
const CARRY_ARM = 0.6
// How the models' natural sizes (in tiles) compare with the animals' sizes in data/animals.json.
const ANIMAL_MODEL_SIZE: Readonly<Record<string, number>> = { cow: 1, chicken: 0.55, deer: 1, wolf: 0.9, spider: 0.7, scarab: 0.75 }
// The same for the monsters' models; and the most spikes of the dungeon's traps drawn at once.
const MONSTER_MODEL_SIZE: Readonly<Record<string, number>> = { skeleton: 1, 'skeleton-archer': 1, 'frost-lich': 1.1, 'frost-wisp': 0.6, goblin: 0.85, 'goblin-archer': 0.85, 'goblin-shaman': 0.85, 'dust-elemental': 1, mummy: 1, bee: 0.35, 'queen-bee': 0.5 }
// What floats rather than walks (bobbing in the air).
const FLOATS: ReadonlySet<string> = new Set(['frost-wisp', 'bee', 'queen-bee', 'dust-elemental'])
const MAX_SPIKES = 900
// How much bigger a male is drawn than a female, by kind.
const MALE_SCALE: Readonly<Record<string, number>> = { cow: 1.08, deer: 1.06, wolf: 1.14, chicken: 1.05, spider: 0.85, scarab: 1.08 }
// The mark over a hostile animal that is after a player, and the ring under it.
const ANGRY = '#ff4a3a'
const ANGRY_RING = 0xff4a3a
// How big an item on the ground is, in tiles, and how it hops out of the ground and bobs.
const DROP_SIZE = 0.42
const LANDING_TICKS = 8
const HOP = 0.3
const BOB = 0.035
const BOB_SPEED = 0.004
// The most animals drawn on ropes at once.
const MAX_ROPES = 64
// How a deer walks and runs (see gaitDeer): how far through a stride each tile (of its own size) takes it walking and
// running; the pace (tiles a second) by which it is fully striding, and between which it goes from walking to running;
// how far its legs swing either way walking and running (radians); and how quickly its pace eases to how fast it is going (per second).
const DEER_WALK_STRIDE = 4.5
const DEER_RUN_STRIDE = 1.4
const DEER_MOVING_PACE = 0.5
const DEER_RUN_FROM = 3
const DEER_RUN_TO = 5.5
const DEER_WALK_SWING = 0.35
const DEER_RUN_SWING = 0.8
const DEER_PACE_EASE = 6
// Each leg's place in a stride (a fraction of one): walking, one foot at a time (hind left, fore left, hind right,
// fore right); running, bounding, the forelegs together and the hind legs together, half a stride apart.
const DEER_LEGS: ReadonlyArray<{ name: string; walk: number; run: number }> = [
  { name: 'leg-hl', walk: 0, run: 0.5 },
  { name: 'leg-fl', walk: 0.25, run: 0 },
  { name: 'leg-hr', walk: 0.5, run: 0.58 },
  { name: 'leg-fr', walk: 0.75, run: 1.08 },
]

// An animal or a monster's model as kept from frame to frame: whether it is lit up as hurt, which way it is turned
// (radians, turning smoothly towards where it faces), and where it was on the last frame (to bob as it walks).
type KeptCreature = { object: THREE.Object3D; hurt: boolean; angle: number; last: { x: number; y: number }; gait?: Gait }
// A deer's gait as kept from frame to frame (see gaitDeer): where it was and when, how fast it has been going (tiles a
// second, smoothed), and how far through its strides it is (radians: 2π is a whole stride, a step with each foot).
type Gait = { x: number; y: number; at: number; pace: number; phase: number }
// What walks on many legs (see gaitCrawler), and how many it has a side.
const CRAWLERS: Readonly<Record<string, number>> = { spider: 4, scarab: 3 }
// A crawler's step: how far through its strides it gets for each tile it walks (radians, at its model's size), how far
// each leg swings forward and back about its hip and is lifted as it swings forward (radians), and how fast (tiles a
// second) it has to be going to step fully (slower, its steps are smaller).
const CRAWLER_STRIDE = 10
const CRAWLER_SWING = 0.35
const CRAWLER_LIFT = 0.4
const CRAWLER_MOVING_PACE = 0.6
// How far a rolling scarab's body is raised (model units), so its shell tumbling over clears the ground.
const ROLL_LIFT = 0.12
// How far a mummy's arms turn up from straight out (radians): raised for a slam, and brought down past level.
const MUMMY_ARMS_UP = 2.2
const MUMMY_ARMS_DOWN = -0.6
// A mummy's plain blow: how far its arms flick up before they chop down (radians), and how far it lurches into it
// (model units).
const MUMMY_SWIPE_UP = 0.6
const MUMMY_LURCH = 0.16
// A hunter's bite (a wolf, a scarab): how far it lunges forward (model units) and dips its head into it (radians).
const BITE_LUNGE = 0.22
const BITE_DIP = 0.22
// How fast a rolling scarab tumbles over (radians a millisecond).
const ROLL_SPIN = 0.03
// A player's: the same, the name over them, how far through a stride they are and how much they are striding (their
// arms swing as they walk), and what they wear and hold (put on, and in hand, when it changes).
type KeptPlayer = KeptCreature & { name: Label; walk: number; stride: number; dressed: string; holding: string }

// The 3D view: the world in low-poly 3D (see models.ts), seen from above at an angle through an orthographic camera,
// lit by the sun with shadows. Things on the ground (indicators, tile frames) are painted onto it (see paint.ts);
// names and damage numbers are words that face the screen.
export async function createThreeView(stage: HTMLElement): Promise<GameView> {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(0x19140f)
  const canvas = renderer.domElement
  canvas.style.display = 'block'
  stage.replaceChildren(canvas)

  let width = Math.max(1, stage.clientWidth)
  let height = Math.max(1, stage.clientHeight)
  renderer.setSize(width, height)
  const resize = new ResizeObserver(() => {
    width = Math.max(1, stage.clientWidth)
    height = Math.max(1, stage.clientHeight)
    renderer.setSize(width, height)
    picked.clear()
    seen = undefined
  })
  resize.observe(stage)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 3)
  scene.add(new THREE.HemisphereLight(0xfff1d6, 0x4a3a28, 1.6))
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -SHADOW_SPAN
  sun.shadow.camera.right = SHADOW_SPAN
  sun.shadow.camera.top = SHADOW_SPAN
  sun.shadow.camera.bottom = -SHADOW_SPAN
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 120
  sun.shadow.bias = -0.0008
  sun.shadow.normalBias = 0.02
  scene.add(sun, sun.target)

  const world = new World(scene)
  let focus = { x: 0, y: 0 }
  let zoom = 1
  let pxPerTile = PX_PER_TILE
  // What `pick` found for each point, and the tiles in view, until the camera moves or the page is resized.
  const picked = new Map<string, { x: number; y: number }>()
  let seen: TileBounds | undefined
  let stats: ViewStats = { renderMs: 0, calls: 0, triangles: 0 }
  const raycaster = new THREE.Raycaster()
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  let frameCallback: (() => void) | undefined
  let raf = 0
  let destroyed = false
  const loop = (): void => {
    if (destroyed) return
    frameCallback?.()
    const before = performance.now()
    renderer.render(scene, camera)
    stats = { renderMs: performance.now() - before, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
    raf = requestAnimationFrame(loop)
  }

  const view: GameView = {
    canvas,
    look(at, newZoom) {
      focus = at
      zoom = newZoom
      pxPerTile = PX_PER_TILE * zoom * (height / VIEW_HEIGHT)
      const halfWidth = width / 2 / pxPerTile
      const halfHeight = height / 2 / pxPerTile
      camera.left = -halfWidth
      camera.right = halfWidth
      camera.top = halfHeight
      camera.bottom = -halfHeight
      camera.updateProjectionMatrix()
      const target = new THREE.Vector3(at.x, 0, at.y)
      const pitch = cameraPitch(zoom)
      camera.position.copy(target).add(new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(CAMERA_DISTANCE))
      camera.lookAt(target)
      camera.updateMatrixWorld()
      sun.position.copy(target).addScaledVector(SUN_FROM, 60)
      sun.target.position.copy(target)
      sun.target.updateMatrixWorld()
      picked.clear()
      seen = undefined
    },
    // What is under the point: a thing standing there (a tree's canopy is the tree's tile, an animal is where it
    // stands), or else the ground.
    pick(point) {
      const key = `${point.x},${point.y}`
      const known = picked.get(key)
      if (known) return known
      const ndc = new THREE.Vector2((point.x / width) * 2 - 1, -(point.y / height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      let found: { x: number; y: number } | undefined
      const hit = raycaster.intersectObjects(world.pickable, true)[0]
      if (hit) {
        let object: THREE.Object3D | null = hit.object
        while (object && !object.userData.spot) object = object.parent
        const spot = object?.userData.spot as { x: number; y: number } | undefined
        if (spot) found = { ...spot }
      }
      if (!found) {
        const at = raycaster.ray.intersectPlane(ground, new THREE.Vector3())
        found = at ? { x: at.x, y: at.z } : { ...focus }
      }
      picked.set(key, found)
      return found
    },
    aim(point) {
      const ndc = new THREE.Vector2((point.x / width) * 2 - 1, -(point.y / height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const at = raycaster.ray.intersectPlane(ground, new THREE.Vector3())
      return at ? { x: at.x, y: at.z } : { ...focus }
    },
    visible(): TileBounds {
      if (seen) return seen
      const corners = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: 0, y: height },
        { x: width, y: height },
      ].map((corner) => {
        const ndc = new THREE.Vector2((corner.x / width) * 2 - 1, -(corner.y / height) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)
        return raycaster.ray.intersectPlane(ground, new THREE.Vector3()) ?? new THREE.Vector3(focus.x, 0, focus.y)
      })
      // Tall things standing past the bottom of the screen reach up into it, so a few more tiles all round.
      const margin = 3
      seen = {
        left: Math.floor(Math.min(...corners.map((c) => c.x))) - margin,
        right: Math.ceil(Math.max(...corners.map((c) => c.x))) + margin,
        top: Math.floor(Math.min(...corners.map((c) => c.z))) - margin,
        bottom: Math.ceil(Math.max(...corners.map((c) => c.z))) + margin,
      }
      return seen
    },
    draw(frame) {
      world.update(frame, view.visible(), camera, pxPerTile)
    },
    start(frame) {
      frameCallback = frame
      raf = requestAnimationFrame(loop)
    },
    describe() {
      return `3D, ${Math.round(pxPerTile)} px a tile, ${width}×${height} at ${renderer.getPixelRatio()}×`
    },
    stats() {
      return stats
    },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      resize.disconnect()
      world.dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
  return view
}

// Everything in the 3D world, kept from frame to frame by ID.
class World {
  private readonly ground = new Ground()
  private readonly fog = new Fog()
  private readonly buildings = new THREE.Group()
  private readonly animals = new THREE.Group()
  private readonly players = new THREE.Group()
  private readonly drops = new THREE.Group()
  private readonly shots = new THREE.Group()
  private readonly ghosts = new THREE.Group()
  // The rafts, and the one about to be put down.
  private readonly rafts = new THREE.Group()
  private readonly keptRafts = new KeptById<{ object: THREE.Object3D }>(this.rafts)
  private raftGhost: { object: THREE.Object3D; valid: boolean } | undefined
  // How many ropes the animals took this frame (the rafts' come after).
  private ropesDrawn = 0
  private readonly effects = new THREE.Group()
  private readonly labels = new THREE.Group()
  private readonly monsters = new THREE.Group()
  private readonly paint = new GroundPaint()
  private readonly rituals = new RitualEffects()
  private readonly puffs = new Puffs()
  private readonly waystoneEffects = new WaystoneEffects()

  // Each baked into as few meshes as it can be (see bake.ts), and its baked shapes freed when it goes.
  private readonly keptBuildings = new KeptById<{ object: THREE.Object3D }>(this.buildings, (kept) => unbake(kept.object))
  private readonly keptAnimals = new KeptById<KeptCreature>(this.animals)
  private readonly keptMonsters = new KeptById<KeptCreature>(this.monsters)
  private readonly keptPlayers = new KeptById<KeptPlayer>(this.players, (kept) => {
    this.labels.remove(kept.name.sprite)
    kept.name.dispose()
  })
  private readonly keptDrops = new KeptById<{ object: THREE.Sprite }>(this.drops)
  private readonly keptShots = new KeptById<{ object: THREE.Object3D }>(this.shots)
  // What is being placed, by its place in the list (see updateGhosts), and what its model was made for.
  private readonly keptGhosts: Array<{ object: THREE.Object3D; key: string }> = []
  // The spikes of the dungeon's traps going off, as one mesh of many spikes (see updateTraps).
  private readonly spikes: THREE.InstancedMesh
  // The swishes in the air behind swinging weapons (see Swish), a mesh each, its buffers big enough for any.
  private readonly swishMeshes = new Pool(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SWISH_VERTICES * 3), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SWISH_VERTICES * 4), 4))
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }))
    mesh.renderOrder = 7
    mesh.frustumCulled = false
    this.effects.add(mesh)
    return mesh
  }, showObject)
  // The mark over each hostile creature after a player, and the ring under it (see markAngry).
  private readonly angryRingGeometry = new THREE.RingGeometry(0.7, 0.85, 24).rotateX(-Math.PI / 2)
  private readonly angryRingMaterial = new THREE.MeshBasicMaterial({ color: ANGRY_RING, transparent: true, opacity: 0.75, depthWrite: false })
  private readonly angryMarks = new Pool(
    () => {
      const label = new Label({ color: ANGRY, size: 26, bold: true })
      label.set('!')
      const ring = new THREE.Mesh(this.angryRingGeometry, this.angryRingMaterial)
      ring.renderOrder = 6
      this.labels.add(label.sprite)
      this.effects.add(ring)
      return { label, ring }
    },
    (mark, shown) => {
      mark.label.sprite.visible = shown
      mark.ring.visible = shown
    },
  )
  // Health bars (a backing and how full), sparks, and damage numbers (see updateEffects).
  private readonly bars = new Pool(
    () => {
      const plane = new THREE.PlaneGeometry(1, 1)
      const back = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: BAR_BACK, transparent: true, opacity: 0.85, depthTest: false }))
      // Both see-through, so they are drawn in their renderOrder (the backing first): an opaque fill would be drawn
      // before it, and covered.
      const fill = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: BAR_FILL, transparent: true, depthTest: false }))
      back.renderOrder = 18
      fill.renderOrder = 19
      this.effects.add(back, fill)
      return { back, fill }
    },
    (bar, shown) => {
      bar.back.visible = shown
      bar.fill.visible = shown
    },
  )
  private readonly sparkMeshes = new Pool(() => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 20), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }))
    mesh.renderOrder = 17
    this.effects.add(mesh)
    return mesh
  }, showObject)
  private readonly numberLabels = new Pool(
    () => {
      const label = new Label({ color: '#ffd27a', size: 18, bold: true })
      this.labels.add(label.sprite)
      return label
    },
    (label, shown) => {
      label.sprite.visible = shown
    },
  )
  // The camps, the way into the dungeon and the stairs out of it (see landmarksOf in terrain.ts), for the terrain they
  // were placed for.
  private readonly landmarks = new THREE.Group()
  private landmarksFor: { terrain: Terrain | undefined; fogLifted: boolean } | undefined
  private readonly hoverRing: THREE.Mesh
  private readonly ropes: THREE.LineSegments
  private readonly dropShadows: THREE.InstancedMesh
  readonly pickable: THREE.Object3D[] = [this.buildings, this.animals]

  constructor(scene: THREE.Scene) {
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthWrite: false }))
    this.hoverRing.rotation.x = -Math.PI / 2
    this.hoverRing.renderOrder = 6
    const ropeGeometry = new THREE.BufferGeometry()
    ropeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_ROPES * 6), 3))
    this.ropes = new THREE.LineSegments(ropeGeometry, new THREE.LineBasicMaterial({ color: ROPE }))
    this.ropes.frustumCulled = false
    this.dropShadows = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.5, 12).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
      256,
    )
    this.dropShadows.frustumCulled = false
    this.spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1, 4).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xb8c4cc, roughness: 0.4, metalness: 0.6, flatShading: true }), MAX_SPIKES)
    this.spikes.frustumCulled = false
    this.spikes.count = 0
    scene.add(this.ground.view, this.paint.mesh, this.buildings, this.animals, this.monsters, this.spikes, this.players, this.drops, this.dropShadows, this.shots, this.ghosts, this.rafts)
    scene.add(this.effects, this.labels, this.hoverRing, this.ropes, this.landmarks, this.rituals.group, this.waystoneEffects.group, this.puffs.points, this.fog.view)
  }

  update(frame: WorldFrame, bounds: TileBounds, camera: THREE.OrthographicCamera, pxPerTile: number): void {
    this.ground.update(frame.terrain, bounds, !frame.fogLifted)
    const you = frame.players.find((player) => player.local)
    this.fog.update(frame.terrain, bounds, !frame.fogLifted, you, camera)
    this.updateLandmarks(frame.terrain, frame.fogLifted)
    this.updateBuildings(frame)
    this.rituals.update(frame.rituals, frame.now)
    this.waystoneEffects.update(frame.warps, frame.warpFlashes, frame.now)
    this.updateAnimals(frame.animals, frame.now, pxPerTile)
    this.updateMonsters(frame.monsters, frame.now, pxPerTile)
    this.angryMarks.finish()
    this.updateTraps(frame.traps, frame.now)
    this.updatePlayers(frame.players, pxPerTile)
    this.updateSwishes(frame)
    this.updateDrops(frame)
    this.updateShots(frame)
    this.updateGhosts(frame.overlay)
    this.updateRafts(frame)
    this.paint.clear()
    this.paintOverlay(frame.overlay, pxPerTile)
    this.updateHoverLabel(frame.overlay, pxPerTile)
    this.paintAttacks(frame, pxPerTile)
    if (frame.debug) this.paintDebug(frame, pxPerTile)
    this.paint.finish()
    this.updateEffects(frame, camera, pxPerTile)
  }

  // ---- landmarks

  // The way into the dungeon and the ways out of it. (The camps are buildings: see `isCampKind`.)
  private updateLandmarks(terrain: Terrain | undefined, fogLifted: boolean): void {
    if (this.landmarksFor && terrain === this.landmarksFor.terrain && fogLifted === this.landmarksFor.fogLifted) return
    this.landmarksFor = { terrain, fogLifted }
    this.landmarks.clear()
    if (!terrain) return
    const place = (object: THREE.Object3D, x: number, y: number): void => {
      object.position.set(x + 0.5, 0, y + 0.5)
      this.landmarks.add(object)
    }
    const entrance = dungeonEntrance(terrain)
    if (entrance) place(models.dungeonEntrance(), entrance.x, entrance.y)
    for (let slot = 0; slot < DUNGEON_SLOTS; slot++) {
      const exit = dungeonTile(slot, DUNGEON_LAYOUT.exit)
      place(models.dungeonExit(), exit.x, exit.y)
      const hallExit = dungeonTile(slot, DUNGEON_LAYOUT.hallExit)
      place(models.dungeonExit(), hallExit.x, hallExit.y)
    }
  }

  // ---- buildings and plants

  private updateBuildings(frame: WorldFrame): void {
    for (const building of frame.buildings) {
      const { object } = this.keptBuildings.keep(building.id, buildingKey(building), () => {
        const object = bake(buildingModel(building))
        object.userData.spot = { x: building.x + 0.5, y: building.y + 0.5 }
        return { object }
      })
      object.position.set(building.x + 0.5, 0, building.y + 0.5)
      const shake = frame.shaking.get(building.id) ?? 0
      const sway = shake > 0 ? Math.sin(frame.now * 0.06) * shake : 0
      // What rocks: all of it, or only the part named `shaken` (a camp's building, not the fire and bones round it); and
      // once more after it stops, to stand it straight again.
      if (shake > 0 || object.userData.rocking) {
        const rocks = object.getObjectByName('shaken') ?? object
        rocks.rotation.z = sway * 0.08
        rocks.rotation.x = sway * 0.04
        object.userData.rocking = shake > 0
      }
      object.scale.setScalar(frame.removingIds.has(building.id) ? 0.85 : 1)
      // Campfire flames flicker.
      if (building.lit) {
        object.traverse((part) => {
          if (part.name !== 'flame') return
          part.scale.y = (part.userData.height ??= part.scale.y) * (1 + 0.18 * Math.sin(frame.now * 0.018 + part.id))
        })
      }
      // Smoke off a fire cooking leaves: puffs rising, spreading and fading, one after another.
      if (building.smoking) {
        const smoke = object.getObjectByName('smoke')
        smoke?.children.forEach((puff) => smokePuff(puff as THREE.Mesh, frame.now))
      }
      // What is on a pedestal or an altar bobs and spins over it.
      if (building.shown !== undefined) {
        const floating = object.getObjectByName('floating')
        if (floating) {
          const float = floatingAt(frame.now, building.x * 7 + building.y * 13)
          floating.position.y = (floating.userData.baseY as number) + float.lift
          floating.rotation.y = float.turn
        }
      }
    }
    this.keptBuildings.sweep()
  }

  // ---- animals and monsters

  private updateAnimals(animals: readonly AnimalView[], now: number, pxPerTile: number): void {
    let hovered: AnimalView | undefined
    let ropes = 0
    const rope = this.ropes.geometry.getAttribute('position') as THREE.BufferAttribute
    for (const animal of animals) {
      const kept = this.keptAnimals.keep(animal.id, `${animal.kind}|${animal.male}`, () => keptCreature(animalModel(animal.kind, animal.male), animal))
      const scale = (animal.size / (ANIMAL_MODEL_SIZE[animal.kind] ?? 1)) * (animal.baby ? BABY_SCALE : 1) * (animal.male ? (MALE_SCALE[animal.kind] ?? 1) : 1)
      placeCreature(kept, animal, scale, now)
      if (animal.kind === 'deer') gaitDeer(kept, animal, scale, now)
      const legs = CRAWLERS[animal.kind]
      if (legs !== undefined) gaitCrawler(kept, animal, scale, now, legs)
      if (animal.kind === 'scarab') poseRoller(kept, animal, now)
      poseBite(kept, animal, scale)
      if (animal.hovered) hovered = animal
      // A hostile one after a player: a red mark bobbing over it, and a red ring under it.
      if (animal.angry) this.markAngry(animal, 1.35 * scale, now, pxPerTile)
      // One on a rope: the rope, from the hand of whoever leads it to its neck.
      if (animal.leader && ropes < MAX_ROPES) {
        rope.setXYZ(ropes * 2, animal.leader.x, 0.55, animal.leader.y)
        rope.setXYZ(ropes * 2 + 1, animal.x, 0.55 * scale, animal.y)
        ropes++
      }
    }
    this.keptAnimals.sweep()
    // The rafts' ropes are added after these (see updateRafts).
    this.ropesDrawn = ropes
    this.hoverRing.visible = hovered !== undefined
    if (hovered) {
      const radius = Math.max(0.35, hovered.size * (hovered.baby ? BABY_SCALE : 1) * 0.6)
      this.hoverRing.position.set(hovered.x, 0.03, hovered.y)
      this.hoverRing.scale.setScalar(radius)
    }
  }

  private updateMonsters(monsters: readonly MonsterView[], now: number, pxPerTile: number): void {
    for (const monster of monsters) {
      const kept = this.keptMonsters.keep(monster.id, monster.kind, () => keptCreature(monsterModel(monster.kind), monster))
      const scale = monster.size / (MONSTER_MODEL_SIZE[monster.kind] ?? 1)
      // A wisp floats, and so do bees, their wings a blur.
      placeCreature(kept, monster, scale, now, FLOATS.has(monster.kind))
      // A dust elemental whirls, faster as it gathers a twister.
      const swirl = kept.object.getObjectByName('swirl')
      if (swirl) swirl.rotation.y = (now * (monster.act?.k === 'aim' ? 0.03 : 0.012)) % (Math.PI * 2)
      if (monster.kind === 'bee' || monster.kind === 'queen-bee') {
        const wings = (kept.object.userData.wings ??= kept.object.getObjectsByProperty('name', 'wing')) as THREE.Object3D[]
        wings.forEach((wing, i) => (wing.rotation.x = (i === 0 ? -1 : 1) * (0.2 + 0.6 * Math.abs(Math.sin(now * 0.09 + monster.id)))))
      }
      // What it is doing: a skeleton raising its sword up and back to swing, or crouching low with its sword drawn back
      // and its eyes ablaze to charge, leaning hard into the dash; an archer's arrow on the string; the lich's staff
      // raised, its crystal glowing brighter as the spell comes: held high overhead for icicles (they come down from
      // above), levelled at the player for shards (it faces the player as it casts), lifted a little for the rest.
      const object = kept.object
      const act = monster.act
      const arm = object.getObjectByName('weapon-arm')
      const body = object.getObjectByName('body')
      if (arm && body) poseSkeleton(body, arm, object.getObjectByName('fury'), act, now)
      const nocked = object.getObjectByName('nocked')
      if (nocked) nocked.visible = act?.k === 'aim'
      const spearArm = object.getObjectByName('spear-arm')
      if (spearArm) poseSpearArm(spearArm, act)
      if (monster.kind === 'mummy') {
        poseMummyArms(object, act)
        // Its blow: a lurch forward into it.
        if (act?.k === 'swipe') {
          const lurch = Math.sin(Math.PI * Math.min(1, act.progress)) * MUMMY_LURCH * scale
          object.position.x += Math.cos(kept.angle) * lurch
          object.position.z += Math.sin(kept.angle) * lurch
        }
      }
      const staff = object.getObjectByName('staff')
      const glow = object.getObjectByName('glow')
      if (staff) {
        const spell = act?.k === 'cast' ? act.spell : undefined
        const rise = act?.k === 'cast' ? Math.min(1, act.progress * 3) : 0
        const lift = spell === 'icicles' ? STAFF_HIGH : spell === 'shards' ? STAFF_LEVELLED_LIFT : STAFF_LIFT
        staff.position.y = (staff.userData.baseY ?? 0) + lift * rise
        staff.rotation.z = spell === 'shards' ? -STAFF_LEVEL * rise : 0
      }
      if (glow) {
        glow.visible = act?.k === 'cast'
        if (act?.k === 'cast') glow.scale.setScalar(0.35 + 0.35 * act.progress + 0.05 * Math.sin(now * 0.03))
      }
      if (monster.angry) this.markAngry(monster, 1.35 * scale, now, pxPerTile)
    }
    this.keptMonsters.sweep()
  }

  // A red mark bobbing over a hostile creature after a player, `height` up, and a red ring under it.
  private markAngry(creature: { id: number; x: number; y: number; size: number }, height: number, now: number, pxPerTile: number): void {
    const { label, ring } = this.angryMarks.next()
    label.fit(pxPerTile)
    label.sprite.position.set(creature.x, height + 0.1 * Math.sin(now * 0.008 + creature.id), creature.y)
    ring.position.set(creature.x, 0.04, creature.y)
    ring.scale.setScalar(Math.max(0.45, creature.size * 0.6) * (1 + 0.08 * Math.sin(now * 0.01)))
  }

  // ---- the dungeon's spike traps

  // The spikes of every trap going off: from the floor, a few to a tile, straight up; from a wall, long and level,
  // across the floor it covers. Set off and not yet up, their tips just show.
  private updateTraps(traps: readonly TrapView[], now: number): void {
    const up = UP
    let count = 0
    const spike = (x: number, y: number, z: number, along: THREE.Vector3, length: number, width: number): void => {
      if (count >= MAX_SPIKES || length <= 0.001) return
      scratch.turn.setFromUnitVectors(up, along)
      scratch.matrix.compose(scratch.at.set(x, y, z), scratch.turn, scratch.size.set(width, length, width))
      this.spikes.setMatrixAt(count++, scratch.matrix)
    }
    for (const trap of traps) {
      const shown = trap.arming ? 0.06 + 0.03 * Math.sin(now * 0.08) : trap.up
      if (trap.wall) {
        const dir = new THREE.Vector3(trap.wall.dir.x, 0, trap.wall.dir.y)
        const reach = Math.max(1, trap.tiles.length / Math.max(1, trap.wall.tiles.length))
        for (const wall of trap.wall.tiles) {
          // From the face of the wall, out across the floor.
          const fx = wall.x + 0.5 + trap.wall.dir.x * 0.5
          const fz = wall.y + 0.5 + trap.wall.dir.y * 0.5
          for (const [side, height] of WALL_SPIKES) {
            const sx = trap.wall.dir.y !== 0 ? side : 0
            const sz = trap.wall.dir.x !== 0 ? side : 0
            spike(fx + sx, height, fz + sz, dir, reach * shown, 0.12)
          }
        }
      } else {
        for (const tile of trap.tiles) {
          for (const ox of [0.2, 0.5, 0.8]) for (const oz of [0.2, 0.5, 0.8]) spike(tile.x + ox, 0, tile.y + oz, up, 0.55 * shown, 0.13)
        }
      }
    }
    this.spikes.count = count
    this.spikes.instanceMatrix.needsUpdate = true
  }

  // ---- players

  private updatePlayers(players: readonly PlayerView[], pxPerTile: number): void {
    for (const player of players) {
      const kept = this.keptPlayers.keep(player.id, 'caveman', () => {
        const name = new Label({ color: '#f0e6d2', size: 14, bold: true })
        this.labels.add(name.sprite)
        return { object: models.caveman(), name, angle: player.facing, last: { x: player.x, y: player.y }, walk: 0, stride: 0, hurt: false, dressed: '', holding: '' }
      })
      const object = kept.object
      // What they wear and hold, put on and in hand when it changes.
      const armor = player.armor ?? [0, 0, 0]
      const dressed = armor.join(',')
      const held = player.held ?? 0
      const holding = `${held}`
      if (dressed !== kept.dressed || holding !== kept.holding) {
        // Back to their own colours first, so the new parts' colours are the ones remembered.
        if (kept.hurt) tint(object, false)
        kept.hurt = false
        if (dressed !== kept.dressed) {
          kept.dressed = dressed
          ;(['head', 'body', 'feet'] as const).forEach((slot, i) => {
            const item = armor[i] ? getItem(armor[i] as ItemId) : undefined
            models.wear(object, slot, item?.key, item ? new THREE.Color(item.color).getHex() : undefined)
          })
        }
        if (holding !== kept.holding) {
          kept.holding = holding
          this.hold(object, held)
        }
        rememberMaterials(object)
      }
      const moved = Math.hypot(player.x - kept.last.x, player.y - kept.last.y)
      kept.last = { x: player.x, y: player.y }
      kept.walk += moved * STRIDE_PER_TILE
      kept.stride += ((moved > 0.001 ? 1 : 0) - kept.stride) * STRIDE_EASE
      // Facing where they attack at once (an attack is aimed), else turning towards where they walk.
      kept.angle += shortestTurn(kept.angle, player.facing) * (player.pose ? 1 : TURN_RATE)
      object.position.set(player.x, stride(object, kept.walk, kept.stride), player.y)
      // Flickering while they cannot be hurt again.
      object.visible = !player.blink
      object.rotation.y = -kept.angle
      poseArms(object, player, Math.sin(kept.walk) * ARM_SWING * kept.stride)
      // Lit up red while it has just been hurt.
      const hurt = player.hurt === true
      if (kept.hurt !== hurt) {
        kept.hurt = hurt
        tint(object, hurt)
      }
      kept.name.set(player.name, player.local ? '#f0b04a' : '#f0e6d2')
      kept.name.fit(pxPerTile)
      kept.name.sprite.position.set(player.x, 1.32, player.y)
    }
    this.keptPlayers.sweep()
  }

  // Puts what a player holds in their hand: a weapon or tool's model (a bow in the left hand), or else the item's
  // picture, small, in the right.
  private hold(object: THREE.Object3D, item: number): void {
    const right = object.getObjectByName('hand-right')
    const left = object.getObjectByName('hand-left')
    right?.clear()
    left?.clear()
    if (!item) return
    const key = getItem(item as ItemId).key
    const model = models.heldModel(key)
    if (model) {
      model.name = 'held'
      ;(isBow(key) ? left : right)?.add(model)
      return
    }
    const picture = new THREE.Sprite(itemMaterial(item))
    picture.name = 'held'
    picture.scale.set(0.3, 0.3, 0.3)
    picture.position.set(0.05, -0.08, 0)
    right?.add(picture)
  }

  // The swishes in the air behind swinging weapons: pale, see-through ribbons at the height a weapon swings, tracing
  // what each attack covers as it goes, the tail fading behind the weapon's edge.
  private updateSwishes(frame: WorldFrame): void {
    for (const swish of frame.attacks.swishes) {
      const geometry = this.swishMeshes.next().geometry
      const position = geometry.getAttribute('position') as THREE.BufferAttribute
      const color = geometry.getAttribute('color') as THREE.BufferAttribute
      const vertices = swishGeometry(swish, position.array as Float32Array, color.array as Float32Array)
      position.needsUpdate = true
      color.needsUpdate = true
      geometry.setDrawRange(0, vertices)
    }
    this.swishMeshes.finish()
  }

  // ---- items on the ground and in flight

  private updateDrops(frame: WorldFrame): void {
    const matrix = scratch.matrix
    let shadows = 0
    for (const drop of frame.drops) {
      const sprite = this.keptDrops.keep(drop.id, `${drop.item}`, () => ({ object: new THREE.Sprite(itemMaterial(drop.item)) })).object
      const landing = Math.min(1, Math.max(0, drop.age / LANDING_TICKS))
      const hop = Math.sin(landing * Math.PI) * HOP
      const bob = landing >= 1 ? (Math.sin(frame.now * BOB_SPEED + drop.id) + 1) * BOB : 0
      const size = DROP_SIZE * (0.5 + landing * 0.5)
      sprite.scale.set(size, size, 1)
      sprite.position.set(drop.x, size / 2 + 0.04 + hop + bob, drop.y)
      if (shadows < this.dropShadows.count) {
        matrix.makeScale(size * 0.8, 1, size * 0.5).setPosition(drop.x, 0.02, drop.y)
        this.dropShadows.setMatrixAt(shadows++, matrix)
      }
    }
    this.keptDrops.sweep()
    this.dropShadows.count = shadows
    this.dropShadows.instanceMatrix.needsUpdate = true
  }

  private updateShots(frame: WorldFrame): void {
    for (const shot of frame.attacks.shots) {
      const kind = projectileKind(shot.item)
      // Each a model, pointing the way it flies.
      const { object } = this.keptShots.keep(shot.id, kind, () => ({ object: models.projectile(kind) }))
      // An icicle falls from high above, faster and faster; something lobbed goes up and over as high as it is; anything
      // else flies at about head height.
      // (A twister stands on the ground, whirling.)
      const height = kind === 'twister' ? 0 : shot.fall !== undefined ? 4.5 * (1 - shot.fall * shot.fall) : shot.lift !== undefined ? 0.5 + shot.lift : 0.7
      object.position.set(shot.x, height, shot.y)
      object.rotation.y = kind === 'twister' ? (performance.now() * 0.015) % (Math.PI * 2) : -shot.angle
    }
    this.keptShots.sweep()
  }

  // ---- what is being placed

  private updateGhosts(overlay: OverlayView): void {
    const wanted: Array<{ view: GhostView; opacity: number }> = [
      ...overlay.pending.map((view) => ({ view, opacity: 0.45 })),
      ...(overlay.ghost ? [{ view: overlay.ghost, opacity: 0.55 }] : []),
    ]
    wanted.forEach(({ view, opacity }, i) => {
      const key = `${buildingKey({ ...view, id: 0 })}|${view.valid}|${opacity}`
      let kept = this.keptGhosts[i]
      if (!kept || kept.key !== key) {
        if (kept) this.ghosts.remove(kept.object)
        const object = buildingModel({ ...view, id: 0 })
        object.traverse((part) => {
          if (!(part instanceof THREE.Mesh)) return
          part.material = ghostMaterial(part.material as THREE.MeshStandardMaterial, view.valid, opacity)
          part.castShadow = false
        })
        kept = { object, key }
        this.keptGhosts[i] = kept
        this.ghosts.add(object)
      }
      kept.object.visible = true
      kept.object.position.set(view.x + 0.5, 0, view.y + 0.5)
    })
    for (let i = wanted.length; i < this.keptGhosts.length; i++) this.keptGhosts[i].object.visible = false
  }

  // ---- rafts

  // Each raft where it floats, turned the way it is; and, under the mouse, the raft about to be put down, see-through,
  // red where it cannot go.
  private updateRafts(frame: WorldFrame): void {
    // Their ropes, after the animals' (see updateAnimals): from the hand or fence post to the top of the raft's post.
    const rope = this.ropes.geometry.getAttribute('position') as THREE.BufferAttribute
    let ropes = this.ropesDrawn
    for (const raft of frame.rafts) {
      const { object } = this.keptRafts.keep(raft.id, 'raft', () => ({ object: models.raft() }))
      object.position.set(raft.x, 0, raft.y)
      object.rotation.y = -raft.angle
      if (raft.rope && ropes < MAX_ROPES) {
        rope.setXYZ(ropes * 2, raft.rope.x, 0.55, raft.rope.y)
        rope.setXYZ(ropes * 2 + 1, raft.x, models.RAFT_POST_HEIGHT - 0.02, raft.y)
        ropes++
      }
    }
    this.keptRafts.sweep()
    rope.needsUpdate = true
    this.ropes.geometry.setDrawRange(0, ropes * 2)
    const wanted = frame.overlay.raftGhost
    if (this.raftGhost && (!wanted || this.raftGhost.valid !== wanted.valid)) {
      this.ghosts.remove(this.raftGhost.object)
      this.raftGhost = undefined
    }
    if (!wanted) return
    if (!this.raftGhost) {
      const object = models.raft()
      object.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return
        part.material = ghostMaterial(part.material as THREE.MeshStandardMaterial, wanted.valid, 0.55)
        part.castShadow = false
      })
      this.raftGhost = { object, valid: wanted.valid }
      this.ghosts.add(object)
    }
    this.raftGhost.object.position.set(wanted.x, 0, wanted.y)
  }

  // ---- painted on the ground

  // The name over a hovered chest.
  private readonly hoverLabel = new Label({ color: '#f0e6d2', size: 15, bold: true })

  private updateHoverLabel(overlay: OverlayView, pxPerTile: number): void {
    const sprite = this.hoverLabel.sprite
    if (!sprite.parent) this.labels.add(sprite)
    sprite.visible = overlay.label !== undefined
    if (!overlay.label) return
    this.hoverLabel.set(overlay.label.text)
    this.hoverLabel.fit(pxPerTile)
    sprite.position.set(overlay.label.x + 0.5, 1.05, overlay.label.y + 0.5)
  }

  private paintOverlay(overlay: OverlayView, pxPerTile: number): void {
    const line = 2 / pxPerTile
    const paint = this.paint
    if (overlay.target) paint.tile(overlay.target.x, overlay.target.y, ACCENT, 1, line)
    else if (overlay.ghost) paint.tile(overlay.ghost.x, overlay.ghost.y, overlay.ghost.valid ? ACCENT : INVALID, 1, line)
    else if (overlay.hover) paint.tile(overlay.hover.x, overlay.hover.y, HOVER, 0.6, line)
    if (overlay.selected) paint.tile(overlay.selected.x, overlay.selected.y, ACCENT, 1, line * 1.5)
    for (const tile of overlay.removing) {
      const inset = 0.2
      paint.line({ x: tile.x + inset, y: tile.y + inset }, { x: tile.x + 1 - inset, y: tile.y + 1 - inset }, REMOVE, 1, line * 2)
      paint.line({ x: tile.x + 1 - inset, y: tile.y + inset }, { x: tile.x + inset, y: tile.y + 1 - inset }, REMOVE, 1, line * 2)
    }
  }

  private paintAttacks(frame: WorldFrame, pxPerTile: number): void {
    const width = 2 / pxPerTile
    for (const mark of frame.attacks.marks) {
      for (const polygon of mark.polygons) {
        this.paint.fill(polygon, mark.color, mark.fill)
        this.paint.stroke(polygon, mark.color, mark.stroke, width)
      }
    }
  }

  private paintDebug(frame: WorldFrame, pxPerTile: number): void {
    const debug = frame.debug!
    const line = 1.5 / pxPerTile
    for (const chunk of debug.chunks) {
      const { cx, cy } = chunkCoords(chunk)
      const corners = [
        { x: cx * CHUNK_SIZE, y: cy * CHUNK_SIZE },
        { x: (cx + 1) * CHUNK_SIZE, y: cy * CHUNK_SIZE },
        { x: (cx + 1) * CHUNK_SIZE, y: (cy + 1) * CHUNK_SIZE },
        { x: cx * CHUNK_SIZE, y: (cy + 1) * CHUNK_SIZE },
      ]
      if (debug.desynced.includes(chunk)) this.paint.fill(corners, 0xe5533d, 0.18)
      this.paint.stroke(corners, 0x58b4c8, 0.7, line * 2)
    }
    for (const link of debug.links) {
      const color = link.blocked ? 0xe5533d : link.remote ? 0x58b4c8 : 0x8bc34a
      this.paint.line({ x: link.from.x + 0.5, y: link.from.y + 0.5 }, { x: link.to.x + 0.5, y: link.to.y + 0.5 }, color, 0.9, line * 2)
    }
  }

  // ---- over everything: health bars, sparks, damage numbers

  private updateEffects(frame: WorldFrame, camera: THREE.OrthographicCamera, pxPerTile: number): void {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)

    // Health bars: a fixed size on screen, over what was hurt.
    const barWidth = 44 / pxPerTile
    const barHeight = 6 / pxPerTile
    for (const bar of frame.overlay.bars) {
      const { back, fill } = this.bars.next()
      const fraction = Math.max(0, Math.min(1, bar.fraction))
      const middle = scratch.at.set(bar.x + 0.5, bar.tall ? 2.5 : 1.1, bar.y + 0.5)
      back.quaternion.copy(camera.quaternion)
      fill.quaternion.copy(camera.quaternion)
      back.position.copy(middle)
      back.scale.set(barWidth + 2 / pxPerTile, barHeight + 2 / pxPerTile, 1)
      fill.position.copy(middle).addScaledVector(right, (-(1 - fraction) * barWidth) / 2)
      fill.scale.set(Math.max(0.0001, barWidth * fraction), barHeight, 1)
    }
    this.bars.finish()

    // Sparks: rings that grow and fade where something was hit, facing the screen.
    for (const spark of frame.attacks.sparks) {
      const mesh = this.sparkMeshes.next()
      mesh.material.color.setHex(spark.color)
      mesh.material.opacity = 1 - spark.age
      mesh.quaternion.copy(camera.quaternion)
      mesh.position.set(spark.x, 0.5, spark.y)
      mesh.scale.setScalar(0.12 + 0.3 * spark.age)
    }
    this.sparkMeshes.finish()

    // Clouds: frost, poison, snow.
    this.puffs.update(frame.attacks.puffs)

    // Damage numbers rise off what was hurt and fade.
    for (const number of frame.attacks.numbers) {
      const label = this.numberLabels.next()
      label.set(number.text)
      label.fit(pxPerTile)
      label.sprite.material.opacity = 1 - number.age
      label.sprite.position.set(number.x, 1, number.y).addScaledVector(up, number.age * 0.8)
    }
    this.numberLabels.finish()
  }

  dispose(): void {
    for (const kept of this.keptPlayers.values()) kept.name.dispose()
    for (const label of this.numberLabels.all()) label.dispose()
    for (const mark of this.angryMarks.all()) mark.label.dispose()
    this.hoverLabel.dispose()
  }
}

// ---- which model

// What a building's model depends on: when this changes, the model is made again.
function buildingKey(building: BuildingView): string {
  switch (building.kind) {
    case 'sapling':
      return `sapling${models.growthLook(Math.min(building.stage ?? 0, SAPLING_STAGES) / SAPLING_STAGES)}`
    case 'sprout':
      return `sprout${models.growthLook(Math.min(building.stage ?? 0, SPROUT_STAGES) / SPROUT_STAGES)}`
    case 'seedling':
      return `seedling${models.growthLook(Math.min(building.stage ?? 0, SEEDLING_STAGES) / SEEDLING_STAGES)}`
    case 'young-cactus':
      return `young-cactus${models.growthLook(Math.min(building.stage ?? 0, CACTUS_STAGES) / CACTUS_STAGES)}`
    case 'fence':
      return `fence${building.connect ?? 0}${building.tied ? 't' : ''}`
    case 'gate':
      return `gate${gateRunsAcross(building.connect ?? 0)}${building.open ?? false}`
    case 'wood-wall':
      return `wood-wall${building.connect ?? 0}`
    case 'wood-door':
      return `wood-door${gateRunsAcross(building.connect ?? 0)}${building.open ?? false}`
    case 'wood-floor':
    case 'stone-floor':
      return `${building.kind}${building.connect ?? 0}`
    case 'campfire':
    case 'oven':
      return `${building.kind}${building.lit ?? false}${building.smoking ? 's' : ''}`
    case 'plot':
      // The water in steps of a fifth, so the model is not made again every time it dries a little.
      return `plot${building.cropStage ?? ''}|${Math.round((building.water ?? 0) / 20)}`
    case 'barrel': {
      const barrel = building.barrel
      return barrel ? `barrel${barrel.sealed}|${barrel.liquid}|${Math.round(barrel.fill * 8)}|${barrel.composting}` : 'barrel'
    }
    case 'rack':
      return `rack${building.rack ?? 'empty'}`
    case 'feeder':
      // How full, in steps of an eighth (and empty apart), so it is not made again at every bite taken from it.
      return `feeder${feedStep(building.feed ?? 0)}`
    case 'loose':
      return `loose${building.item ?? 0}`
    case 'stump':
    case 'workbench':
    case 'carpenter':
      return `${building.kind}${building.tool ?? ''}`
    case 'pedestal':
    case 'altar':
      return `${building.kind}${building.shown ?? ''}`
    default:
      return building.kind
  }
}

// How full a feed trough is drawn, in FEED_STEPS steps: 0 only when it is empty, at least 1 with anything in it.
const FEED_STEPS = 8
function feedStep(feed: number): number {
  return feed <= 0 ? 0 : Math.max(1, Math.min(FEED_STEPS, Math.round(feed * FEED_STEPS)))
}

// A pedestal's or an altar's model, with what is on it floating over it at `height` (made to bob and spin in
// updateBuildings).
function withFloating(model: THREE.Group, item: ItemId | undefined, height: number): THREE.Group {
  if (item === undefined) return model
  const floating = itemPlane(item)
  floating.name = 'floating'
  floating.position.y = height
  floating.userData.baseY = height
  model.add(floating)
  return model
}

function buildingModel(building: BuildingView): THREE.Object3D {
  const { x, y } = building
  switch (building.kind) {
    case 'tree':
      return models.tree(x, y)
    case 'bush':
      return models.bush()
    case 'rock':
      return models.rock(x, y)
    case 'grass':
      return models.grass(x, y)
    case 'loose':
      return models.loose(building.item ? getItem(building.item).key : '', x, y)
    case 'sapling':
      return models.sapling(models.growthLook(Math.min(building.stage ?? 0, SAPLING_STAGES) / SAPLING_STAGES))
    case 'sprout':
      return models.sprout(models.growthLook(Math.min(building.stage ?? 0, SPROUT_STAGES) / SPROUT_STAGES))
    case 'fence':
      return models.fence(building.connect ?? 0, building.tied)
    case 'gate':
      return models.gate(gateRunsAcross(building.connect ?? 0), building.open ?? false)
    case 'stump':
      return models.stump(building.tool === undefined ? undefined : getItem(building.tool).key)
    case 'workbench':
      return models.workbench(building.tool === undefined ? undefined : getItem(building.tool).key)
    case 'carpenter':
      return models.carpentersBench()
    case 'table':
      return models.table()
    case 'chair':
      return models.chair()
    case 'low-table':
      return models.lowTable()
    case 'round-table':
      return models.roundTable()
    case 'skeleton-camp':
      return models.camp()
    case 'goblin-camp':
      return models.goblinCamp()
    case 'tomb':
      return models.tomb()
    case 'campfire':
    case 'oven': {
      const fire = building.kind === 'campfire' ? models.campfire(building.lit ?? false) : models.oven(building.lit ?? false)
      if (building.smoking) fire.add(models.smoke())
      return fire
    }
    case 'sunflower':
      return models.sunflower(x, y)
    case 'seedling':
      return models.seedling(models.growthLook(Math.min(building.stage ?? 0, SEEDLING_STAGES) / SEEDLING_STAGES))
    case 'young-cactus':
      return models.youngCactus(models.growthLook(Math.min(building.stage ?? 0, CACTUS_STAGES) / CACTUS_STAGES))
    case 'clay':
      return models.clay(x, y)
    case 'copper-rock':
      return models.oreRock(x, y, 'copper')
    case 'tin-rock':
      return models.oreRock(x, y, 'tin')
    case 'cactus':
      return models.cactus(x, y)
    case 'sand':
      return models.sandPile(x, y)
    case 'cobweb':
      return models.cobweb(x, y)
    case 'hive':
      return models.beehive()
    case 'beebox':
      return models.beeBox()
    case 'barrel': {
      const barrel = building.barrel
      return barrel ? models.barrel(barrel.sealed, barrel.liquid, barrel.fill, barrel.composting) : models.barrel()
    }
    case 'rack':
      return models.rack(building.rack)
    case 'feeder':
      return models.feeder(feedStep(building.feed ?? 0) / FEED_STEPS)
    case 'wood-wall':
      return models.woodWall(building.connect ?? 0, x, y)
    case 'wood-door':
      return models.woodDoor(gateRunsAcross(building.connect ?? 0), building.open ?? false)
    case 'wood-floor':
      return models.woodFloor(x, y, building.connect ?? 0)
    case 'stone-floor':
      return models.stoneFloor(x, y, building.connect ?? 0)
    case 'well':
      return models.well()
    case 'altar':
      return withFloating(models.altar(), building.shown, models.ALTAR_HOLD_Y)
    case 'waystone':
      return models.waystone()
    case 'worker':
      return models.workerSkeleton()
    case 'dummy':
      return models.targetDummy()
    case 'pedestal':
      return withFloating(models.pedestal(), building.shown, models.PEDESTAL_HOLD_Y)
    case 'chest':
      return models.chest()
    case 'bed':
      return models.sleepingBag()
    case 'door':
      return models.iceDoor()
    case 'plot': {
      const made = models.plot(Math.round((building.water ?? 0) / 20) * 20)
      if (building.cropStage !== undefined) made.add(models.crop(building.cropStage))
      return made
    }
    default: {
      // The factory's machines (put away for now), turned to face their way.
      const made = models.machine(building.kind === 'belt' ? 0x3a3530 : 0x7a6a55)
      if (building.kind === 'belt') made.scale.y = 0.15
      made.rotation.y = (-building.dir * Math.PI) / 2
      return made
    }
  }
}

// Whether a held item is a bow (held in the left hand, its string drawn back with the right).
function isBow(key: string): boolean {
  return key === 'bow' || key === 'bone-longbow'
}

function monsterModel(kind: string): THREE.Group {
  if (kind === 'skeleton-archer') return models.skeletonArcher()
  if (kind === 'frost-lich') return models.frostLich()
  if (kind === 'frost-wisp') return models.frostWisp()
  if (kind === 'goblin') return models.goblin()
  if (kind === 'goblin-archer') return models.goblinArcher()
  if (kind === 'goblin-shaman') return models.goblinShaman()
  if (kind === 'dust-elemental') return models.dustElemental()
  if (kind === 'mummy') return models.mummy()
  if (kind === 'bee') return models.bee()
  if (kind === 'queen-bee') return models.queenBee()
  return models.skeleton()
}

function animalModel(kind: string, male: boolean): THREE.Group {
  if (kind === 'cow') return models.cow(male)
  if (kind === 'chicken') return models.chicken(male)
  if (kind === 'deer') return models.deer(male)
  if (kind === 'wolf') return models.wolf(male)
  if (kind === 'spider') return models.spider(male)
  if (kind === 'scarab') return models.scarab(male)
  return models.machine(0xb0a080)
}

function projectileKind(item: number): 'arrow' | 'spear' | 'stone' | 'shard' | 'icicle' | 'ice-spear' | 'hex' | 'twister' {
  const key = getItem(item as ItemId).key
  if (key === 'twister') return 'twister'
  // (A staff's: the ice spear coming down, and the icicle it shoots, drawn as a shard.)
  if (key === 'ice-spear') return 'ice-spear'
  if (key === 'icicle-shot') return 'shard'
  if (key === 'hex-bolt') return 'hex'
  if (key.endsWith('spear')) return 'spear'
  if (key === 'ice-shard') return 'shard'
  if (key === 'icicle') return 'icicle'
  if (key === 'arrow') return 'arrow'
  return 'stone'
}

// A puff of smoke off a fire, `now` ms into the game: each rises from the fire over SMOKE_RISE_MS, drifting and
// spreading as it goes, and fades away, the next one following on (each a share of the way behind the last).
const SMOKE_RISE_MS = 2600
function smokePuff(puff: THREE.Mesh, now: number): void {
  const offset = (puff.userData.offset as number | undefined) ?? 0
  const t = (now / SMOKE_RISE_MS + offset) % 1
  puff.position.set(Math.sin(t * 5 + offset * 9) * 0.12 * t + t * 0.15, 0.45 + t * 1.7, Math.cos(t * 4 + offset * 7) * 0.1 * t)
  puff.scale.setScalar(0.14 + t * 0.4)
  ;(puff.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t) * Math.min(1, t * 6)
}

// ---- animals and monsters


// A skeleton's pose for what it is doing (see `skeleton` in models.ts): raising its sword up and back over its shoulder
// to swing, shaking just before it comes round; crouched low and leaning in, the sword drawn back at its side, eyes
// ablaze and trembling, to charge; leaning hard into the dash with the sword thrust out; else standing.
function poseSkeleton(body: THREE.Object3D, arm: THREE.Object3D, fury: THREE.Object3D | undefined, act: MonsterView['act'], now: number): void {
  const ease = (t: number): number => t * t * (3 - 2 * t)
  body.rotation.set(0, 0, 0)
  body.position.set(0, 0, 0)
  arm.rotation.set(0, 0, 0)
  arm.position.x = 0.02
  if (fury) fury.visible = false
  if (!act) return
  if (act.k === 'swing') {
    const t = ease(Math.min(1, act.progress / 0.7))
    const shake = act.progress > 0.8 ? 0.06 * Math.sin(now * 0.08) : 0
    arm.rotation.set(0, -1.7 * t, 0.9 * t + shake)
    body.rotation.y = -0.35 * t
    return
  }
  if (act.k === 'charge' || act.k === 'dash') {
    const dashing = act.k === 'dash'
    const t = dashing ? 1 : ease(Math.min(1, act.progress / 0.5))
    body.rotation.z = (dashing ? -0.6 : -0.32) * t
    body.position.y = -0.07 * t
    body.position.z = dashing ? 0 : 0.02 * Math.sin(now * 0.07) * t
    arm.position.x = dashing ? 0.18 : 0.02 - 0.18 * t
    arm.rotation.set(0, dashing ? 0 : 0.35 * t, dashing ? -0.15 : -0.25 * t)
    if (fury) {
      fury.visible = true
      fury.scale.setScalar(1 + 0.25 * Math.sin(now * (dashing ? 0.05 : 0.02 + 0.03 * act.progress)))
    }
  }
}

// A goblin's spear arm (see `goblin` in models.ts), from where it rests (the spear levelled low, forward): drawn back a
// little to jab, then thrust out; or raised up and back to throw, then flung forward.
// A mummy's arms: raised up over its head as it winds up a slam (`slam`), then brought down hard in front of it, a
// little past level, and back (`smash`); for a plain blow, flicked up a little and chopped down, and back (`swipe`);
// else held straight out in front.
function poseMummyArms(object: THREE.Object3D, act: MonsterView['act']): void {
  const p = Math.min(1, Math.max(0, act?.progress ?? 0))
  let lift = 0
  if (act?.k === 'slam') lift = MUMMY_ARMS_UP * (1 - (1 - p) ** 3)
  if (act?.k === 'smash') lift = p < 0.3 ? MUMMY_ARMS_UP + (MUMMY_ARMS_DOWN - MUMMY_ARMS_UP) * (p / 0.3) : MUMMY_ARMS_DOWN * (1 - (p - 0.3) / 0.7)
  if (act?.k === 'swipe') lift = p < 0.2 ? MUMMY_SWIPE_UP * (p / 0.2) : p < 0.45 ? MUMMY_SWIPE_UP + (MUMMY_ARMS_DOWN - MUMMY_SWIPE_UP) * ((p - 0.2) / 0.25) : MUMMY_ARMS_DOWN * (1 - (p - 0.45) / 0.55)
  for (const name of ['arm-l', 'arm-r']) {
    const arm = object.getObjectByName(name)
    if (arm) arm.rotation.z = lift
  }
}

function poseSpearArm(arm: THREE.Object3D, act: MonsterView['act']): void {
  const rest = (arm.userData.rest ??= { x: arm.position.x, y: arm.position.y }) as { x: number; y: number }
  arm.position.set(rest.x, rest.y, arm.position.z)
  arm.rotation.set(0, 0, 0)
  if (!act) return
  const ease = (t: number): number => t * t * (3 - 2 * t)
  const p = Math.min(1, Math.max(0, act.progress))
  switch (act.k) {
    case 'jab':
      arm.position.x = rest.x - 0.08 * ease(p)
      break
    case 'thrust':
      arm.position.x = rest.x - 0.08 + 0.3 * Math.sin(Math.PI * Math.min(1, p * 1.3))
      break
    case 'throw': {
      const t = ease(p)
      arm.position.set(rest.x - 0.12 * t, rest.y + 0.16 * t, arm.position.z)
      arm.rotation.z = 0.55 * t
      break
    }
    case 'hurl':
      arm.position.set(rest.x - 0.12 + 0.32 * ease(p), rest.y + 0.16 * (1 - p), arm.position.z)
      arm.rotation.z = 0.55 * (1 - p) - 0.2 * Math.sin(Math.PI * p)
      break
  }
}

// What placeCreature needs of an animal or a monster.
type CreatureLook = Pick<AnimalView & MonsterView, 'id' | 'x' | 'y' | 'facing' | 'hurt' | 'dying'>

// A new animal or monster's model, kept from frame to frame (see placeCreature).
function keptCreature(object: THREE.Object3D, creature: CreatureLook): KeptCreature {
  object.rotation.order = 'YXZ'
  rememberMaterials(object)
  return { object, hurt: false, angle: creature.facing, last: { x: creature.x, y: creature.y } }
}

// Stands an animal or monster's model where it is: turned smoothly towards where it faces, bobbing as it walks (or,
// `floats`, bobbing in the air), `scale` times the model's size, lit up red while it has just been hurt, and, killed,
// keeling over onto its side and in the last moment shrinking away (into its drops).
function placeCreature(kept: KeptCreature, creature: CreatureLook, scale: number, now: number, floats = false): void {
  const object = kept.object
  object.userData.spot = { x: creature.x, y: creature.y }
  const moving = Math.hypot(creature.x - kept.last.x, creature.y - kept.last.y) > 0.0005
  kept.last = { x: creature.x, y: creature.y }
  kept.angle += shortestTurn(kept.angle, creature.facing) * TURN_RATE
  object.rotation.y = -kept.angle
  const lift = floats ? 0.15 + 0.08 * Math.sin(now * 0.006 + creature.id) : moving ? Math.abs(Math.sin(now * 0.014 + creature.id)) * 0.05 : 0
  object.position.set(creature.x, lift, creature.y)
  const dying = creature.dying
  const fall = dying === undefined ? 0 : Math.min(1, dying / 0.6)
  object.rotation.x = (1 - (1 - fall) * (1 - fall)) * (Math.PI / 2)
  const shrink = dying !== undefined && dying > 0.75 ? Math.max(0.05, 1 - (dying - 0.75) / 0.25) : 1
  object.scale.setScalar(scale * shrink)
  if (kept.hurt !== creature.hurt) {
    kept.hurt = creature.hurt
    tint(object, creature.hurt)
  }
}

// Poses a deer (see `deer` in models.ts) for how fast it is going, its legs straight, swinging from hip and shoulder:
// standing still; walking, a foot at a time, its head
// nodding with each step; or, going fast, running in bounds, forelegs and hind legs together, stretched out and
// sprung up off the ground, then gathered under it, its body rocking, head reaching forward and white tail raised.
// Walking blends into running as it speeds up. Replaces the bob placeCreature gives it.
function gaitDeer(kept: KeptCreature, deer: CreatureLook, scale: number, now: number): void {
  const object = kept.object
  const body = object.getObjectByName('body')
  if (!body) return
  const gait = (kept.gait ??= { x: deer.x, y: deer.y, at: now, pace: 0, phase: 0 })
  const seconds = Math.min(0.25, Math.max(0, (now - gait.at) / 1000))
  const moved = Math.min(1, Math.hypot(deer.x - gait.x, deer.y - gait.y))
  gait.x = deer.x
  gait.y = deer.y
  gait.at = now
  const speed = deer.dying === undefined && seconds > 0 ? moved / seconds : 0
  gait.pace += (speed - gait.pace) * (1 - Math.exp(-seconds * DEER_PACE_EASE))
  const amount = Math.min(1, gait.pace / DEER_MOVING_PACE)
  const t = Math.min(1, Math.max(0, (gait.pace - DEER_RUN_FROM) / (DEER_RUN_TO - DEER_RUN_FROM)))
  const run = t * t * (3 - 2 * t)
  const walk = 1 - run
  gait.phase = (gait.phase + (moved / scale) * (DEER_WALK_STRIDE * walk + DEER_RUN_STRIDE * run)) % (Math.PI * 2)
  const phase = gait.phase
  const swing = (DEER_WALK_SWING * walk + DEER_RUN_SWING * run) * amount
  for (const leg of DEER_LEGS) {
    const hip = body.getObjectByName(leg.name)
    if (!hip) continue
    const at = phase + Math.PI * 2 * (leg.walk * walk + leg.run * run)
    hip.rotation.z = Math.sin(at) * swing
  }
  // Walking, a little rise with each step; running, sprung up as its legs stretch out, and rocking as they gather in.
  const rise = 0.015 * walk * amount * Math.abs(Math.cos(phase * 2)) + 0.12 * run * amount * Math.max(0, Math.sin(phase))
  body.position.y = 0.66 + rise
  body.rotation.z = 0.1 * run * amount * Math.cos(phase)
  object.position.y = 0
  const head = body.getObjectByName('head')
  if (head) head.rotation.z = -0.07 * walk * amount * Math.sin(phase * 2) - (0.25 + 0.08 * Math.sin(phase)) * run * amount
  const tail = body.getObjectByName('tail')
  if (tail) tail.rotation.z = -1.5 * run * amount
}

// Walks one on many legs (a spider, a scarab: its legs pivots named `leg-<l|r>-<i>`, front first, `legs` a side) for
// how fast it is going: its legs in two sets, every other one, a side's front leg with the other side's second, and so
// on, one set stepping while the other stands, each leg swinging forward about its hip lifted, and back down on the
// ground; standing still, its legs still. Replaces the bob placeCreature gives it.
function gaitCrawler(kept: KeptCreature, crawler: CreatureLook, scale: number, now: number, legs: number): void {
  const gait = (kept.gait ??= { x: crawler.x, y: crawler.y, at: now, pace: 0, phase: 0 })
  const seconds = Math.min(0.25, Math.max(0, (now - gait.at) / 1000))
  const moved = Math.min(1, Math.hypot(crawler.x - gait.x, crawler.y - gait.y))
  gait.x = crawler.x
  gait.y = crawler.y
  gait.at = now
  const speed = crawler.dying === undefined && seconds > 0 ? moved / seconds : 0
  gait.pace += (speed - gait.pace) * (1 - Math.exp(-seconds * DEER_PACE_EASE))
  const amount = Math.min(1, gait.pace / CRAWLER_MOVING_PACE)
  gait.phase = (gait.phase + (moved / scale) * CRAWLER_STRIDE) % (Math.PI * 2)
  kept.object.position.y = 0
  for (const [side, toward] of [['l', -1], ['r', 1]] as const) {
    for (let i = 0; i < legs; i++) {
      const leg = kept.object.getObjectByName(`leg-${side}-${i}`)
      if (!leg) continue
      const at = gait.phase + ((i + (side === 'r' ? 1 : 0)) % 2) * Math.PI
      // Its foot forward of where it stands by -cos (so going forward while sin is above 0, when it is lifted).
      leg.rotation.y = toward * -Math.cos(at) * CRAWLER_SWING * amount
      leg.rotation.x = -toward * Math.max(0, Math.sin(at)) * CRAWLER_LIFT * amount
    }
  }
}

// A hunter biting (a wolf, a scarab): it lunges forward and back, dipping its head down into the bite as it goes.
function poseBite(kept: KeptCreature, animal: AnimalView, scale: number): void {
  const object = kept.object
  if (animal.bite === undefined || animal.dying !== undefined) {
    object.rotation.z = 0
    return
  }
  const lunge = Math.sin(Math.PI * Math.min(1, animal.bite))
  object.position.x += Math.cos(kept.angle) * BITE_LUNGE * scale * lunge
  object.position.z += Math.sin(kept.angle) * BITE_LUNGE * scale * lunge
  object.rotation.z = -BITE_DIP * lunge
}

// A scarab curling up to roll: its legs drawn in, rearing back and shaking; rolling, its legs in out of sight and its
// body tumbling over and over the way it goes, lifted (ROLL_LIFT) so it does not go through the ground; else as it is.
function poseRoller(kept: KeptCreature, roller: AnimalView, now: number): void {
  const body = kept.object.getObjectByName('body')
  if (!body) return
  const act = roller.act
  const tuck = act?.k === 'roll' ? 1 : act?.k === 'curl' ? Math.min(1, act.progress * 2) : 0
  for (const child of kept.object.children) {
    if (!child.name.startsWith('leg-')) continue
    child.scale.setScalar(1 - 0.7 * tuck)
    child.visible = tuck < 1
  }
  const base = (body.userData.base ??= body.position.clone()) as THREE.Vector3
  body.rotation.z = act?.k === 'roll' ? -((now * ROLL_SPIN) % (Math.PI * 2)) : 0.35 * tuck
  body.position.x = base.x + (act?.k === 'curl' ? Math.sin(now * 0.09) * 0.015 : 0)
  body.position.y = base.y + (act?.k === 'roll' ? ROLL_LIFT : 0)
}

// ---- materials made from others

// Remembers a model's own materials, to put back once it is no longer lit up as hurt (see tint): when it is made, and
// when parts are put on it.
function rememberMaterials(object: THREE.Object3D): void {
  object.traverse((part) => {
    if (part instanceof THREE.Mesh) part.userData.material = part.material
  })
}

// Lights a model up red while it has just been hurt, or puts its own materials back. What glows rather than being lit
// by the sun (a lich's crystal, a wisp's light) stays as it is.
function tint(object: THREE.Object3D, hurt: boolean): void {
  object.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return
    const base = (part.userData.material as THREE.Material | undefined) ?? (part.material as THREE.Material)
    if (base instanceof THREE.MeshStandardMaterial) part.material = hurt ? hurtMaterial(base) : base
  })
}

const hurtMaterials = new Map<THREE.Material, THREE.Material>()
// A material lit up red, for something that has just been hurt.
function hurtMaterial(base: THREE.Material): THREE.Material {
  let made = hurtMaterials.get(base)
  if (!made) {
    const color = (base as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(0xffffff)
    made = new THREE.MeshStandardMaterial({ color: color.lerp(new THREE.Color(0xff2020), 0.6), emissive: 0x801010, flatShading: true, roughness: 0.9 })
    hurtMaterials.set(base, made)
  }
  return made
}

const ghostMaterials = new Map<string, THREE.Material>()
// A see-through material for what is about to be placed: in its own colours where it can go, red where it cannot.
function ghostMaterial(base: THREE.Material, valid: boolean, opacity: number): THREE.Material {
  const color = (base as THREE.MeshStandardMaterial).color?.getHex() ?? 0xffffff
  // Two-sided where the model is (an open barrel's walls), so none of it goes missing.
  const side = base.side
  // A picture with see-through parts (a bush's leafy cards) keeps its picture and its gaps.
  const map = (base as THREE.MeshStandardMaterial).map ?? null
  const alphaTest = base.alphaTest
  const key = `${color}|${valid}|${opacity}|${side}|${map?.uuid ?? ''}`
  let made = ghostMaterials.get(key)
  if (!made) {
    const tint = new THREE.Color(color)
    if (!valid) tint.lerp(new THREE.Color(INVALID), 0.7)
    made = new THREE.MeshStandardMaterial({ color: tint, transparent: true, opacity, depthWrite: false, flatShading: true, side, map, alphaTest })
    ghostMaterials.set(key, made)
  }
  return made
}


// Poses a caveman's legs and body for `walk` (how far through its strides, radians) and `amount` (0 standing to 1
// striding): each leg swings from the hip, its knee bending as the foot comes forward (and straight as it pushes off
// behind); the body leans into it and twists against the legs. Gives how far to lower the whole model (tiles, 0 or
// less), so the planted foot stays on the ground as the legs spread, with a little spring up as they pass.
// Poses the arms for what the player is doing (see PlayerPose): at rest they swing as it walks (`stride`), held a
// little forward with something in hand; attacking, they follow the attack's path.
function poseArms(object: THREE.Object3D, player: PlayerView, stride: number): void {
  const leftArm = object.getObjectByName('arm-left')
  const rightArm = object.getObjectByName('arm-right')
  const left = object.getObjectByName('arm-left-pitch')
  const right = object.getObjectByName('arm-right-pitch')
  const rightHand = object.getObjectByName('hand-right')
  const leftHand = object.getObjectByName('hand-left')
  if (!leftArm || !rightArm || !left || !right || !rightHand || !leftHand) return
  const held = rightHand.getObjectByName('held') ?? leftHand.getObjectByName('held')
  // Back to rest, then the pose on top.
  for (const arm of [leftArm, rightArm]) {
    arm.rotation.set(0, 0, 0)
    arm.position.x = 0
  }
  rightHand.rotation.set(0, 0, 0)
  leftHand.rotation.set(0, 0, 0)
  if (held) held.visible = true
  const heldKey = player.held ? getItem(player.held as ItemId).key : ''
  const carrying = heldKey !== ''
  // A weapon or tool held in the right fist (not a bow, held in the left; not an item's picture).
  const wielded = held instanceof THREE.Group && !isBow(heldKey)
  const sling = heldKey === 'sling'
  left.rotation.z = stride
  right.rotation.z = carrying ? CARRY_ARM - stride * 0.25 : -stride
  // At rest it is raised in the fist (a sling's cords hang from it).
  let grip = wielded && !sling ? (heldKey.endsWith('spear') || heldKey === 'oar' || heldKey === 'skewer' || heldKey === 'permafrost' ? SPEAR_GRIP : REST_GRIP) : 0
  // Whether a sling's cords stand out to be whirled (or hang), and whether its stone has gone.
  let slingOut = false
  let slung = false
  const string = leftHand.getObjectByName('bow-string') as THREE.Line | undefined
  let draw = 0
  let crouch = 0
  let lean = 0
  const pose = player.pose
  const ease = (t: number): number => t * t * (3 - 2 * t)
  if (pose) {
    grip = wielded && !sling ? SWING_GRIP : 0
    switch (pose.kind) {
      case 'swing': {
        // Drawn back across the right, then round to the left, arm out level, the weapon following through.
        const t = ease(Math.min(1, pose.progress / 0.75))
        const half = Math.min(pose.arc, Math.PI * 1.6) / 2
        right.rotation.z = Math.PI / 2 - 0.1
        rightArm.rotation.y = -(half - 2 * half * t)
        break
      }
      case 'thrust': {
        // Straight out and back, the weapon along the arm.
        const out = Math.sin(Math.min(1, pose.progress / 0.8) * Math.PI)
        right.rotation.z = Math.PI / 2
        rightArm.position.x = 0.3 * out
        grip = 0
        break
      }
      case 'charge': {
        // Raised up and back over the shoulder, gathering; shaking once it is ready to let go.
        const t = ease(Math.min(1, pose.progress / 0.4))
        const shake = pose.progress >= 1 ? 0.05 * Math.sin(performance.now() * 0.09) : 0
        right.rotation.z = Math.PI / 2 + (Math.PI / 2 - 0.35) * t + shake
        rightArm.rotation.y = 0.6 * t
        break
      }
      case 'brace': {
        // Gathering for a dash: crouched low and leaning in, the weapon drawn back low at the side and levelled the
        // way it will go, the other hand out in front; trembling once it is ready.
        const t = ease(Math.min(1, pose.progress / 0.4))
        const shake = pose.progress >= 1 ? 0.04 * Math.sin(performance.now() * 0.09) : 0
        right.rotation.z = 0.35 + 0.75 * t
        rightArm.position.x = -0.14 * t
        grip = wielded ? Math.PI / 2 - right.rotation.z + shake : 0
        left.rotation.z = 0.9 * t
        crouch = t
        lean = 0.32 * t
        break
      }
      case 'lunge':
        // The dash: thrown forward, leaning hard into it, the weapon held straight out in front.
        right.rotation.z = Math.PI / 2
        rightArm.position.x = 0.25
        grip = 0
        left.rotation.z = 0.6
        crouch = 0.6
        lean = 0.55
        break
      case 'spin':
        // Arm out to the side, level, as the whole player turns (see `spunFacing` in game.ts).
        right.rotation.z = Math.PI / 2 - 0.1
        rightArm.rotation.y = -1.1
        break
      case 'strike': {
        // Up overhead, then down hard in front, the head of it coming over.
        const t = ease(Math.min(1, pose.progress / 0.55))
        right.rotation.z = Math.PI - 0.25 - (Math.PI / 2 + 0.15) * t
        grip = wielded ? 0.6 * (1 - t) + 0.2 : 0
        break
      }
      case 'draw':
        // The bow out in the left hand; the right pulls the string back.
        left.rotation.z = Math.PI / 2
        right.rotation.z = Math.PI / 2
        rightArm.position.x = -0.2 * pose.progress
        rightArm.rotation.y = 0.35
        draw = pose.progress
        break
      case 'row': {
        // A pull and nothing else: from the start the oar is out the way it is aimed, its blade in the water out in
        // front, and it is dragged back in towards the player and on past them, the blade sweeping under and behind as
        // the arms draw back. `arm` is how far forward the arms are raised, `oar` which way the oar points from the
        // fist (0 straight down, a quarter turn straight out in front, less than 0 back behind).
        const pull = ease(pose.progress)
        const arm = 1.4 - 1.4 * pull
        const oar = 1.15 - 1.8 * pull
        right.rotation.z = arm
        left.rotation.z = arm * 0.8
        rightArm.position.x = 0.15 - 0.45 * pull
        grip = wielded ? oar - arm : 0
        break
      }
      case 'whirl':
        // Raised over the head, the sling's cords straight out from the fist and going round and round over it at a
        // steady speed, never pausing between turns (starting from behind, so it comes round to be flung forward).
        right.rotation.z = Math.PI - 0.35
        rightHand.rotation.y = Math.PI + pose.progress * Math.PI * 2
        slingOut = true
        break
      case 'release': {
        // The arm whips forward, letting fly (a sling's cords flung out after the stone); a bow is still held out in
        // front.
        right.rotation.z = Math.PI / 2 + 0.3 * (1 - pose.progress)
        if (isBow(heldKey)) left.rotation.z = Math.PI / 2
        slingOut = pose.progress < 0.5
        slung = true
        break
      }
    }
  }
  rightHand.rotation.z += grip
  // A sling's cords: straight out from the fist to be whirled, else hanging straight down from it, swaying a little
  // behind as the arm swings.
  const cords = sling ? rightHand.getObjectByName('sling-cords') : undefined
  if (cords) {
    cords.rotation.set(0, 0, slingOut ? Math.PI / 2 : -(right.rotation.z + rightHand.rotation.z) - stride * 0.4)
    const stone = cords.getObjectByName('sling-stone')
    if (stone) stone.visible = !slung
  }
  // The bow's string, straight between its tips at rest, its middle drawn back as far as it is pulled.
  if (string) {
    const points = string.geometry.getAttribute('position') as THREE.BufferAttribute
    points.setXYZ(1, 0, ((string.userData.rest as number | undefined) ?? 0) + 0.3 * draw, 0)
    points.needsUpdate = true
  }
  // Crouched and leaning in, gathering for a dash or dashing (as a skeleton charges): the body forward from the hips,
  // the knees bent and the whole player lowered so the feet stay on the ground.
  if (crouch > 0 || lean > 0) {
    const body = object.getObjectByName('body')
    if (body) body.rotation.z = -lean
    for (const side of ['left', 'right']) {
      const leg = object.getObjectByName(`leg-${side}`)
      const knee = object.getObjectByName(`knee-${side}`)
      if (leg) leg.rotation.z = 0.45 * crouch
      if (knee) knee.rotation.z = -0.9 * crouch
    }
    object.position.y -= 0.045 * crouch
  }
}

function stride(object: THREE.Object3D, walk: number, amount: number): number {
  const swing = Math.sin(walk)
  const forward = Math.cos(walk)
  for (const [side, sign] of [['right', 1], ['left', -1]] as const) {
    const leg = object.getObjectByName(`leg-${side}`)
    const knee = object.getObjectByName(`knee-${side}`)
    if (leg) leg.rotation.z = sign * swing * LEG_SWING * amount
    // Bent as the foot swings forward (its leg's swing growing), straight as it pushes back.
    if (knee) knee.rotation.z = -Math.max(0, sign * forward) * KNEE_BEND * amount
  }
  const body = object.getObjectByName('body')
  // The shoulders turn against the hips: the right one back as the right foot goes forward.
  if (body) body.rotation.set(swing * 0.03 * amount, -swing * STRIDE_TWIST * amount, -STRIDE_LEAN * amount)
  const spread = LEG_SWING * swing * amount
  return -models.HIP_HEIGHT * (1 - Math.cos(spread)) * 0.8 + Math.abs(forward) * 0.025 * amount
}

// The smallest turn from one angle to another, between -π and π.
function shortestTurn(from: number, to: number): number {
  const turn = (to - from) % (Math.PI * 2)
  return turn > Math.PI ? turn - Math.PI * 2 : turn < -Math.PI ? turn + Math.PI * 2 : turn
}

// The height (tiles) a swish is drawn at: about where a weapon swings; how many steps a swing's arc and a strike's ring
// are drawn in; and so the most corners of triangles a swish has (two triangles a step).
const SWISH_HEIGHT = 0.55
const ARC_STEPS = 16
const RING_STEPS = 24
const SWISH_VERTICES = Math.max(ARC_STEPS, RING_STEPS) * 6

// A swish's ribbon as triangles (positions, and colours with alpha), in the world, written into `positions` and
// `colors` (room for SWISH_VERTICES corners): the swept part of a swing's arc (brightest at the leading edge, fading
// back along it), a thrust's streak growing out, or a strike's ring spreading. Gives how many corners it wrote.
function swishGeometry(swish: Swish, positions: Float32Array, colors: Float32Array): number {
  let vertices = 0
  const fade = Math.max(0, 1 - swish.progress)
  const at = (angle: number, distance: number): [number, number, number] => [
    swish.x + Math.cos(angle) * distance,
    SWISH_HEIGHT,
    swish.y + Math.sin(angle) * distance,
  ]
  const tint = swish.tint ?? 0xffffff
  const r = ((tint >> 16) & 255) / 255
  const g = ((tint >> 8) & 255) / 255
  const b = (tint & 255) / 255
  const tri = (a: [number, number, number], b2: [number, number, number], c: [number, number, number], alphas: [number, number, number]): void => {
    ;[a, b2, c].forEach((point, i) => {
      positions.set(point, vertices * 3)
      colors.set([r, g, b, alphas[i]], vertices * 4)
      vertices++
    })
  }
  if (swish.shape === 'arc') {
    // How far round the sweep has come (eased as the arm is), and a tail behind it.
    const sweep = Math.min(1, swish.progress / 0.75)
    const eased = sweep * sweep * (3 - 2 * sweep)
    const start = swish.angle + swish.arc / 2
    const edge = start - swish.arc * eased
    const steps = ARC_STEPS
    for (let i = 0; i < steps; i++) {
      const a0 = start + (edge - start) * (i / steps)
      const a1 = start + (edge - start) * ((i + 1) / steps)
      // Brighter towards the leading edge.
      const b0 = (0.15 + 0.55 * (i / steps)) * fade
      const b1 = (0.15 + 0.55 * ((i + 1) / steps)) * fade
      tri(at(a0, swish.inner), at(a0, swish.outer), at(a1, swish.outer), [b0 * 0.3, b0, b1])
      tri(at(a0, swish.inner), at(a1, swish.outer), at(a1, swish.inner), [b0 * 0.3, b1, b1 * 0.3])
    }
  } else if (swish.shape === 'band') {
    // A streak straight out, as long as the thrust has reached; or, pulled (an oar), from its far end back in towards
    // the player as far as the pull has come, brightest where the oar is.
    const reach = swish.outer * Math.min(1, swish.progress / (swish.pull ? 0.85 : 0.5))
    const side = swish.angle + Math.PI / 2
    const half = Math.max(0.08, swish.width / 2)
    const point = (along: number, across: number): [number, number, number] => [
      swish.x + Math.cos(swish.angle) * along + Math.cos(side) * across,
      SWISH_HEIGHT,
      swish.y + Math.sin(swish.angle) * along + Math.sin(side) * across,
    ]
    const a = 0.6 * fade
    if (swish.pull) {
      const near = swish.outer - reach
      tri(point(swish.outer, -half), point(near, -half), point(near, half), [0.05, a, a])
      tri(point(swish.outer, -half), point(near, half), point(swish.outer, half), [0.05, a, 0.05])
    } else {
      tri(point(0, -half), point(reach, -half), point(reach, half), [0.05, a, a])
      tri(point(0, -half), point(reach, half), point(0, half), [0.05, a, 0.05])
    }
  } else {
    // A ring at the spot, spreading out to the strike's reach as it lands.
    const middle = { x: swish.x + Math.cos(swish.angle) * swish.distance, y: swish.y + Math.sin(swish.angle) * swish.distance }
    const grow = Math.min(1, swish.progress / 0.6)
    const outer = swish.outer * (0.4 + 0.6 * grow)
    const inner = outer * 0.6
    const steps = RING_STEPS
    const ring = (angle: number, r: number): [number, number, number] => [middle.x + Math.cos(angle) * r, 0.08, middle.y + Math.sin(angle) * r]
    const a = 0.65 * fade * (swish.progress > 0.3 ? 1 : swish.progress / 0.3)
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * Math.PI * 2
      const a1 = ((i + 1) / steps) * Math.PI * 2
      tri(ring(a0, inner), ring(a0, outer), ring(a1, outer), [0, a, a])
      tri(ring(a0, inner), ring(a1, outer), ring(a1, inner), [0, a, 0])
    }
  }
  return vertices
}

// Scratch objects for working out where things go, reused rather than made anew each time.
const UP = new THREE.Vector3(0, 1, 0)
const scratch = { matrix: new THREE.Matrix4(), turn: new THREE.Quaternion(), at: new THREE.Vector3(), size: new THREE.Vector3() }
