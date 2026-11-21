import * as THREE from 'three'
import {
  campSites,
  CHUNK_SIZE,
  chunkCoords,
  DUNGEON_LAYOUT,
  DUNGEON_SLOTS,
  dungeonEntrance,
  dungeonTile,
  gateRunsAcross,
  getItem,
  SAPLING_STAGES,
  SPROUT_STAGES,
  type ItemId,
  type Terrain,
} from '../../../../packages/shared/src/index.ts'
import { cameraPitch, type TileBounds } from '../camera.ts'
import { artUrl } from '../render/art.ts'
import { itemArt } from '../render/art-catalog.ts'
import type { GameView } from '../render/game-view.ts'
import type { AnimalView, BuildingView, GhostView, OverlayView, PlayerView, Swish, WorldFrame } from '../render/world-renderer.ts'
import { Ground } from './ground.ts'
import * as models from './models.ts'
import { GroundPaint, Label } from './paint.ts'

// How many screen pixels a tile is across at a zoom of 1.
const PX_PER_TILE = 56
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
// How a walking player's arms swing: how far through a swing each tile walked takes them (in radians: 2π is a whole
// swing forward and back), how far they swing (radians), and how much of the way they ease in or out each frame as the
// player starts or stops walking.
const STRIDE_PER_TILE = 2.2
const ARM_SWING = 0.45
const STRIDE_EASE = 0.12
// How the models' natural sizes (in tiles) compare with the animals' sizes in data/animals.json.
const ANIMAL_MODEL_SIZE: Readonly<Record<string, number>> = { cow: 1, chicken: 0.55, deer: 1, wolf: 0.9, skeleton: 1, 'frost-lich': 1.1 }
// How much bigger a male is drawn than a female, by kind.
export const MALE_SCALE: Readonly<Record<string, number>> = { cow: 1.08, deer: 1.06, wolf: 1.14, chicken: 1.05 }
// The mark over a hostile animal that is after a player, and the ring under it.
const ANGRY = '#ff4a3a'
const ANGRY_RING = 0xff4a3a
// How big an item on the ground is, in tiles, and how it hops out of the ground and bobs (as the 2D view's).
const DROP_SIZE = 0.42
const LANDING_TICKS = 8
const HOP = 0.3
const BOB = 0.035
const BOB_SPEED = 0.004

type Kept = { object: THREE.Object3D; key: string }

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
  // What `pick` found for each point, until the camera moves.
  const picked = new Map<string, { x: number; y: number }>()
  const raycaster = new THREE.Raycaster()
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  let frameCallback: (() => void) | undefined
  let raf = 0
  let destroyed = false
  const loop = (): void => {
    if (destroyed) return
    frameCallback?.()
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }

  const view: GameView = {
    canvas,
    turned: false,
    look(at, newZoom) {
      focus = at
      zoom = newZoom
      pxPerTile = PX_PER_TILE * zoom
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
      return {
        left: Math.floor(Math.min(...corners.map((c) => c.x))) - margin,
        right: Math.ceil(Math.max(...corners.map((c) => c.x))) + margin,
        top: Math.floor(Math.min(...corners.map((c) => c.z))) - margin,
        bottom: Math.ceil(Math.max(...corners.map((c) => c.z))) + margin,
      }
    },
    draw(frame) {
      world.update(frame, view.visible(), camera, pxPerTile)
    },
    start(frame) {
      frameCallback = frame
      raf = requestAnimationFrame(loop)
    },
    describe() {
      return `3D, ${Math.round(pxPerTile)} px a tile`
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
  private readonly buildings = new THREE.Group()
  private readonly animals = new THREE.Group()
  private readonly players = new THREE.Group()
  private readonly drops = new THREE.Group()
  private readonly shots = new THREE.Group()
  private readonly ghosts = new THREE.Group()
  private readonly effects = new THREE.Group()
  private readonly labels = new THREE.Group()
  private readonly paint = new GroundPaint()

  private readonly keptBuildings = new Map<number, Kept>()
  private readonly keptAnimals = new Map<number, Kept & { hurt: boolean; angle: number; last: { x: number; y: number } }>()
  private readonly keptPlayers = new Map<
    number,
    Kept & { name: Label; angle: number; last: { x: number; y: number }; walk: number; stride: number; hurt: boolean; dressed: string; holding: string }
  >()
  // The swishes in the air behind swinging weapons (see Swish), a mesh each, reused.
  private readonly swishMeshes: THREE.Mesh[] = []
  private readonly keptDrops = new Map<number, THREE.Sprite>()
  private readonly keptShots = new Map<number, Kept>()
  private readonly keptGhosts: Kept[] = []
  private readonly numberLabels: Label[] = []
  private readonly angryLabels: Label[] = []
  private readonly angryRings: THREE.Mesh[] = []
  private readonly angryRingGeometry = new THREE.RingGeometry(0.7, 0.85, 24).rotateX(-Math.PI / 2)
  private readonly angryRingMaterial = new THREE.MeshBasicMaterial({ color: ANGRY_RING, transparent: true, opacity: 0.75, depthWrite: false })
  // The camps, the way into the dungeon and the stairs out of it (see landmarksOf in terrain.ts), for the terrain they
  // were placed for.
  private readonly landmarks = new THREE.Group()
  private landmarksFor: Terrain | undefined
  private readonly sparkMeshes: THREE.Mesh[] = []
  private readonly bars: Array<{ back: THREE.Mesh; fill: THREE.Mesh }> = []
  private readonly hoverRing: THREE.Mesh
  private readonly ropes: THREE.LineSegments
  private readonly dropShadows: THREE.InstancedMesh
  readonly pickable: THREE.Object3D[] = [this.buildings, this.animals]

  constructor(scene: THREE.Scene) {
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthWrite: false }))
    this.hoverRing.rotation.x = -Math.PI / 2
    this.hoverRing.renderOrder = 6
    const ropeGeometry = new THREE.BufferGeometry()
    ropeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 6), 3))
    this.ropes = new THREE.LineSegments(ropeGeometry, new THREE.LineBasicMaterial({ color: ROPE }))
    this.ropes.frustumCulled = false
    this.dropShadows = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.5, 12).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
      256,
    )
    this.dropShadows.frustumCulled = false
    scene.add(this.ground.view, this.paint.mesh, this.buildings, this.animals, this.players, this.drops, this.dropShadows, this.shots, this.ghosts)
    scene.add(this.effects, this.labels, this.hoverRing, this.ropes, this.landmarks)
  }

  update(frame: WorldFrame, bounds: TileBounds, camera: THREE.OrthographicCamera, pxPerTile: number): void {
    this.ground.update(frame.terrain, bounds)
    this.updateLandmarks(frame.terrain)
    this.updateBuildings(frame)
    this.updateAnimals(frame.animals, frame.now, pxPerTile)
    this.updatePlayers(frame.players, pxPerTile, frame.now)
    this.updateSwishes(frame)
    this.updateDrops(frame)
    this.updateShots(frame)
    this.updateGhosts(frame.overlay)
    this.paint.clear()
    this.paintOverlay(frame.overlay, pxPerTile)
    this.updateHoverLabel(frame.overlay, pxPerTile)
    this.paintAttacks(frame, pxPerTile)
    if (frame.debug) this.paintDebug(frame, pxPerTile)
    this.paint.finish()
    this.updateEffects(frame, camera, pxPerTile)
  }

  // ---- landmarks

  private updateLandmarks(terrain: Terrain | undefined): void {
    if (terrain === this.landmarksFor) return
    this.landmarksFor = terrain
    this.landmarks.clear()
    if (!terrain) return
    const place = (object: THREE.Object3D, x: number, y: number): void => {
      object.position.set(x + 0.5, 0, y + 0.5)
      this.landmarks.add(object)
    }
    for (const site of campSites(terrain)) place(models.camp(), site.x, site.y)
    const entrance = dungeonEntrance(terrain)
    if (entrance) place(models.dungeonEntrance(), entrance.x, entrance.y)
    for (let slot = 0; slot < DUNGEON_SLOTS; slot++) {
      const exit = dungeonTile(slot, DUNGEON_LAYOUT.exit)
      place(models.dungeonExit(), exit.x, exit.y)
    }
  }

  // ---- buildings and plants

  private updateBuildings(frame: WorldFrame): void {
    const seen = new Set<number>()
    for (const building of frame.buildings) {
      seen.add(building.id)
      const key = buildingKey(building)
      let kept = this.keptBuildings.get(building.id)
      if (!kept || kept.key !== key) {
        if (kept) this.buildings.remove(kept.object)
        const object = buildingModel(building)
        object.userData.spot = { x: building.x + 0.5, y: building.y + 0.5 }
        kept = { object, key }
        this.keptBuildings.set(building.id, kept)
        this.buildings.add(object)
      }
      const object = kept.object
      object.position.set(building.x + 0.5, 0, building.y + 0.5)
      const shake = frame.shaking.get(building.id) ?? 0
      const sway = shake > 0 ? Math.sin(frame.now * 0.06) * shake : 0
      object.rotation.z = sway * 0.08
      object.rotation.x = sway * 0.04
      object.scale.setScalar(frame.removingIds.has(building.id) ? 0.85 : 1)
      // Campfire flames flicker.
      if (building.lit) {
        object.traverse((part) => {
          if (part.name !== 'flame') return
          part.scale.y = (part.userData.height ??= part.scale.y) * (1 + 0.18 * Math.sin(frame.now * 0.018 + part.id))
        })
      }
    }
    for (const [id, kept] of this.keptBuildings) {
      if (seen.has(id)) continue
      this.buildings.remove(kept.object)
      this.keptBuildings.delete(id)
    }
  }

  // ---- animals

  private updateAnimals(animals: readonly AnimalView[], now: number, pxPerTile: number): void {
    const seen = new Set<number>()
    let angry = 0
    let hovered: AnimalView | undefined
    let ropes = 0
    const rope = this.ropes.geometry.getAttribute('position') as THREE.BufferAttribute
    for (const animal of animals) {
      seen.add(animal.id)
      let kept = this.keptAnimals.get(animal.id)
      const key = `${animal.kind}|${animal.male}`
      if (!kept || kept.key !== key) {
        if (kept) this.animals.remove(kept.object)
        const object = animalModel(animal.kind, animal.male)
        object.rotation.order = 'YXZ'
        object.traverse((part) => {
          if (part instanceof THREE.Mesh) part.userData.material = part.material
        })
        kept = { object, key, hurt: false, angle: animal.facing, last: { x: animal.x, y: animal.y } }
        this.keptAnimals.set(animal.id, kept)
        this.animals.add(object)
      }
      const object = kept.object
      object.userData.spot = { x: animal.x, y: animal.y }
      const moving = Math.hypot(animal.x - kept.last.x, animal.y - kept.last.y) > 0.0005
      kept.last = { x: animal.x, y: animal.y }
      kept.angle += shortestTurn(kept.angle, animal.facing) * TURN_RATE
      object.rotation.y = -kept.angle
      object.position.set(animal.x, moving ? Math.abs(Math.sin(now * 0.014 + animal.id)) * 0.05 : 0, animal.y)
      const scale = (animal.size / (ANIMAL_MODEL_SIZE[animal.kind] ?? 1)) * (animal.baby ? BABY_SCALE : 1) * (animal.male ? (MALE_SCALE[animal.kind] ?? 1) : 1)
      object.scale.setScalar(scale)
      // Killed: it keels over onto its side, and in the last moment shrinks away (into its drops).
      if (animal.dying !== undefined) {
        const fall = Math.min(1, animal.dying / 0.6)
        object.rotation.x = (1 - (1 - fall) * (1 - fall)) * (Math.PI / 2)
        const shrink = animal.dying > 0.75 ? 1 - (animal.dying - 0.75) / 0.25 : 1
        object.scale.setScalar(scale * Math.max(0.05, shrink))
      }
      // Lit up red while it has just been hurt.
      if (kept.hurt !== animal.hurt) {
        kept.hurt = animal.hurt
        object.traverse((part) => {
          if (!(part instanceof THREE.Mesh)) return
          const base = part.userData.material as THREE.MeshStandardMaterial
          part.material = animal.hurt ? hurtMaterial(base) : base
        })
      }
      if (animal.hovered) hovered = animal
      // An archer aiming has its arrow on the string.
      const nocked = object.getObjectByName('nocked')
      if (nocked) nocked.visible = animal.aiming === true
      // A hostile one after a player: a red mark bobbing over it, and a red ring under it.
      if (animal.angry) {
        let label = this.angryLabels[angry]
        let ring = this.angryRings[angry]
        if (!label || !ring) {
          label = new Label({ color: ANGRY, size: 26, bold: true })
          label.set('!')
          ring = new THREE.Mesh(this.angryRingGeometry, this.angryRingMaterial)
          ring.renderOrder = 6
          this.angryLabels.push(label)
          this.angryRings.push(ring)
          this.labels.add(label.sprite)
          this.effects.add(ring)
        }
        label.sprite.visible = true
        label.fit(pxPerTile)
        label.sprite.position.set(animal.x, 1.35 * scale + 0.1 * Math.sin(now * 0.008 + animal.id), animal.y)
        ring.visible = true
        ring.position.set(animal.x, 0.04, animal.y)
        ring.scale.setScalar(Math.max(0.45, animal.size * 0.6) * (1 + 0.08 * Math.sin(now * 0.01)))
        angry++
      }
      if (animal.leader && ropes < 64) {
        const neck = 0.55 * scale
        rope.setXYZ(ropes * 2, animal.leader.x, 0.55, animal.leader.y)
        rope.setXYZ(ropes * 2 + 1, animal.x, neck, animal.y)
        ropes++
      }
    }
    for (const [id, kept] of this.keptAnimals) {
      if (seen.has(id)) continue
      this.animals.remove(kept.object)
      this.keptAnimals.delete(id)
    }
    for (let i = angry; i < this.angryLabels.length; i++) {
      this.angryLabels[i].sprite.visible = false
      this.angryRings[i].visible = false
    }
    rope.needsUpdate = true
    this.ropes.geometry.setDrawRange(0, ropes * 2)
    this.hoverRing.visible = hovered !== undefined
    if (hovered) {
      const radius = Math.max(0.35, hovered.size * (hovered.baby ? BABY_SCALE : 1) * 0.6)
      this.hoverRing.position.set(hovered.x, 0.03, hovered.y)
      this.hoverRing.scale.setScalar(radius)
    }
  }

  // ---- players

  private updatePlayers(players: readonly PlayerView[], pxPerTile: number, now: number): void {
    const seen = new Set<number>()
    for (const player of players) {
      seen.add(player.id)
      let kept = this.keptPlayers.get(player.id)
      if (!kept) {
        const object = models.caveman()
        const name = new Label({ color: '#f0e6d2', size: 14, bold: true })
        this.labels.add(name.sprite)
        kept = { object, key: 'caveman', name, angle: player.facing, last: { x: player.x, y: player.y }, walk: 0, stride: 0, hurt: false, dressed: '', holding: '' }
        this.keptPlayers.set(player.id, kept)
        this.players.add(object)
      }
      const object = kept.object
      // What they wear and hold, put on and in hand when it changes.
      const armor = player.armor ?? [0, 0, 0]
      const dressed = armor.join(',')
      const held = player.held ?? 0
      const holding = `${held}`
      if (dressed !== kept.dressed || holding !== kept.holding) {
        // Back to their own colours first, so the new parts' colours are the ones remembered.
        if (kept.hurt) this.tint(object, false)
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
        object.traverse((part) => {
          if (part instanceof THREE.Mesh) part.userData.material = part.material
        })
      }
      const moved = Math.hypot(player.x - kept.last.x, player.y - kept.last.y)
      kept.last = { x: player.x, y: player.y }
      kept.walk += moved * STRIDE_PER_TILE
      kept.stride += ((moved > 0.001 ? 1 : 0) - kept.stride) * STRIDE_EASE
      // Facing where they attack at once (an attack is aimed), else turning towards where they walk.
      kept.angle += shortestTurn(kept.angle, player.facing) * (player.pose ? 1 : TURN_RATE)
      object.position.set(player.x, Math.abs(Math.sin(kept.walk)) * 0.03 * kept.stride, player.y)
      object.rotation.y = -kept.angle
      this.pose(object, player, Math.sin(kept.walk) * ARM_SWING * kept.stride, now)
      // Lit up red while it has just been hurt.
      const hurt = player.hurt === true
      if (kept.hurt !== hurt) {
        kept.hurt = hurt
        this.tint(object, hurt)
      }
      kept.name.set(player.name, player.local ? '#f0b04a' : '#f0e6d2')
      kept.name.fit(pxPerTile)
      kept.name.sprite.position.set(player.x, 1.25, player.y)
    }
    for (const [id, kept] of this.keptPlayers) {
      if (seen.has(id)) continue
      this.players.remove(kept.object)
      this.labels.remove(kept.name.sprite)
      kept.name.dispose()
      this.keptPlayers.delete(id)
    }
  }

  private tint(object: THREE.Object3D, hurt: boolean): void {
    object.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return
      const base = (part.userData.material as THREE.Material | undefined) ?? (part.material as THREE.Material)
      part.material = hurt ? hurtMaterial(base) : base
    })
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
      ;(key === 'bow' ? left : right)?.add(model)
      return
    }
    const picture = new THREE.Sprite(itemMaterial(item))
    picture.name = 'held'
    picture.scale.set(0.3, 0.3, 0.3)
    picture.position.set(0.05, -0.08, 0)
    right?.add(picture)
  }

  // Poses the arms for what the player is doing (see PlayerPose): at rest they swing as it walks (`stride`), held a
  // little forward with something in hand; attacking, they follow the attack's path.
  private pose(object: THREE.Object3D, player: PlayerView, stride: number, now: number): void {
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
    const carrying = (player.held ?? 0) !== 0
    left.rotation.z = stride
    right.rotation.z = carrying ? 0.45 - stride * 0.3 : -stride
    const string = leftHand.getObjectByName('bow-string') as THREE.Line | undefined
    let draw = 0
    const pose = player.pose
    const ease = (t: number): number => t * t * (3 - 2 * t)
    if (pose) {
      switch (pose.kind) {
        case 'swing': {
          // From the right round to the left, arm out level, the weapon following through.
          const t = ease(Math.min(1, pose.progress / 0.75))
          const half = Math.min(pose.arc, Math.PI * 1.6) / 2
          right.rotation.z = Math.PI / 2 - 0.1
          rightArm.rotation.y = -(half - 2 * half * t)
          break
        }
        case 'thrust': {
          const out = Math.sin(Math.min(1, pose.progress / 0.8) * Math.PI)
          right.rotation.z = Math.PI / 2
          rightArm.position.x = 0.3 * out
          break
        }
        case 'strike': {
          // Up overhead, then down hard in front.
          const t = ease(Math.min(1, pose.progress / 0.55))
          right.rotation.z = Math.PI - 0.25 - (Math.PI / 2 + 0.15) * t
          break
        }
        case 'windup': {
          if (pose.style === 'strike') right.rotation.z = Math.PI - 0.3 - 0.15 * pose.charge
          else if (pose.style === 'swing') {
            right.rotation.z = Math.PI / 2 - 0.1
            rightArm.rotation.y = -(Math.min(pose.arc, Math.PI * 1.6) / 2 + 0.3 * pose.charge)
          } else {
            right.rotation.z = Math.PI / 2
            rightArm.position.x = -0.15 * pose.charge
          }
          break
        }
        case 'draw':
          // The bow out in the left hand; the right pulls the string back.
          left.rotation.z = Math.PI / 2
          right.rotation.z = Math.PI / 2
          rightArm.position.x = -0.2 * pose.charge
          rightArm.rotation.y = 0.35
          draw = pose.charge
          break
        case 'whirl':
          // Up over the head, the sling going round, faster as it charges.
          right.rotation.z = Math.PI - 0.15
          rightHand.rotation.y = (now / 1000) * (9 + 14 * pose.charge)
          break
        case 'aimThrow':
          // Raised and drawn back, the spear level and pointing ahead.
          right.rotation.z = Math.PI - 0.5 - 0.3 * pose.charge
          rightArm.position.x = -0.18 * pose.charge
          rightHand.rotation.z = Math.PI / 2 - right.rotation.z
          break
        case 'release': {
          // The arm whips forward; a thrown spear has left the hand.
          right.rotation.z = Math.PI / 2 + 0.3 * (1 - pose.progress)
          if (player.held && getItem(player.held as ItemId).key === 'bow') left.rotation.z = Math.PI / 2
          if (pose.thrown && held) held.visible = false
          break
        }
      }
    }
    // The bow's string, drawn back as far as it is pulled.
    if (string) {
      const points = string.geometry.getAttribute('position') as THREE.BufferAttribute
      points.setXYZ(1, 0, 0.3 * draw, 0)
      points.needsUpdate = true
    }
  }

  // The swishes in the air behind swinging weapons: pale, see-through ribbons at the height a weapon swings, tracing
  // what each attack covers as it goes, the tail fading behind the weapon's edge.
  private updateSwishes(frame: WorldFrame): void {
    const swishes = frame.attacks.swishes
    swishes.forEach((swish, i) => {
      let mesh = this.swishMeshes[i]
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BufferGeometry(),
          new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
        )
        mesh.renderOrder = 7
        mesh.frustumCulled = false
        this.swishMeshes.push(mesh)
        this.effects.add(mesh)
      }
      mesh.visible = true
      const { positions, colors } = swishGeometry(swish)
      mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
      mesh.geometry.computeBoundingSphere()
    })
    for (let i = swishes.length; i < this.swishMeshes.length; i++) this.swishMeshes[i].visible = false
  }

  // ---- items on the ground and in flight

  private updateDrops(frame: WorldFrame): void {
    const seen = new Set<number>()
    const matrix = new THREE.Matrix4()
    let shadows = 0
    for (const drop of frame.drops) {
      seen.add(drop.id)
      let sprite = this.keptDrops.get(drop.id)
      if (!sprite) {
        sprite = new THREE.Sprite(itemMaterial(drop.item))
        this.keptDrops.set(drop.id, sprite)
        this.drops.add(sprite)
      }
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
    for (const [id, sprite] of this.keptDrops) {
      if (seen.has(id)) continue
      this.drops.remove(sprite)
      this.keptDrops.delete(id)
    }
    this.dropShadows.count = shadows
    this.dropShadows.instanceMatrix.needsUpdate = true
  }

  private updateShots(frame: WorldFrame): void {
    const seen = new Set<number>()
    for (const shot of frame.attacks.shots) {
      seen.add(shot.id)
      let kept = this.keptShots.get(shot.id)
      if (!kept) {
        const kind = projectileKind(shot.item)
        // A sling stone is small enough to be drawn as its icon; arrows and spears are models, to point the way they fly.
        const object = kind === 'stone' ? new THREE.Sprite(itemMaterial(shot.item)) : models.projectile(kind)
        if (kind === 'stone') object.scale.set(0.3, 0.3, 1)
        kept = { object, key: kind }
        this.keptShots.set(shot.id, kept)
        this.shots.add(kept.object)
      }
      // An icicle falls from high above, faster and faster; anything else flies at about head height.
      const height = shot.fall !== undefined ? 4.5 * (1 - shot.fall * shot.fall) : 0.7
      kept.object.position.set(shot.x, height, shot.y)
      kept.object.rotation.y = -shot.angle
    }
    for (const [id, kept] of this.keptShots) {
      if (seen.has(id)) continue
      this.shots.remove(kept.object)
      this.keptShots.delete(id)
    }
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
    frame.overlay.bars.forEach((bar, i) => {
      let made = this.bars[i]
      if (!made) {
        const plane = new THREE.PlaneGeometry(1, 1)
        const back = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: BAR_BACK, transparent: true, opacity: 0.85, depthTest: false }))
        // Both see-through, so they are drawn in their renderOrder (the backing first): an opaque fill would be drawn before it, and covered.
        const fill = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: BAR_FILL, transparent: true, depthTest: false }))
        back.renderOrder = 18
        fill.renderOrder = 19
        made = { back, fill }
        this.bars.push(made)
        this.effects.add(back, fill)
      }
      const fraction = Math.max(0, Math.min(1, bar.fraction))
      const middle = new THREE.Vector3(bar.x + 0.5, bar.tall ? 2.5 : 1.1, bar.y + 0.5)
      made.back.visible = made.fill.visible = true
      made.back.quaternion.copy(camera.quaternion)
      made.fill.quaternion.copy(camera.quaternion)
      made.back.position.copy(middle)
      made.back.scale.set(barWidth + 2 / pxPerTile, barHeight + 2 / pxPerTile, 1)
      made.fill.position.copy(middle).addScaledVector(right, (-(1 - fraction) * barWidth) / 2)
      made.fill.scale.set(Math.max(0.0001, barWidth * fraction), barHeight, 1)
    })
    for (let i = frame.overlay.bars.length; i < this.bars.length; i++) this.bars[i].back.visible = this.bars[i].fill.visible = false

    // Sparks: rings that grow and fade where something was hit, facing the screen.
    frame.attacks.sparks.forEach((spark, i) => {
      let mesh = this.sparkMeshes[i]
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 20), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }))
        mesh.renderOrder = 17
        this.sparkMeshes.push(mesh)
        this.effects.add(mesh)
      }
      const material = mesh.material as THREE.MeshBasicMaterial
      material.color.setHex(spark.color)
      material.opacity = 1 - spark.age
      mesh.visible = true
      mesh.quaternion.copy(camera.quaternion)
      mesh.position.set(spark.x, 0.5, spark.y)
      mesh.scale.setScalar(0.12 + 0.3 * spark.age)
    })
    for (let i = frame.attacks.sparks.length; i < this.sparkMeshes.length; i++) this.sparkMeshes[i].visible = false

    // Damage numbers rise off what was hurt and fade.
    frame.attacks.numbers.forEach((number, i) => {
      let label = this.numberLabels[i]
      if (!label) {
        label = new Label({ color: '#ffd27a', size: 18, bold: true })
        this.numberLabels.push(label)
        this.labels.add(label.sprite)
      }
      label.sprite.visible = true
      label.set(number.text)
      label.fit(pxPerTile)
      label.sprite.material.opacity = 1 - number.age
      label.sprite.position.set(number.x, 1, number.y).addScaledVector(up, number.age * 0.8)
    })
    for (let i = frame.attacks.numbers.length; i < this.numberLabels.length; i++) this.numberLabels[i].sprite.visible = false
  }

  dispose(): void {
    for (const kept of this.keptPlayers.values()) kept.name.dispose()
    for (const label of this.numberLabels) label.dispose()
  }
}

// ---- which model

// What a building's model depends on: when this changes, the model is made again.
function buildingKey(building: BuildingView): string {
  switch (building.kind) {
    case 'sapling':
      return `sapling${Math.min(building.stage ?? 0, SAPLING_STAGES)}`
    case 'sprout':
      return `sprout${Math.min(building.stage ?? 0, SPROUT_STAGES)}`
    case 'fence':
      return `fence${building.connect ?? 0}`
    case 'gate':
      return `gate${gateRunsAcross(building.connect ?? 0)}${building.open ?? false}`
    case 'campfire':
      return `campfire${building.lit ?? false}`
    case 'plot':
      // The water in steps of a fifth, so the model is not made again every time it dries a little.
      return `plot${building.cropArt ?? ''}|${Math.round((building.water ?? 0) / 20)}`
    case 'barrel': {
      const barrel = building.barrel
      return barrel ? `barrel${barrel.sealed}|${barrel.liquid}|${Math.round(barrel.fill * 8)}|${barrel.composting}` : 'barrel'
    }
    case 'rack':
      return `rack${building.rack ?? 'empty'}`
    case 'loose':
      return `loose${building.item ?? 0}`
    case 'stump':
      return `stump${building.tool ?? ''}`
    default:
      return building.kind
  }
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
      return models.sapling(Math.min(building.stage ?? 0, SAPLING_STAGES) / SAPLING_STAGES)
    case 'sprout':
      return models.sprout(Math.min(building.stage ?? 0, SPROUT_STAGES) / SPROUT_STAGES)
    case 'fence':
      return models.fence(building.connect ?? 0)
    case 'gate':
      return models.gate(gateRunsAcross(building.connect ?? 0), building.open ?? false)
    case 'stump':
      return models.stump(building.tool === undefined ? undefined : getItem(building.tool).key)
    case 'workbench':
      return models.workbench()
    case 'campfire':
      return models.campfire(building.lit ?? false)
    case 'barrel': {
      const barrel = building.barrel
      return barrel ? models.barrel(barrel.sealed, barrel.liquid, barrel.fill, barrel.composting) : models.barrel()
    }
    case 'rack':
      return models.rack(building.rack)
    case 'feeder':
      return models.feeder()
    case 'chest':
      return models.chest()
    case 'bed':
      return models.sleepingBag()
    case 'door':
      return models.iceDoor()
    case 'plot': {
      const made = models.plot(Math.round((building.water ?? 0) / 20) * 20)
      const stage = building.cropArt?.split('/')[2]
      const growth = Number(building.cropArt?.split('/')[3])
      if (stage && Number.isFinite(growth)) made.add(models.crop(growth, building.x, building.y))
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

function animalModel(kind: string, male: boolean): THREE.Group {
  if (kind === 'cow') return models.cow(male)
  if (kind === 'chicken') return models.chicken(male)
  if (kind === 'deer') return models.deer(male)
  if (kind === 'wolf') return models.wolf(male)
  if (kind === 'skeleton') return models.skeleton()
  if (kind === 'skeleton-archer') return models.skeletonArcher()
  if (kind === 'frost-lich') return models.frostLich()
  return models.machine(0xb0a080)
}

function projectileKind(item: number): 'arrow' | 'spear' | 'stone' | 'shard' | 'icicle' {
  const key = getItem(item as ItemId).key
  if (key === 'ice-shard') return 'shard'
  if (key === 'icicle') return 'icicle'
  if (key === 'arrow') return 'arrow'
  if (key.endsWith('spear')) return 'spear'
  return 'stone'
}

// ---- materials made from others

const hurtMaterials = new Map<THREE.Material, THREE.Material>()
// A material lit up red, for an animal that has just been hurt.
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
  const key = `${color}|${valid}|${opacity}|${side}`
  let made = ghostMaterials.get(key)
  if (!made) {
    const tint = new THREE.Color(color)
    if (!valid) tint.lerp(new THREE.Color(INVALID), 0.7)
    made = new THREE.MeshStandardMaterial({ color: tint, transparent: true, opacity, depthWrite: false, flatShading: true, side })
    ghostMaterials.set(key, made)
  }
  return made
}

const itemMaterials = new Map<number, THREE.SpriteMaterial>()
const loader = new THREE.TextureLoader()
// An item's picture (its icon under res/, or its placeholder), for showing it lying on the ground.
function itemMaterial(item: number): THREE.SpriteMaterial {
  let made = itemMaterials.get(item)
  if (!made) {
    const texture = loader.load(artUrl(itemArt(item as ItemId)))
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.NearestFilter
    made = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.1 })
    itemMaterials.set(item, made)
  }
  return made
}

// The smallest turn from one angle to another, between -π and π.
function shortestTurn(from: number, to: number): number {
  const turn = (to - from) % (Math.PI * 2)
  return turn > Math.PI ? turn - Math.PI * 2 : turn < -Math.PI ? turn + Math.PI * 2 : turn
}

// The height (tiles) a swish is drawn at: about where a weapon swings.
const SWISH_HEIGHT = 0.55

// A swish's ribbon as triangles (positions, and colours with alpha), in the world: the swept part of a swing's arc
// (brightest at the leading edge, fading back along it), a thrust's streak growing out, or a strike's ring spreading.
function swishGeometry(swish: Swish): { positions: number[]; colors: number[] } {
  const positions: number[] = []
  const colors: number[] = []
  const fade = Math.max(0, 1 - swish.progress)
  const at = (angle: number, distance: number): [number, number, number] => [
    swish.x + Math.cos(angle) * distance,
    SWISH_HEIGHT,
    swish.y + Math.sin(angle) * distance,
  ]
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], alphas: [number, number, number]): void => {
    ;[a, b, c].forEach((point, i) => {
      positions.push(...point)
      colors.push(1, 1, 1, alphas[i])
    })
  }
  if (swish.shape === 'arc') {
    // How far round the sweep has come (eased as the arm is), and a tail behind it.
    const sweep = Math.min(1, swish.progress / 0.75)
    const eased = sweep * sweep * (3 - 2 * sweep)
    const start = swish.angle + swish.arc / 2
    const edge = start - swish.arc * eased
    const steps = 16
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
    // A streak straight out, as long as the thrust has reached.
    const reach = swish.outer * Math.min(1, swish.progress / 0.5)
    const side = swish.angle + Math.PI / 2
    const half = Math.max(0.08, swish.width / 2)
    const point = (along: number, across: number): [number, number, number] => [
      swish.x + Math.cos(swish.angle) * along + Math.cos(side) * across,
      SWISH_HEIGHT,
      swish.y + Math.sin(swish.angle) * along + Math.sin(side) * across,
    ]
    const a = 0.6 * fade
    tri(point(0, -half), point(reach, -half), point(reach, half), [0.05, a, a])
    tri(point(0, -half), point(reach, half), point(0, half), [0.05, a, 0.05])
  } else {
    // A ring at the spot, spreading out to the strike's reach as it lands.
    const middle = { x: swish.x + Math.cos(swish.angle) * swish.distance, y: swish.y + Math.sin(swish.angle) * swish.distance }
    const grow = Math.min(1, swish.progress / 0.6)
    const outer = swish.outer * (0.4 + 0.6 * grow)
    const inner = outer * 0.6
    const steps = 24
    const ring = (angle: number, r: number): [number, number, number] => [middle.x + Math.cos(angle) * r, 0.08, middle.y + Math.sin(angle) * r]
    const a = 0.65 * fade * (swish.progress > 0.3 ? 1 : swish.progress / 0.3)
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * Math.PI * 2
      const a1 = ((i + 1) / steps) * Math.PI * 2
      tri(ring(a0, inner), ring(a0, outer), ring(a1, outer), [0, a, a])
      tri(ring(a0, inner), ring(a1, outer), ring(a1, inner), [0, a, 0])
    }
  }
  return { positions, colors }
}
