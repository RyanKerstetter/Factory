import * as THREE from 'three'
import { CHUNK_SIZE, chunkId, isFoggedAt, type Terrain } from '../../../../packages/shared/src/index.ts'

// How far inside the far islands' fog each tile is (see fog.ts), for the fog and for the sea under it (see
// ground-colors.ts), so the two agree.

// How far out over the sea the fog stands from an island's coast, and how far its edge takes to thicken (tiles).
export const FOG_REACH = 9
export const FOG_RAMP = 2.5
// How far outside the fog the depth goes (it is never less than -FOG_BELOW).
export const FOG_BELOW = 2
// A chunk's depths are for the middles of its tiles and of the tiles DEPTH_BORDER round it (the fog looks a few tiles
// past its chunk: see fog.ts), DEPTH_SIDE a side.
export const DEPTH_BORDER = 6
export const DEPTH_SIDE = CHUNK_SIZE + 2 * DEPTH_BORDER

// The chunks worked out last (both the fog and the ground ask for each, at about the same time).
const KEPT = 64
const kept = new Map<number, Float32Array | null>()
let keptFor: Terrain | undefined

// How far inside the fog the middle of each tile of a chunk, and of the tiles DEPTH_BORDER round it, is (tiles:
// FOG_REACH on fogged land, 0 at the fog's edge, less outside it, down to -FOG_BELOW), DEPTH_SIDE a row, rows from the
// north, the chunk's top left tile at [DEPTH_BORDER, DEPTH_BORDER]; or undefined if the fog does not come near it.
export function fogDepth(terrain: Terrain, cx: number, cy: number): Float32Array | undefined {
  if (terrain !== keptFor) {
    kept.clear()
    keptFor = terrain
  }
  const id = chunkId(cx, cy)
  let depth = kept.get(id)
  if (depth === undefined) {
    depth = workOut(terrain, cx, cy)
    if (kept.size >= KEPT) kept.delete(kept.keys().next().value!)
  } else kept.delete(id)
  kept.set(id, depth)
  return depth ?? undefined
}

// How the depths are kept in a chunk's picture of them (see fogDepthTexture): a byte each, from -FOG_BELOW to
// DEPTH_SPAN - FOG_BELOW.
const DEPTH_SPAN = 8

// A chunk's depths as a picture for the graphics card, a pixel a tile, rows from the north as in `fogDepth`, smoothed
// between the pixels: the fog's (see fog.ts) and the sea's under it (see ground.ts). As it has the tiles DEPTH_BORDER
// round the chunk too, at its edge it blends into the next chunk's, with no seam.
export function fogDepthTexture(depth: Float32Array): THREE.DataTexture {
  const pixels = new Uint8Array(DEPTH_SIDE * DEPTH_SIDE * 4)
  for (let i = 0; i < depth.length; i++) {
    pixels[i * 4] = Math.round(Math.max(0, Math.min(1, (depth[i] + FOG_BELOW) / DEPTH_SPAN)) * 255)
    pixels[i * 4 + 3] = 255
  }
  const texture = new THREE.DataTexture(pixels, DEPTH_SIDE, DEPTH_SIDE, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

// The depth at a point (`at`: tiles from the chunk's top left corner, east and south) from a fogDepthTexture, in GLSL.
export const FOG_DEPTH_GLSL = `
  float fogDepthIn(sampler2D depths, vec2 at) {
    return texture2D(depths, (at + ${DEPTH_BORDER.toFixed(1)}) / ${DEPTH_SIDE.toFixed(1)}).r * ${DEPTH_SPAN.toFixed(1)} - ${FOG_BELOW.toFixed(1)};
  }
`

// The depth at a point of a chunk (tiles from its top left corner), blended between the tiles' middles: as the graphics
// card blends the picture of it.
export function fogDepthAt(depth: Float32Array, x: number, y: number): number {
  const gx = Math.min(DEPTH_SIDE - 1.001, Math.max(0, x + DEPTH_BORDER - 0.5))
  const gy = Math.min(DEPTH_SIDE - 1.001, Math.max(0, y + DEPTH_BORDER - 0.5))
  const ix = Math.floor(gx)
  const iy = Math.floor(gy)
  const fx = gx - ix
  const fy = gy - iy
  const at = iy * DEPTH_SIDE + ix
  const top = depth[at] + (depth[at + 1] - depth[at]) * fx
  const bottom = depth[at + DEPTH_SIDE] + (depth[at + DEPTH_SIDE + 1] - depth[at + DEPTH_SIDE]) * fx
  return top + (bottom - top) * fy
}

function workOut(terrain: Terrain, cx: number, cy: number): Float32Array | null {
  // Tiles further than this from the chunk's own cannot reach into it.
  const margin = FOG_REACH + FOG_BELOW + DEPTH_BORDER + 1
  const near = terrain.sites.some((site) => {
    if (!site.biome.fogged) return false
    const reach = site.radius + site.bump + margin + CHUNK_SIZE
    return Math.abs(cx * CHUNK_SIZE + CHUNK_SIZE / 2 - site.x) <= reach && Math.abs(cy * CHUNK_SIZE + CHUNK_SIZE / 2 - site.y) <= reach
  })
  if (!near) return null
  const left = cx * CHUNK_SIZE - margin
  const top = cy * CHUNK_SIZE - margin
  const span = CHUNK_SIZE + margin * 2
  const fogged = new Uint8Array(span * span)
  let any = false
  for (let y = 0; y < span; y++) {
    for (let x = 0; x < span; x++) {
      const on = isFoggedAt(terrain, left + x, top + y)
      fogged[y * span + x] = on ? 1 : 0
      any ||= on
    }
  }
  if (!any) return null
  const distance = distanceTo(fogged, span)
  const depth = new Float32Array(DEPTH_SIDE * DEPTH_SIDE)
  let reaches = false
  const skip = margin - DEPTH_BORDER
  for (let y = 0; y < DEPTH_SIDE; y++) {
    for (let x = 0; x < DEPTH_SIDE; x++) {
      const inside = Math.max(-FOG_BELOW, FOG_REACH - distance[(y + skip) * span + (x + skip)])
      depth[y * DEPTH_SIDE + x] = inside
      reaches ||= inside > -FOG_BELOW
    }
  }
  return reaches ? depth : null
}

// How far each cell of a square grid (`span` a side) is from the nearest cell marked in `marked`, in cells: one step
// along a row or column counting 1 and one across a corner 1.4 (near enough to the true distance for fog), worked out
// in two sweeps of the grid.
function distanceTo(marked: Uint8Array, span: number): Float32Array {
  const far = span * 2
  const distance = new Float32Array(span * span)
  for (let i = 0; i < distance.length; i++) distance[i] = marked[i] ? 0 : far
  const DIAGONAL = 1.4
  for (let y = 0; y < span; y++) {
    for (let x = 0; x < span; x++) {
      const i = y * span + x
      let d = distance[i]
      if (x > 0) d = Math.min(d, distance[i - 1] + 1)
      if (y > 0) {
        d = Math.min(d, distance[i - span] + 1)
        if (x > 0) d = Math.min(d, distance[i - span - 1] + DIAGONAL)
        if (x < span - 1) d = Math.min(d, distance[i - span + 1] + DIAGONAL)
      }
      distance[i] = d
    }
  }
  for (let y = span - 1; y >= 0; y--) {
    for (let x = span - 1; x >= 0; x--) {
      const i = y * span + x
      let d = distance[i]
      if (x < span - 1) d = Math.min(d, distance[i + 1] + 1)
      if (y < span - 1) {
        d = Math.min(d, distance[i + span] + 1)
        if (x < span - 1) d = Math.min(d, distance[i + span + 1] + DIAGONAL)
        if (x > 0) d = Math.min(d, distance[i + span - 1] + DIAGONAL)
      }
      distance[i] = d
    }
  }
  return distance
}
