import * as THREE from 'three'
import { ALTAR_REACH } from '../../../../packages/shared/src/index.ts'
import { drawnAt, LIQUID_END, offeringWindows } from '../ritual-timeline.ts'
import type { RitualView } from './frame.ts'
import { FLOATING_SIZE, floatingAt, itemPlaneMaterial } from './item-pictures.ts'
import { ALTAR_BOWL, ALTAR_HOLD_Y, BARREL_TOP, PEDESTAL_HOLD_Y } from './models.ts'
import { Pool, showObject } from './reuse.ts'

// An altar's ritual, drawn (see ritual-timeline.ts for when each part comes):
// - a faint ring on the ground round the reach the altar draws from, while it goes on;
// - each pedestal's item in turn, still floating over its pedestal until its turn (the server has already taken it), then
//   a white beam from it to the altar, sparks running along it, the item lifted and drawn along the beam, and held
//   circling over the altar, spinning;
// - each barrel's liquid in turn: a stream of it drawn up out of the barrel and through the air to the altar's basin,
//   dark and glossy like the liquid itself (not a beam of light), drops running down it, a faint dark-red haze round
//   it, and the basin filling (the barrel drains as it goes: see game.ts);
// - the ending: the items close in faster and faster, the blood rising out of the basin in a column into them, a white
//   core swelling between them;
// - and afterwards (the altar's glow), a burst: a flash, a shockwave over the ground, sparks thrown out and a pillar of
//   light, fading, with what the ritual made floating over the altar.

const WHITE = 0xfff4dc
const RED = 0xd01828
const BLOOD_SPARK = 0xff3040
const GOLD = 0xffd27a
// The blood drawn from the barrels: a lit, glossy liquid, and a faint haze of light round it.
const BLOOD = 0x6e0a16
const BLOOD_DROP = 0x8a1020
const BLOOD_HAZE = 0x4a0610

// Something that glows: added on, not lit, drawn after the solid world, not hiding what is behind it.
function glowMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
}

const BEAM = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)
const SPARK = new THREE.IcosahedronGeometry(1, 1)
const RING = new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2)
const BOWL = new THREE.CylinderGeometry(1, 1, 1, 16)
const UP = new THREE.Vector3(0, 1, 0)

type Glow = { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }
type Liquid = { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial }

export class RitualEffects {
  readonly group = new THREE.Group()
  private readonly items: Pool<THREE.Mesh>
  private readonly beams: Pool<Glow>
  private readonly sparks: Pool<Glow>
  private readonly rings: Pool<Glow>
  private readonly bowls: Pool<THREE.Mesh>
  private readonly streams: Pool<Liquid>
  private readonly drops: Pool<Liquid>
  private readonly from = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly along = new THREE.Vector3()

  constructor() {
    const glow = (geometry: THREE.BufferGeometry, order: number) => (): Glow => {
      const material = glowMaterial(WHITE)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = order
      mesh.frustumCulled = false
      this.group.add(mesh)
      return { mesh, material }
    }
    const show = (made: Glow, shown: boolean): void => showObject(made.mesh, shown)
    this.beams = new Pool(glow(BEAM, 8), show)
    this.sparks = new Pool(glow(SPARK, 9), show)
    this.rings = new Pool(glow(RING, 7), show)
    this.items = new Pool<THREE.Mesh>(() => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1))
      mesh.renderOrder = 6
      this.group.add(mesh)
      return mesh
    }, showObject)
    const liquid = (geometry: THREE.BufferGeometry) => (): Liquid => {
      const material = new THREE.MeshStandardMaterial({ color: BLOOD, roughness: 0.2, metalness: 0.1, emissive: 0x1a0004, transparent: true, opacity: 1 })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 6
      mesh.frustumCulled = false
      this.group.add(mesh)
      return { mesh, material }
    }
    const showLiquid = (made: Liquid, shown: boolean): void => showObject(made.mesh, shown)
    this.streams = new Pool(liquid(BEAM), showLiquid)
    this.drops = new Pool(liquid(SPARK), showLiquid)
    this.bowls = new Pool<THREE.Mesh>(() => {
      const mesh = new THREE.Mesh(BOWL, new THREE.MeshStandardMaterial({ color: ALTAR_BOWL.color, roughness: 0.2, metalness: 0.1, emissive: 0x3a0006 }))
      this.group.add(mesh)
      return mesh
    }, showObject)
  }

  update(rituals: readonly RitualView[], now: number): void {
    for (const ritual of rituals) {
      if (ritual.glow > 0) this.burst(ritual)
      else this.ritual(ritual, now)
    }
    this.items.finish()
    this.beams.finish()
    this.sparks.finish()
    this.rings.finish()
    this.bowls.finish()
    this.streams.finish()
    this.drops.finish()
  }

  private ritual(ritual: RitualView, now: number): void {
    const { t } = ritual
    const seconds = now / 1000
    const x = ritual.x + 0.5
    const z = ritual.y + 0.5
    const center = new THREE.Vector3(x, ALTAR_HOLD_Y, z)
    // The ending, 0 to 1.
    const end = Math.min(1, Math.max(0, (t - LIQUID_END) / (1 - LIQUID_END)))
    const easedEnd = end * end

    // The ring round the altar's reach, fading in, breathing.
    this.ring(x, z, ALTAR_REACH + 0.5, WHITE, Math.min(1, t * 12) * (0.25 + 0.1 * Math.sin(seconds * 3)))
    this.ring(x, z, 0.55 + 0.05 * Math.sin(seconds * 5), RED, Math.min(1, t * 12) * 0.5)

    const windows = offeringWindows(ritual.offerings)
    const itemCount = ritual.offerings.filter((offering) => offering.item).length
    let liquidTotal = 0
    let liquidIn = 0
    let held = 0
    ritual.offerings.forEach((offering, i) => {
      const drawn = drawnAt(windows[i], t)
      const sx = x + offering.dx
      const sz = z + offering.dy
      if (offering.liquid) {
        liquidTotal += offering.count
        liquidIn += offering.count * drawn
        if (drawn <= 0 || drawn >= 1) return
        // A stream of blood drawn from the barrel into the basin, thickening as it gets going and thinning to a
        // trickle as the barrel empties, drops running down it, and a faint haze round it.
        this.from.set(sx, BARREL_TOP + 0.05, sz)
        this.to.set(x, ALTAR_BOWL.brim, z)
        const strength = Math.min(1, drawn * 6, (1 - drawn) * 6)
        this.stream(this.from, this.to, (0.022 + 0.005 * Math.sin(seconds * 18)) * strength, BLOOD, 0.95)
        this.beam(this.from, this.to, 0.05 * strength, BLOOD_HAZE, 0.3 * strength)
        for (let j = 0; j < 6; j++) {
          const along = (seconds * 1.4 + j / 6) % 1
          this.drop(this.along.lerpVectors(this.from, this.to, along), 0.03 * strength, BLOOD_DROP)
        }
        return
      }
      // An item: where it circles over the altar, once it is there.
      const k = held++
      const turn = (k / Math.max(1, itemCount)) * Math.PI * 2 + seconds * (1.2 + easedEnd * 9)
      const radius = 0.5 * (1 - easedEnd)
      const orbit = new THREE.Vector3(
        x + Math.cos(turn) * radius,
        ALTAR_HOLD_Y + 0.12 + 0.05 * Math.sin(seconds * 3 + k) + end * 0.2,
        z + Math.sin(turn) * radius,
      )
      const size = FLOATING_SIZE * 0.8 * (1 - 0.65 * easedEnd)
      const spin = now * (0.004 + easedEnd * 0.03) + k
      if (drawn <= 0) {
        // Still on its pedestal, waiting its turn, as the pedestal showed it.
        const float = floatingAt(now, offering.dx * 7 + offering.dy * 13)
        this.item(offering.item, new THREE.Vector3(sx, PEDESTAL_HOLD_Y + float.lift, sz), FLOATING_SIZE, float.turn)
        return
      }
      if (drawn < 1) {
        // The beam from the pedestal, and the item lifted off it and drawn along it to its place over the altar.
        const strength = Math.sin(Math.PI * drawn)
        this.from.set(sx, PEDESTAL_HOLD_Y, sz)
        this.beam(this.from, center, 0.03 + 0.01 * Math.sin(seconds * 30), WHITE, 0.9 * strength)
        for (let j = 0; j < 5; j++) this.spark(this.along.lerpVectors(this.from, center, (seconds * 1.3 + j / 5) % 1), 0.028, GOLD, strength)
        const travel = Math.min(1, Math.max(0, (drawn - 0.2) / 0.8))
        const eased = travel * travel * (3 - 2 * travel)
        const lifted = new THREE.Vector3(sx, PEDESTAL_HOLD_Y + Math.min(drawn, 0.2) * 1.5, sz)
        const at = lifted.lerp(orbit, eased)
        at.y += Math.sin(Math.PI * travel) * 0.4
        this.item(offering.item, at, FLOATING_SIZE * (1 - 0.2 * eased), now * 0.012)
        this.spark(at, 0.08 + 0.02 * Math.sin(seconds * 20), WHITE, 0.5 * strength)
        return
      }
      // Held over the altar, circling, spinning; at the end, each joined to the core by a thread of light.
      this.item(offering.item, orbit, size, spin)
      this.spark(orbit, 0.06, WHITE, 0.35 + 0.4 * end)
      if (end > 0) this.beam(orbit, center.clone().setY(orbit.y), 0.01 + 0.015 * end, WHITE, end)
    })

    // The basin, filling as the blood comes in, and drawn up out of it at the end.
    if (liquidTotal > 0) {
      const level = (liquidIn / liquidTotal) * (1 - easedEnd)
      if (level > 0.01) {
        const y = ALTAR_BOWL.floor + (ALTAR_BOWL.brim - ALTAR_BOWL.floor) * level
        const across = ALTAR_BOWL.radius(y) * 2
        const bowl = this.bowls.next()
        bowl.position.set(x, (ALTAR_BOWL.floor + y) / 2, z)
        bowl.scale.set(across / 2, Math.max(0.002, y - ALTAR_BOWL.floor), across / 2)
        // Rippling as it fills.
        if (level < 1) this.ring(x, z, across * (0.25 + 0.2 * ((seconds * 2) % 1)), BLOOD_SPARK, 0.4, y + 0.004)
      }
      if (end > 0 && end < 1) {
        // The blood rising in a column into the core: the liquid itself, twisting up, with a dark-red haze round it.
        const rise = Math.sin(Math.PI * end)
        this.from.set(x, ALTAR_BOWL.brim, z)
        const top = center.clone().setY(ALTAR_HOLD_Y + 0.15 + end * 0.2)
        this.stream(this.from, top, (0.03 + 0.03 * end) * rise, BLOOD, 0.95)
        this.beam(this.from, top, (0.07 + 0.05 * end) * rise, BLOOD_HAZE, 0.3 * rise)
        for (let j = 0; j < 8; j++) {
          const up = (seconds * 2.2 + j / 8) % 1
          const wobble = 0.06 * Math.sin(seconds * 9 + j)
          this.drop(this.along.set(x + wobble, ALTAR_BOWL.brim + up * (ALTAR_HOLD_Y + 0.3 - ALTAR_BOWL.brim), z - wobble), 0.03 * rise, BLOOD_DROP)
        }
      }
    }

    // The core, swelling and pulsing as the end comes, white-hot at the last.
    if (end > 0) {
      const core = center.clone().setY(ALTAR_HOLD_Y + 0.12 + end * 0.2)
      const pulse = 1 + 0.15 * Math.sin(seconds * (12 + end * 30))
      this.spark(core, (0.04 + easedEnd * 0.32) * pulse, RED, 0.6 * end)
      this.spark(core, (0.03 + easedEnd * 0.22) * pulse, WHITE, 0.4 + 0.6 * end)
      if (end > 0.85) this.spark(core, 0.3 + (end - 0.85) * 4, WHITE, (end - 0.85) / 0.15)
    }
  }

  // After a ritual: the flash, the shockwave, the sparks thrown out and the pillar of light, fading as the glow does.
  private burst(ritual: RitualView): void {
    const g = ritual.glow
    const out = 1 - g
    const x = ritual.x + 0.5
    const z = ritual.y + 0.5
    const center = new THREE.Vector3(x, ALTAR_HOLD_Y + 0.3, z)
    this.spark(center, 0.35 + out * 0.9, WHITE, g * g)
    this.spark(center, 0.2 + out * 0.5, RED, g * g * 0.8)
    this.ring(x, z, 0.4 + out * (ALTAR_REACH + 1.5), WHITE, g)
    this.ring(x, z, 0.3 + out * (ALTAR_REACH + 0.5), RED, g * 0.8)
    this.from.set(x, 0, z)
    this.to.set(x, 6, z)
    this.beam(this.from, this.to, 0.05 + 0.2 * g, WHITE, g * 0.7)
    for (let j = 0; j < 16; j++) {
      const turn = (j / 16) * Math.PI * 2 + ritual.id
      const rise = Math.sin((j * 2.3) % Math.PI) * 0.8
      const reach = out * (1.2 + (j % 3) * 0.4)
      this.spark(this.along.set(x + Math.cos(turn) * reach, center.y + rise * out - out * out * 0.6, z + Math.sin(turn) * reach), 0.05 * g + 0.01, j % 2 ? GOLD : BLOOD_SPARK, g)
    }
  }

  private item(item: number, at: THREE.Vector3, size: number, turn: number): void {
    const mesh = this.items.next()
    mesh.material = itemPlaneMaterial(item)
    mesh.position.copy(at)
    mesh.scale.set(size, size, 1)
    mesh.rotation.set(0, turn, 0)
  }

  // A beam of light from one point to another, `radius` thick.
  private beam(from: THREE.Vector3, to: THREE.Vector3, radius: number, color: number, opacity: number): void {
    if (opacity <= 0.01) return
    const { mesh, material } = this.beams.next()
    const length = from.distanceTo(to)
    mesh.position.lerpVectors(from, to, 0.5)
    mesh.scale.set(radius, Math.max(0.001, length), radius)
    mesh.quaternion.setFromUnitVectors(UP, this.along.subVectors(to, from).normalize())
    material.color.setHex(color)
    material.opacity = Math.min(1, opacity)
  }

  // A stream of liquid from one point to another, `radius` thick: lit like the liquid it is, not glowing.
  private stream(from: THREE.Vector3, to: THREE.Vector3, radius: number, color: number, opacity: number): void {
    if (radius <= 0.002) return
    const { mesh, material } = this.streams.next()
    const length = from.distanceTo(to)
    mesh.position.lerpVectors(from, to, 0.5)
    mesh.scale.set(radius, Math.max(0.001, length), radius)
    mesh.quaternion.setFromUnitVectors(UP, this.along.subVectors(to, from).normalize())
    material.color.setHex(color)
    material.opacity = opacity
  }

  // A drop of liquid.
  private drop(at: THREE.Vector3, radius: number, color: number): void {
    if (radius <= 0.002) return
    const { mesh, material } = this.drops.next()
    mesh.position.copy(at)
    mesh.scale.setScalar(radius)
    material.color.setHex(color)
  }

  private spark(at: THREE.Vector3, radius: number, color: number, opacity: number): void {
    if (opacity <= 0.01) return
    const { mesh, material } = this.sparks.next()
    mesh.position.copy(at)
    mesh.scale.setScalar(radius)
    material.color.setHex(color)
    material.opacity = Math.min(1, opacity)
  }

  // A ring flat over the ground (or at `y`), `radius` out, its band the outer twelfth of that.
  private ring(x: number, z: number, radius: number, color: number, opacity: number, y = 0.03): void {
    if (opacity <= 0.01) return
    const { mesh, material } = this.rings.next()
    mesh.position.set(x, y, z)
    mesh.scale.set(radius, 1, radius)
    material.color.setHex(color)
    material.opacity = Math.min(1, opacity)
  }
}
