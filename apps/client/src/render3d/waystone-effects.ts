import * as THREE from 'three'
import { WARP_LIGHT_LEVELS, warpLightAt } from '../../../../packages/shared/src/index.ts'
import type { WarpFlashView, WarpView } from './frame.ts'
import { WAYSTONE_FACE, WAYSTONE_LIGHTS } from './models.ts'
import { Pool, showObject } from './reuse.ts'

// Travelling by waystone, drawn (see waystones.ts):
// - while it charges, the lights up the stone's face come on a pair at a time from the bottom (each flaring as it
//   does, then glowing), the keystone at the top last; motes of light rise round the player in a tightening spiral, a
//   ring of light closes in on the ground under them, and at the last a column of light swallows them;
// - when they go, a flash and a pillar of light where they stood, and the same where they arrive, with sparks falling
//   round them; the lights of the stone they arrive at glow and fade.

const BLUE = 0x8fd6ff
const PALE = 0xeaf6ff
const DEEP = 0x3a7bd5

function glowMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
}

const SQUARE = new THREE.PlaneGeometry(1, 1)
const SPARK = new THREE.IcosahedronGeometry(1, 1)
const RING = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2)
const COLUMN = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true)

type Glow = { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }

export class WaystoneEffects {
  readonly group = new THREE.Group()
  private readonly lights: Pool<Glow>
  private readonly sparks: Pool<Glow>
  private readonly rings: Pool<Glow>
  private readonly columns: Pool<Glow>
  private readonly at = new THREE.Vector3()

  constructor() {
    const glow = (geometry: THREE.BufferGeometry, order: number) => (): Glow => {
      const material = glowMaterial(BLUE)
      if (geometry === COLUMN) material.side = THREE.DoubleSide
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = order
      mesh.frustumCulled = false
      this.group.add(mesh)
      return { mesh, material }
    }
    const show = (made: Glow, shown: boolean): void => showObject(made.mesh, shown)
    this.lights = new Pool(glow(SQUARE, 9), show)
    this.sparks = new Pool(glow(SPARK, 9), show)
    this.rings = new Pool(glow(RING, 7), show)
    this.columns = new Pool(glow(COLUMN, 8), show)
  }

  update(warps: readonly WarpView[], flashes: readonly WarpFlashView[], now: number): void {
    for (const warp of warps) this.warp(warp, now)
    for (const flash of flashes) this.flash(flash, now)
    this.lights.finish()
    this.sparks.finish()
    this.rings.finish()
    this.columns.finish()
  }

  private warp(warp: WarpView, now: number): void {
    const seconds = now / 1000
    const { t } = warp
    this.stoneLights(warp.x, warp.y, (level) => {
      const since = t - warpLightAt(level)
      if (since < 0) return 0
      // A flare as it comes on, settling to a steady glow that swells as the end nears.
      return Math.min(1, since * 30) * (0.75 + 0.25 * t) + Math.max(0, 1 - since * 8) * 0.8
    }, seconds)
    const player = warp.player
    if (!player) return
    const px = player.x
    const pz = player.y
    // The ring on the ground, closing in on them, brighter as it goes.
    this.ring(px, pz, 1.1 - 0.75 * t, BLUE, 0.25 + 0.6 * t)
    this.ring(px, pz, 0.45 + 0.08 * Math.sin(seconds * 8), PALE, 0.15 + 0.4 * t)
    // Motes rising round them in a tightening spiral, more and faster as it goes.
    const motes = 6 + Math.floor(t * 18)
    for (let i = 0; i < motes; i++) {
      const up = (seconds * (0.5 + t) + i / motes) % 1
      const turn = i * 2.4 + seconds * (2 + t * 6)
      const reach = (0.55 - 0.3 * t) * (1 - up * 0.4)
      this.spark(this.at.set(px + Math.cos(turn) * reach, 0.1 + up * (1.2 + t), pz + Math.sin(turn) * reach), 0.025 + 0.015 * t, i % 3 ? BLUE : PALE, Math.sin(Math.PI * up) * (0.4 + 0.6 * t))
    }
    // At the last, a column of light round them, and a glow over the stone's keystone answering it.
    const last = Math.max(0, (t - 0.75) / 0.25)
    if (last > 0) {
      this.column(px, pz, 0.32 + 0.08 * Math.sin(seconds * 20), 2.6, BLUE, last * 0.45)
      this.column(px, pz, 0.18, 3, PALE, last * last * 0.6)
      this.spark(this.at.set(px, 0.8, pz), 0.2 + last * 0.35, PALE, last * 0.5)
    }
  }

  // A player going from a waystone or arriving at one (`age` 0 to 1 over the flash): a flash where they are, a pillar of
  // light, a shockwave on the ground, sparks (rising as they go, falling round them as they arrive), and the stone's
  // lights glowing and fading.
  private flash(flash: WarpFlashView, now: number): void {
    const seconds = now / 1000
    const fade = 1 - flash.age
    const out = flash.age
    if (flash.stone) this.stoneLights(flash.stone.x, flash.stone.y, () => fade * (flash.arriving ? 1 : 1.4), seconds)
    const { x, y } = flash
    this.spark(this.at.set(x, 0.7, y), 0.3 + out * 0.8, PALE, fade * fade)
    this.spark(this.at.set(x, 0.7, y), 0.2 + out * 0.4, BLUE, fade)
    this.column(x, y, 0.08 + 0.3 * fade, 5, PALE, fade * 0.7)
    this.column(x, y, 0.4 + out * 0.4, 2, BLUE, fade * 0.35)
    this.ring(x, y, 0.3 + out * 2.2, BLUE, fade)
    this.ring(x, y, 0.2 + out * 1.2, PALE, fade * 0.7)
    for (let i = 0; i < 18; i++) {
      const turn = (i / 18) * Math.PI * 2 + flash.salt
      const reach = 0.2 + out * (0.6 + (i % 3) * 0.25)
      const height = flash.arriving ? 2.2 - out * 2 + (i % 4) * 0.2 : 0.3 + out * (1.5 + (i % 4) * 0.4)
      this.spark(this.at.set(x + Math.cos(turn) * reach, Math.max(0.05, height), y + Math.sin(turn) * reach), 0.035 * fade + 0.01, i % 2 ? BLUE : PALE, fade)
    }
  }

  // The lights on a waystone's face, each as bright as `brightness(level)` (0 off, 1 full).
  private stoneLights(tileX: number, tileY: number, brightness: (level: number) => number, seconds: number): void {
    const x = tileX + 0.5
    const z = tileY + 0.5 + WAYSTONE_FACE + 0.012
    for (const light of WAYSTONE_LIGHTS) {
      const on = brightness(light.level)
      if (on <= 0.01) continue
      const keystone = light.level === WARP_LIGHT_LEVELS
      const size = keystone ? 0.08 : 0.06
      const flicker = 1 + 0.08 * Math.sin(seconds * 13 + light.y * 20 + light.x * 9)
      this.light(x + light.x, light.y, z, size, PALE, on * flicker)
      this.light(x + light.x, light.y, z + 0.002, size * 2.6, BLUE, on * 0.45 * flicker)
      this.light(x + light.x, light.y, z + 0.004, size * 5, DEEP, on * 0.25)
    }
  }

  private light(x: number, y: number, z: number, size: number, color: number, opacity: number): void {
    if (opacity <= 0.01) return
    const { mesh, material } = this.lights.next()
    mesh.position.set(x, y, z)
    mesh.scale.set(size, size, 1)
    material.color.setHex(color)
    material.opacity = Math.min(1, opacity)
  }

  private spark(at: THREE.Vector3, radius: number, color: number, opacity: number): void {
    if (opacity <= 0.01) return
    const { mesh, material } = this.sparks.next()
    mesh.position.copy(at)
    mesh.scale.setScalar(radius)
    material.color.setHex(color)
    material.opacity = Math.min(1, opacity)
  }

  private ring(x: number, z: number, radius: number, color: number, opacity: number): void {
    if (opacity <= 0.01 || radius <= 0) return
    const { mesh, material } = this.rings.next()
    mesh.position.set(x, 0.03, z)
    mesh.scale.set(radius, 1, radius)
    material.color.setHex(color)
    material.opacity = Math.min(1, opacity)
  }

  // An open column of light standing on the ground, `radius` round and `height` tall.
  private column(x: number, z: number, radius: number, height: number, color: number, opacity: number): void {
    if (opacity <= 0.01) return
    const { mesh, material } = this.columns.next()
    mesh.position.set(x, height / 2, z)
    mesh.scale.set(radius, height, radius)
    material.color.setHex(color)
    material.opacity = Math.min(1, opacity)
  }
}
