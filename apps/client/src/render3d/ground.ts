import * as THREE from 'three'
import { CHUNK_SIZE, chunkCoords, chunkId, DUNGEON_TRAPS, dungeonTrapAt, floorDiv, type Terrain } from '../../../../packages/shared/src/index.ts'
import {
  CRYPT_VOID,
  CRYPT_WALL,
  CRYPT_WALL_FACE,
  CRYPT_WALL_FOOT,
  groundChunk,
  PIXELS_PER_TILE_3D,
  SEA_SHELF_COLOR,
  type GroundKind,
} from './ground-colors.ts'
import type { TileBounds } from '../camera.ts'
import { FOG_DEPTH_GLSL, FOG_RAMP, FOG_REACH, fogDepth, fogDepthAt, fogDepthTexture } from './fog-depth.ts'

// How high the ice crypt's walls stand, in tiles; and the colour of the holes spikes come out of.
const WALL_HEIGHT = 0.9
// How far below the ground the water of the sea and the ponds lies, in tiles, and its banks' colours: earth by a pond or
// the forest's sand by the sea, and rock in the mountains (lighter at the top, darker at the water).
export const WATER_DEPTH = 0.14
const BANK_EARTH = [0x7a5a3c, 0x4e3826] as const
const BANK_SAND = [0xc9b682, 0x8f7f55] as const
// A far island's banks under its fog: as pale as the fog (paler than the ground, being in shadow more), so its coast
// does not show through it (see fog.ts).
const BANK_FOG = [0xffffff, 0xf2f6f9] as const
const BANK_ROCK = [0x80858d, 0x575c64] as const
const CRYPT_HOLE = 0x1a222c
// Where on a wall's face the spikes of a trap in it come out (and so where its holes are): how far to the side of the
// face's middle, and how high, in tiles (see the view's updateTraps).
export const WALL_SPIKES: ReadonlyArray<readonly [side: number, height: number]> = [
  [-0.25, 0.3],
  [0.2, 0.55],
  [0, 0.8],
]

const isWater = (tile: GroundKind): boolean => tile.kind === 'sea' || tile.kind === 'pond'

// The sea under the far islands' fog (for a player without truesight): the deep ocean's dark fading into the shelf's
// pale colour as the fog thickens, so the line between them does not show through the fog in steps, and that into a
// paler, misty blue nearer the island (SEA_MIST), so its coast does not show through either. It is done as the sea is
// drawn, from the chunk's fog depths (see fog-depth.ts), so it fades smoothly: in the ground's picture its pixels would
// show.
const SEA_MIST = 0xb4ccd9
const seaShelf = new THREE.Color(SEA_SHELF_COLOR)
const seaMist = new THREE.Color(SEA_MIST)
function seaUnderFog(material: THREE.MeshStandardMaterial, depths: THREE.Texture, left: number, top: number): void {
  material.userData.fogDepths = depths
  // (The same code for every chunk's material, so they share one program, each with its own depths.)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.fogDepths = { value: depths }
    shader.uniforms.fogCorner = { value: new THREE.Vector2(left, top) }
    shader.uniforms.seaShelf = { value: seaShelf }
    shader.uniforms.seaMist = { value: seaMist }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec2 fogCorner;
        varying vec2 vFogAt;
        varying float vSea;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vFogAt = position.xz - fogCorner;
        vSea = step(position.y, ${(-WATER_DEPTH / 2).toFixed(3)});`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D fogDepths;
        uniform vec3 seaShelf;
        uniform vec3 seaMist;
        varying vec2 vFogAt;
        varying float vSea;
        ${FOG_DEPTH_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float inside = fogDepthIn(fogDepths, vFogAt);
          vec3 under = mix(seaShelf, seaMist, smoothstep(${(FOG_REACH - 6).toFixed(1)}, ${(FOG_REACH - 1).toFixed(1)}, inside));
          diffuseColor.rgb = mix(diffuseColor.rgb, under, vSea * smoothstep(-1.0, ${(FOG_RAMP - 1).toFixed(1)}, inside));
        }`,
      )
  }
}

// The surf: waves of white foam rolling in over the sea within SURF_REACH tiles of the land and breaking on it, one
// every SURF_PERIOD seconds (a little sooner or later along the shore), drawn in pixels of the ground's size, on the
// water (WATER_DEPTH down).
const SURF_REACH = 2.6
const SURF_PERIOD = 3.4
const surfUniforms = {
  time: { value: 0 },
  foam: { value: new THREE.Color(0xf4fbff) },
  froth: { value: new THREE.Color(0xc4e2f2) },
}
const surfMaterial = new THREE.ShaderMaterial({
  uniforms: surfUniforms,
  vertexShader: `
    attribute vec4 corners;
    attribute vec2 local;
    varying vec4 vCorners;
    varying vec2 vLocal;
    varying vec2 vWorld;
    void main() {
      vCorners = corners;
      vLocal = local;
      vWorld = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform vec3 foam;
    uniform vec3 froth;
    varying vec4 vCorners;
    varying vec2 vLocal;
    varying vec2 vWorld;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      // One pixel of the ground's picture: its middle, and how far that is from the land (tiles).
      vec2 cell = min(floor(vLocal * ${PIXELS_PER_TILE_3D}.0), ${PIXELS_PER_TILE_3D - 1}.0);
      vec2 f = (cell + 0.5) / ${PIXELS_PER_TILE_3D}.0;
      float d = mix(mix(vCorners.x, vCorners.y, f.x), mix(vCorners.z, vCorners.w, f.x), f.y);
      vec2 p = floor(vWorld * ${PIXELS_PER_TILE_3D}.0);
      float grain = hash(p);
      // Each stretch of shore has its waves a little sooner or later than the next.
      vec2 q = p / ${PIXELS_PER_TILE_3D}.0;
      float along = sin(q.x * 0.41 + q.y * 0.27) * 0.5 + sin(q.x * 0.11 - q.y * 0.47 + 1.7) * 0.5;
      float phase = fract(time / ${SURF_PERIOD.toFixed(2)} + along * 0.22);
      float reach = ${SURF_REACH.toFixed(2)};
      bool white = false;
      bool dense = false;
      if (phase < 0.72) {
        // Rolling in: a band of foam, thin and broken out at sea, thicker and whiter as it nears the land.
        float near = phase / 0.72;
        float front = reach * (1.0 - near);
        float band = 0.18 + 0.4 * near;
        if (d >= front && d <= front + band) {
          float inBand = (d - front) / band;
          white = grain < 0.35 + 0.6 * near - 0.45 * inBand;
          dense = inBand < 0.4 && grain < 0.5 + 0.4 * near;
        }
      } else {
        // Broken on the shore: a wash of froth over the shallows, thinning away.
        float left = 1.0 - (phase - 0.72) / 0.28;
        float wash = 0.35 + 0.5 * left;
        white = d <= wash && grain < left * 0.9 - d * 0.3;
        dense = white && d < wash * 0.5;
      }
      if (!white || d > reach + 0.6) discard;
      gl_FragColor = vec4(dense ? foam : froth, 1.0);
      #include <colorspace_fragment>
    }
  `,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
})

// How long a frame may spend making the ground of chunks coming into view (see Ground.update), in ms.
const BUILD_BUDGET_MS = 4
// The two triangles of a tile's square, as its corners (top left, top right, bottom left, bottom right).
const QUAD = [0, 2, 1, 1, 2, 3] as const

const wallMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: THREE.DoubleSide })

// The ground: a mesh for each chunk in view, worked out from the world's terrain as it comes into view and let go of
// well after it leaves. Each chunk is one sheet, painted with its picture (see ground-colors.ts): the land level, and the
// sea and the ponds a little lower (WATER_DEPTH), set into the ground with a bank down to them. The ice crypt's walls
// stand up from it as blocks.
export class Ground {
  readonly view = new THREE.Group()
  private readonly chunks = new Map<number, THREE.Group>()
  private terrain: Terrain | undefined
  private fogged = false

  // `fogged`: the far islands are under their fog (the player has no truesight), and painted so.
  update(terrain: Terrain | undefined, bounds: TileBounds, fogged = false): void {
    surfUniforms.time.value = (performance.now() / 1000) % 100_000
    if (terrain !== this.terrain || fogged !== this.fogged) {
      this.terrain = terrain
      this.fogged = fogged
      for (const made of this.chunks.values()) this.drop(made)
      this.chunks.clear()
    }
    if (!terrain) return
    const left = floorDiv(bounds.left, CHUNK_SIZE)
    const right = floorDiv(bounds.right, CHUNK_SIZE)
    const top = floorDiv(bounds.top, CHUNK_SIZE)
    const bottom = floorDiv(bounds.bottom, CHUNK_SIZE)
    // New chunks nearest the middle first, for at most BUILD_BUDGET_MS a frame (but always one), so walking into new
    // ground never stalls a frame, however slow the computer. With nothing shown yet, all at once.
    const missing: Array<{ cx: number; cy: number }> = []
    for (let cy = top; cy <= bottom; cy++) for (let cx = left; cx <= right; cx++) if (!this.chunks.has(chunkId(cx, cy))) missing.push({ cx, cy })
    const midX = (left + right) / 2
    const midY = (top + bottom) / 2
    missing.sort((a, b) => Math.hypot(a.cx - midX, a.cy - midY) - Math.hypot(b.cx - midX, b.cy - midY))
    const all = this.chunks.size === 0
    const started = performance.now()
    for (const { cx, cy } of missing) {
      const made = buildChunk(terrain, cx, cy, fogged)
      this.chunks.set(chunkId(cx, cy), made)
      this.view.add(made)
      if (!all && performance.now() - started >= BUILD_BUDGET_MS) break
    }
    for (const [id, made] of this.chunks) {
      const { cx, cy } = chunkCoords(id)
      if (cx < left - 1 || cx > right + 1 || cy < top - 1 || cy > bottom + 1) {
        this.drop(made)
        this.chunks.delete(id)
      }
    }
  }

  private drop(made: THREE.Group): void {
    this.view.remove(made)
    made.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return
      part.geometry.dispose()
      if (part.material !== wallMaterial && part.material !== surfMaterial) {
        const material = part.material as THREE.MeshStandardMaterial
        material.map?.dispose()
        ;(material.userData.fogDepths as THREE.Texture | undefined)?.dispose()
        material.dispose()
      }
    })
  }
}

function buildChunk(terrain: Terrain, cx: number, cy: number, fogged: boolean): THREE.Group {
  const ground = groundChunk(terrain, cx, cy, PIXELS_PER_TILE_3D, fogged)
  const left = cx * CHUNK_SIZE
  const top = cy * CHUNK_SIZE
  const tileAt = ground.tileAt
  // A square for each tile, the water's a little lower than the land's, so the picture lies on it unstretched and every
  // edge stays hard. Every square is flat, so every normal is straight up.
  const tiles = CHUNK_SIZE * CHUNK_SIZE
  const positions = new Float32Array(tiles * 4 * 3)
  const normals = new Float32Array(tiles * 4 * 3)
  const uvs = new Float32Array(tiles * 4 * 2)
  const indices = new Uint16Array(tiles * 6)
  let vertex = 0
  let index = 0
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const h = isWater(tileAt(left + x, top + y)) ? -WATER_DEPTH : 0
      const a = vertex
      for (let corner = 0; corner < 4; corner++) {
        const dx = corner & 1
        const dy = corner >> 1
        positions[vertex * 3] = left + x + dx
        positions[vertex * 3 + 1] = h
        positions[vertex * 3 + 2] = top + y + dy
        normals[vertex * 3 + 1] = 1
        uvs[vertex * 2] = (x + dx) / CHUNK_SIZE
        uvs[vertex * 2 + 1] = (y + dy) / CHUNK_SIZE
        vertex++
      }
      for (const offset of QUAD) indices[index++] = a + offset
    }
  }
  const sheet = new THREE.BufferGeometry()
  sheet.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  sheet.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  sheet.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  sheet.setIndex(new THREE.BufferAttribute(indices, 1))
  const texture = new THREE.DataTexture(ground.pixels, ground.size, ground.size, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  // Its pixels drawn sharp: every edge between grounds is a hard line, never smeared.
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestMipmapNearestFilter
  texture.generateMipmaps = true
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })
  const depth = fogged ? fogDepth(terrain, cx, cy) : undefined
  if (depth) seaUnderFog(material, fogDepthTexture(depth), left, top)
  const mesh = new THREE.Mesh(sheet, material)
  mesh.receiveShadow = true
  const made = new THREE.Group()
  made.add(mesh)
  const walls = cryptWalls(left, top, tileAt)
  if (walls) made.add(walls)
  const banks = banksOf(left, top, tileAt)
  if (banks) made.add(banks)
  // (No surf breaks on a far island's coast under its fog: it would show through where the coast is.)
  const fogCoast = depth ? (x: number, y: number) => fogDepthAt(depth, x - left + 0.5, y - top + 0.5) > FOG_REACH - SURF_REACH - 2 : () => false
  const surf = surfOf(left, top, tileAt, ground.seaDistance, fogCoast)
  if (surf) made.add(surf)
  return made
}

// The surf over a chunk's sea near the land (see surfMaterial): a square over each tile of it, on the water, with how far
// from the land each of its corners is, for the waves to roll in by. None by the coasts `hidden` says are hidden.
function surfOf(
  left: number,
  top: number,
  tileAt: (x: number, y: number) => GroundKind,
  seaDistance: (x: number, y: number) => number,
  hidden: (x: number, y: number) => boolean,
): THREE.Mesh | undefined {
  // How far from the land's edge a corner of tiles is (0 where it touches land).
  const cornerDistance = (x: number, y: number): number => {
    const round = [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]
    if (round.some(([tx, ty]) => tileAt(tx, ty).kind !== 'sea')) return 0
    return Math.max(0, round.reduce((sum, [tx, ty]) => sum + seaDistance(tx, ty), 0) / 4 - 0.5)
  }
  const positions: number[] = []
  const corners: number[] = []
  const local: number[] = []
  for (let y = top; y < top + CHUNK_SIZE; y++) {
    for (let x = left; x < left + CHUNK_SIZE; x++) {
      if (tileAt(x, y).kind !== 'sea' || seaDistance(x, y) > SURF_REACH + 1.5 || hidden(x, y)) continue
      const c = [cornerDistance(x, y), cornerDistance(x + 1, y), cornerDistance(x, y + 1), cornerDistance(x + 1, y + 1)]
      const h = 0.01 - WATER_DEPTH
      for (const [cx, cy] of [[0, 0], [0, 1], [1, 0], [1, 0], [0, 1], [1, 1]]) {
        positions.push(x + cx, h, y + cy)
        corners.push(...c)
        local.push(cx, cy)
      }
    }
  }
  if (positions.length === 0) return undefined
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('corners', new THREE.Float32BufferAttribute(corners, 4))
  geometry.setAttribute('local', new THREE.Float32BufferAttribute(local, 2))
  const mesh = new THREE.Mesh(geometry, surfMaterial)
  mesh.renderOrder = 1
  return mesh
}

// Faces coloured corner by corner, built up into one mesh (lit, both sides showing): the banks, the crypt's walls.
class ColoredFaces {
  private readonly positions: number[] = []
  private readonly colors: number[] = []
  private readonly shade = new THREE.Color()

  // A face of four corners, in order round it, each with its colour.
  add(corners: ReadonlyArray<readonly [number, number, number]>, cornerColors: readonly number[]): void {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.positions.push(...corners[i])
      this.shade.setHex(cornerColors[i])
      this.colors.push(this.shade.r, this.shade.g, this.shade.b)
    }
  }

  // The mesh of every face added, if any were.
  mesh(castShadow: boolean): THREE.Mesh | undefined {
    if (this.positions.length === 0) return undefined
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, wallMaterial)
    mesh.receiveShadow = true
    mesh.castShadow = castShadow
    return mesh
  }
}

// The banks down to the water in a chunk: a face on each edge of a water tile where land is beside it, from the
// ground down to the water, in the colour of the land it is cut into.
function banksOf(left: number, top: number, tileAt: (x: number, y: number) => GroundKind): THREE.Mesh | undefined {
  const faces = new ColoredFaces()
  for (let y = top; y < top + CHUNK_SIZE; y++) {
    for (let x = left; x < left + CHUNK_SIZE; x++) {
      const tile = tileAt(x, y)
      if (!isWater(tile)) continue
      // Each side: the land tile beside it, and the edge (from a to b, so the face looks out over the water).
      const sides: Array<[number, number, number, number, number, number]> = [
        [x, y - 1, x + 1, y, x, y],
        [x + 1, y, x + 1, y + 1, x + 1, y],
        [x, y + 1, x, y + 1, x + 1, y + 1],
        [x - 1, y, x, y, x, y + 1],
      ]
      for (const [nx, ny, ax, ay, bx, by] of sides) {
        const beside = tileAt(nx, ny)
        if (beside.kind !== 'land') continue
        const [upper, lower] = beside.fogged ? BANK_FOG : beside.rocky ? BANK_ROCK : tile.kind === 'sea' ? BANK_SAND : BANK_EARTH
        faces.add(
          [
            [ax, 0, ay],
            [ax, -WATER_DEPTH, ay],
            [bx, -WATER_DEPTH, by],
            [bx, 0, by],
          ],
          [upper, lower, lower, upper],
        )
      }
    }
  }
  return faces.mesh(false)
}

// The ice crypt's walls in a chunk, as blocks: a dark top, and faces of pale ice towards the floor.
function cryptWalls(left: number, top: number, tileAt: (x: number, y: number) => GroundKind): THREE.Mesh | undefined {
  const faces = new ColoredFaces()
  const isFloor = (tile: GroundKind): boolean => tile.kind === 'dungeon' && tile.part === 'floor'
  for (let y = top; y < top + CHUNK_SIZE; y++) {
    for (let x = left; x < left + CHUNK_SIZE; x++) {
      const tile = tileAt(x, y)
      if (tile.kind !== 'dungeon' || tile.part === 'floor') continue
      const lid = tile.part === 'wall' ? CRYPT_WALL : CRYPT_VOID
      const h = WALL_HEIGHT
      faces.add([[x, h, y], [x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y]], [lid, lid, lid, lid])
      const face = (ax: number, ay: number, bx: number, by: number): void =>
        faces.add([[ax, h, ay], [ax, 0, ay], [bx, 0, by], [bx, h, by]], [CRYPT_WALL_FACE, CRYPT_WALL_FOOT, CRYPT_WALL_FOOT, CRYPT_WALL_FACE])
      if (isFloor(tileAt(x, y - 1))) face(x, y, x + 1, y)
      if (isFloor(tileAt(x + 1, y))) face(x + 1, y, x + 1, y + 1)
      if (isFloor(tileAt(x, y + 1))) face(x + 1, y + 1, x, y + 1)
      if (isFloor(tileAt(x - 1, y))) face(x, y + 1, x, y)
      // Spikes hidden in the wall: the dark holes they shoot from, on the face they shoot out of (as the view draws
      // them coming out: see updateTraps), there to be seen by whoever looks.
      const trap = tile.part === 'wall' ? dungeonTrapAt(x, y) : undefined
      const dir = trap !== undefined ? DUNGEON_TRAPS[trap].wall?.dir : undefined
      if (dir) {
        const fx = x + 0.5 + dir.x * 0.505
        const fz = y + 0.5 + dir.y * 0.505
        for (const [side, height] of WALL_SPIKES) {
          const sx = dir.y !== 0 ? side : 0
          const sz = dir.x !== 0 ? side : 0
          const across = dir.x !== 0 ? [0, 0.05] : [0.05, 0]
          const cx = fx + sx
          const cz = fz + sz
          faces.add(
            [
              [cx - across[0], height + 0.05, cz - across[1]],
              [cx - across[0], height - 0.05, cz - across[1]],
              [cx + across[0], height - 0.05, cz + across[1]],
              [cx + across[0], height + 0.05, cz + across[1]],
            ],
            [CRYPT_HOLE, CRYPT_HOLE, CRYPT_HOLE, CRYPT_HOLE],
          )
        }
      }
    }
  }
  return faces.mesh(true)
}
