import * as THREE from 'three'
import { CHUNK_SIZE, chunkCoords, chunkId, floorDiv, hashInts, NO_ITEM, oreAt, waterAt } from '../../../../packages/shared/src/index.ts'
import type { TileBounds } from '../camera.ts'

// How far a pond's surface is below the ground, in tiles.
const WATER_DEPTH = 0.14

// Grass, from darker to lighter (in broad patches), a pond's water, its banks, and the ground over an ore deposit.
const GRASS_DARK = new THREE.Color(0x5c8238)
const GRASS_LIGHT = new THREE.Color(0x7a9c44)
const WATER = new THREE.Color(0x3a74b0)
const WATER_DEEP = new THREE.Color(0x2e5f96)
const BANK = new THREE.Color(0x5a4430)
const ORE = new THREE.Color(0x7b7568)

const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide })

// The ground: a mesh for each chunk in view, worked out from the world's seed (see world-gen.ts) as it comes into view
// and let go of well after it leaves. Each tile is a flat square of grass, shaded in soft patches; a pond's tiles are
// sunk a little and blue, with earth banks down to them.
export class Ground {
  readonly view = new THREE.Group()
  private readonly chunks = new Map<number, THREE.Mesh>()
  private seed = Number.NaN

  update(seed: number, bounds: TileBounds): void {
    if (seed !== this.seed) {
      this.seed = seed
      for (const mesh of this.chunks.values()) this.drop(mesh)
      this.chunks.clear()
    }
    const left = floorDiv(bounds.left, CHUNK_SIZE)
    const right = floorDiv(bounds.right, CHUNK_SIZE)
    const top = floorDiv(bounds.top, CHUNK_SIZE)
    const bottom = floorDiv(bounds.bottom, CHUNK_SIZE)
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        const id = chunkId(cx, cy)
        if (!this.chunks.has(id)) {
          const mesh = buildChunk(seed, cx, cy)
          this.chunks.set(id, mesh)
          this.view.add(mesh)
        }
      }
    }
    for (const [id, mesh] of this.chunks) {
      const { cx, cy } = chunkCoords(id)
      if (cx < left - 1 || cx > right + 1 || cy < top - 1 || cy > bottom + 1) {
        this.drop(mesh)
        this.chunks.delete(id)
      }
    }
  }

  private drop(mesh: THREE.Mesh): void {
    this.view.remove(mesh)
    mesh.geometry.dispose()
  }
}

function buildChunk(seed: number, cx: number, cy: number): THREE.Mesh {
  const positions: number[] = []
  const colors: number[] = []
  const quad = (corners: Array<[number, number, number]>, color: THREE.Color): void => {
    const [a, b, c, d] = corners
    for (const corner of [a, b, c, a, c, d]) {
      positions.push(...corner)
      colors.push(color.r, color.g, color.b)
    }
  }
  const isWater = (x: number, y: number): boolean => waterAt(seed, x, y)
  // The grass's shade at a tile corner, shared by the four tiles that meet there, so it changes smoothly across the
  // ground: broad patches (a coarse grid of shades, blended) with a little speckle.
  const shadeAt = (x: number, y: number): THREE.Color => {
    const patch = smoothNoise(seed, x / 7, y / 7)
    const speckle = (hashInts(seed, x, y, 13) % 1000) / 1000
    return new THREE.Color().copy(GRASS_DARK).lerp(GRASS_LIGHT, patch * 0.8 + speckle * 0.2)
  }
  const tileQuad = (x: number, y: number, height: number, colorOf: (x: number, y: number) => THREE.Color): void => {
    const corners: Array<[number, number]> = [
      [x, y],
      [x, y + 1],
      [x + 1, y + 1],
      [x + 1, y],
    ]
    const [a, b, c, d] = corners
    for (const [cx, cy] of [a, b, c, a, c, d]) {
      positions.push(cx, height, cy)
      const shade = colorOf(cx, cy)
      colors.push(shade.r, shade.g, shade.b)
    }
  }
  const color = new THREE.Color()
  for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y++) {
    for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) {
      if (isWater(x, y)) {
        tileQuad(x, y, -WATER_DEPTH, (px, py) => color.copy(WATER).lerp(WATER_DEEP, smoothNoise(seed + 1, px / 3, py / 3)))
        // A bank down to the water on each side that is land.
        if (!isWater(x, y - 1)) quad([[x, 0, y], [x, -WATER_DEPTH, y], [x + 1, -WATER_DEPTH, y], [x + 1, 0, y]], BANK)
        if (!isWater(x, y + 1)) quad([[x + 1, 0, y + 1], [x + 1, -WATER_DEPTH, y + 1], [x, -WATER_DEPTH, y + 1], [x, 0, y + 1]], BANK)
        if (!isWater(x - 1, y)) quad([[x, 0, y + 1], [x, -WATER_DEPTH, y + 1], [x, -WATER_DEPTH, y], [x, 0, y]], BANK)
        if (!isWater(x + 1, y)) quad([[x + 1, 0, y], [x + 1, -WATER_DEPTH, y], [x + 1, -WATER_DEPTH, y + 1], [x + 1, 0, y + 1]], BANK)
        continue
      }
      if (oreAt(seed, x, y) !== NO_ITEM) tileQuad(x, y, 0, () => ORE)
      else tileQuad(x, y, 0, shadeAt)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, groundMaterial)
  mesh.receiveShadow = true
  return mesh
}

// Noise from 0 to 1 that changes smoothly: a shade for each whole point, blended between them.
function smoothNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const at = (px: number, py: number): number => (hashInts(seed, px, py, 29) % 1000) / 1000
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
  return top + (bottom - top) * sy
}
