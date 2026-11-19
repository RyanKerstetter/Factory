import * as THREE from 'three'
import { CHUNK_SIZE, chunkCoords, gateRunsAcross, getItem, SAPLING_STAGES, SPROUT_STAGES, type ItemId } from '../../../../packages/shared/src/index.ts'
import type { TileBounds } from '../camera.ts'
import { artUrl } from '../render/art.ts'
import { itemArt } from '../render/art-catalog.ts'
import type { GameView } from '../render/game-view.ts'
import type { AnimalView, BuildingView, GhostView, OverlayView, PlayerView, WorldFrame } from '../render/world-renderer.ts'
import { Ground } from './ground.ts'
import * as models from './models.ts'
import { GroundPaint, Label } from './paint.ts'

// How many screen pixels a tile is across at a zoom of 1.
const PX_PER_TILE = 56
// Where the camera is from what it looks at: straight south and above, so the world's grid runs square with the
// screen (north is up). Make the middle number bigger to look down more steeply, smaller for a lower angle.
const CAMERA_FROM = new THREE.Vector3(0, 1.4, 1).normalize()
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
const ANIMAL_MODEL_SIZE: Readonly<Record<string, number>> = { cow: 1, chicken: 0.55 }
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
      camera.position.copy(target).addScaledVector(CAMERA_FROM, CAMERA_DISTANCE)
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
  private readonly keptPlayers = new Map<number, Kept & { name: Label; angle: number; last: { x: number; y: number }; walk: number; stride: number }>()
  private readonly keptDrops = new Map<number, THREE.Sprite>()
  private readonly keptShots = new Map<number, Kept>()
  private readonly keptGhosts: Kept[] = []
  private readonly numberLabels: Label[] = []
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
    scene.add(this.effects, this.labels, this.hoverRing, this.ropes)
  }

  update(frame: WorldFrame, bounds: TileBounds, camera: THREE.OrthographicCamera, pxPerTile: number): void {
    this.ground.update(frame.seed, bounds)
    this.updateBuildings(frame)
    this.updateAnimals(frame.animals, frame.now)
    this.updatePlayers(frame.players, pxPerTile)
    this.updateDrops(frame)
    this.updateShots(frame)
    this.updateGhosts(frame.overlay)
    this.paint.clear()
    this.paintOverlay(frame.overlay, pxPerTile)
    this.paintAttacks(frame, pxPerTile)
    if (frame.debug) this.paintDebug(frame, pxPerTile)
    this.paint.finish()
    this.updateEffects(frame, camera, pxPerTile)
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

  private updateAnimals(animals: readonly AnimalView[], now: number): void {
    const seen = new Set<number>()
    let hovered: AnimalView | undefined
    let ropes = 0
    const rope = this.ropes.geometry.getAttribute('position') as THREE.BufferAttribute
    for (const animal of animals) {
      seen.add(animal.id)
      let kept = this.keptAnimals.get(animal.id)
      const key = `${animal.kind}`
      if (!kept || kept.key !== key) {
        if (kept) this.animals.remove(kept.object)
        const object = animalModel(animal.kind)
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
      const scale = (animal.size / (ANIMAL_MODEL_SIZE[animal.kind] ?? 1)) * (animal.baby ? BABY_SCALE : 1)
      object.scale.setScalar(scale)
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

  private updatePlayers(players: readonly PlayerView[], pxPerTile: number): void {
    const seen = new Set<number>()
    for (const player of players) {
      seen.add(player.id)
      let kept = this.keptPlayers.get(player.id)
      if (!kept) {
        const object = models.caveman()
        const name = new Label({ color: '#f0e6d2', size: 14, bold: true })
        this.labels.add(name.sprite)
        kept = { object, key: 'caveman', name, angle: player.facing, last: { x: player.x, y: player.y }, walk: 0, stride: 0 }
        this.keptPlayers.set(player.id, kept)
        this.players.add(object)
      }
      const moved = Math.hypot(player.x - kept.last.x, player.y - kept.last.y)
      kept.last = { x: player.x, y: player.y }
      kept.walk += moved * STRIDE_PER_TILE
      kept.stride += ((moved > 0.001 ? 1 : 0) - kept.stride) * STRIDE_EASE
      kept.angle += shortestTurn(kept.angle, player.facing) * TURN_RATE
      const object = kept.object
      object.position.set(player.x, Math.abs(Math.sin(kept.walk)) * 0.03 * kept.stride, player.y)
      object.rotation.y = -kept.angle
      // Arms swing as it walks; the right one jabs straight forward as it attacks.
      const left = object.getObjectByName('arm-left')
      const right = object.getObjectByName('arm-right')
      const stride = Math.sin(kept.walk) * ARM_SWING * kept.stride
      if (left) left.rotation.z = stride
      if (right) right.rotation.z = player.swing !== undefined ? Math.sin(player.swing * Math.PI) * 1.6 : -stride
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
      kept.object.position.set(shot.x, 0.7, shot.y)
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
    case 'plot': {
      const made = models.plot(Math.round((building.water ?? 0) / 20) * 20)
      const stage = building.cropArt?.split('/')[2]
      if (stage === 'sprout' || stage === 'mid' || stage === 'full') made.add(models.crop(stage))
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

function animalModel(kind: string): THREE.Group {
  if (kind === 'cow') return models.cow()
  if (kind === 'chicken') return models.chicken()
  return models.machine(0xb0a080)
}

function projectileKind(item: number): 'arrow' | 'spear' | 'stone' {
  const key = getItem(item as ItemId).key
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
  const key = `${color}|${valid}|${opacity}`
  let made = ghostMaterials.get(key)
  if (!made) {
    const tint = new THREE.Color(color)
    if (!valid) tint.lerp(new THREE.Color(INVALID), 0.7)
    made = new THREE.MeshStandardMaterial({ color: tint, transparent: true, opacity, depthWrite: false, flatShading: true })
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
