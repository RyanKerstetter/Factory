import * as THREE from 'three'
import { CHUNK_SIZE, chunkCoords, chunkId, floorDiv, type Terrain } from '../../../../packages/shared/src/index.ts'
import type { TileBounds } from '../camera.ts'
import { FOG_DEPTH_GLSL, FOG_RAMP, fogDepth, fogDepthTexture } from './fog-depth.ts'

// The fog over the far islands (the desert, the meadow: see `isFoggedAt`), for a player who has not eaten a truesight
// flesh: a wall of white mist standing over each island and FOG_REACH tiles out to sea round it (see fog-depth.ts),
// thick enough that the island cannot be made out, though not quite solid. It is drawn as LAYERS sheets one over
// another, up to a few tiles high (so beyond the island it is seen rising as a wall, and on the side facing the camera
// it is as thick as at its foot: see the shader); in each the mist swirls in soft, simple shapes, pushed about and
// turned by a slower current, every sheet at its own pace and the other way to the one under it, and its edge is thin
// and wispy, billowing in and out. A player may go into it (on the sea: the island itself is solid to them until they
// have truesight), and it parts in a small pocket round them (CLEAR_RADIUS), its rim ragged with quicker wisps and a few
// still blowing through, so they still see themselves. The island's ground under it is painted as fog, and the sea
// under it pale, with no surf on the island's coast (see ground-colors.ts and ground.ts), so nothing of the island shows
// through it; nothing standing on the island is drawn (see game.ts). Once the player has truesight it is gone.

// The clearing round the player (tiles, as the camera sees them: round on the screen): clear out to CLEAR_RADIUS -
// CLEAR_SOFT, as thick as the rest by CLEAR_RADIUS.
const CLEAR_RADIUS = 1.3
const CLEAR_SOFT = 0.8
// The height (tiles) the clearing is centred on: low on the player, so it takes in the raft under them (in the fog,
// they are always on one) as much as their head, however steeply the camera looks down.
const CLEAR_HEIGHT = 0.3

// The sheets, from the sea up: the height (tiles), how thick (the mist's thickest parts are 1.4 times as thick, its
// thinnest 0.6), how big its swirls are (the noise is scaled by this, per tile), how fast it moves (and which way), and
// its colours, in the hollows and on the tops. All of them together let a little of what is under them through.
type Layer = { height: number; opacity: number; scale: number; speed: number; shade: number; light: number }
// (Every sheet is drawn over the whole of the fog in view, so each costs the graphics card a screenful: a few go a long
// way.)
const LAYERS: readonly Layer[] = [
  { height: 0.1, opacity: 0.8, scale: 0.045, speed: 0.02, shade: 0xc3ccd4, light: 0xf3f5f7 },
  { height: 1.1, opacity: 0.6, scale: 0.055, speed: -0.026, shade: 0xcdd5dc, light: 0xf8f9fa },
  { height: 2.1, opacity: 0.45, scale: 0.066, speed: 0.032, shade: 0xd7dde2, light: 0xfcfcfd },
  { height: 3.1, opacity: 0.32, scale: 0.08, speed: -0.04, shade: 0xe0e5e9, light: 0xffffff },
]

// Shared by every sheet: the time, and where the clearing is (`clearAt`, in the world; `clearOn` 0 for none) along the
// way the camera looks (`viewDir`).
const shared = {
  time: { value: 0 },
  clearAt: { value: new THREE.Vector3() },
  clearOn: { value: 0 },
  viewDir: { value: new THREE.Vector3(0, -1, 0) },
}

// A square of smooth noise that tiles (two kinds, in its red and green), made once: the mist is drawn from it, which
// costs the graphics card far less than working noise out for every pixel of every sheet. Only a few broad octaves,
// so the mist is soft and simple, not finely detailed.
const NOISE_SIZE = 128
let noiseTexture: THREE.DataTexture | undefined
function noiseMap(): THREE.DataTexture {
  if (noiseTexture) return noiseTexture
  const pixels = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4)
  const lattice = (seed: number, cells: number) => {
    const values = new Float32Array(cells * cells)
    let state = seed
    for (let i = 0; i < values.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      values[i] = state / 4294967296
    }
    return (x: number, y: number): number => {
      const fx = (x / NOISE_SIZE) * cells
      const fy = (y / NOISE_SIZE) * cells
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      const tx = fx - ix
      const ty = fy - iy
      const sx = tx * tx * (3 - 2 * tx)
      const sy = ty * ty * (3 - 2 * ty)
      const at = (cx: number, cy: number): number => values[((cy % cells) * cells + (cx % cells)) % values.length]
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx
      const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx
      return top + (bottom - top) * sy
    }
  }
  const octaves = (seed: number) => [lattice(seed, 4), lattice(seed + 1, 8), lattice(seed + 2, 16)]
  const red = octaves(11)
  const green = octaves(57)
  const fbm = (layers: ReturnType<typeof octaves>, x: number, y: number): number =>
    layers[0](x, y) * 0.58 + layers[1](x, y) * 0.3 + layers[2](x, y) * 0.12
  for (let y = 0; y < NOISE_SIZE; y++) {
    for (let x = 0; x < NOISE_SIZE; x++) {
      const at = (y * NOISE_SIZE + x) * 4
      pixels[at] = Math.round(fbm(red, x, y) * 255)
      pixels[at + 1] = Math.round(fbm(green, x, y) * 255)
      pixels[at + 3] = 255
    }
  }
  noiseTexture = new THREE.DataTexture(pixels, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat)
  noiseTexture.wrapS = THREE.RepeatWrapping
  noiseTexture.wrapT = THREE.RepeatWrapping
  noiseTexture.magFilter = THREE.LinearFilter
  noiseTexture.minFilter = THREE.LinearMipmapLinearFilter
  noiseTexture.generateMipmaps = true
  noiseTexture.needsUpdate = true
  return noiseTexture
}

// A sheet's look, over the chunk whose top left corner is `corner` (tiles), with the chunk's depths (fogDepthTexture).
function sheetMaterial(layer: Layer, density: THREE.Texture, corner: THREE.Vector2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      density: { value: density },
      corner: { value: corner },
      noise: { value: noiseMap() },
      height: { value: layer.height },
      opacity: { value: layer.opacity },
      scale: { value: layer.scale },
      speed: { value: layer.speed },
      shade: { value: new THREE.Color(layer.shade) },
      light: { value: new THREE.Color(layer.light) },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 vWorld;
      void main() {
        // Where it is in the world (the sheet is placed by its matrix), so the mist runs on unbroken from chunk to chunk.
        vWorld = (modelMatrix * vec4(position, 1.0)).xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform sampler2D density;
      uniform sampler2D noise;
      uniform float height;
      uniform float opacity;
      uniform float scale;
      uniform float speed;
      uniform vec3 shade;
      uniform vec3 light;
      uniform vec3 clearAt;
      uniform float clearOn;
      uniform vec3 viewDir;
      uniform vec2 corner;
      varying vec2 vWorld;
      ${FOG_DEPTH_GLSL}
      void main() {
        // How far inside the fog this is (tiles; less than 0 outside it): as far as here, or as where the camera's line
        // through here comes down to the sea, if that is further in. A higher sheet is seen further off than the sea
        // under it, so on the side facing the camera the wall would otherwise thin out towards its top.
        vec2 here = vWorld - corner;
        vec2 down = viewDir.xz * (height / -viewDir.y);
        float inside = max(fogDepthIn(density, here), fogDepthIn(density, here + down));
        if (inside < -1.5) discard;
        vec2 p = vWorld * scale;
        float t = time * speed;
        // A slow current (the noise's two kinds, one each way) pushes the mist about, and turns as it goes, so it swirls.
        vec2 push = texture2D(noise, p * 0.5 + vec2(t, -t * 0.7)).rg - 0.5;
        float turn = t * 5.0 + (push.x - push.y) * 3.0;
        push = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * push;
        float n = smoothstep(0.28, 0.72, texture2D(noise, p + push * 0.9 + vec2(t * 0.4, t * 0.25)).r);
        // Its edge billows in and out.
        float edge = smoothstep(0.0, ${FOG_RAMP.toFixed(1)}, inside + (n - 0.5) * 2.6);
        float alpha = edge * opacity * (0.6 + 0.8 * n);
        // The clearing round the player: round the camera's line to them (so it is round as the camera sees it, at any
        // angle). Its rim is ragged with finer wisps, quicker than the rest of the mist, and the thickest of them still
        // blow through it.
        vec3 off = vec3(vWorld.x, height, vWorld.y) - clearAt;
        float away = length(off - viewDir * dot(off, viewDir));
        if (clearOn > 0.5 && away < ${(CLEAR_RADIUS + 1).toFixed(2)}) {
          float wisp = texture2D(noise, vWorld * 0.3 + push * 0.5 + vec2(t * 4.0, -t * 3.0)).g;
          float clear = smoothstep(${(CLEAR_RADIUS - CLEAR_SOFT).toFixed(2)}, ${CLEAR_RADIUS.toFixed(2)}, away + (wisp - 0.5) * 1.8 + (n - 0.5) * 0.5);
          alpha *= max(clear, smoothstep(0.55, 0.8, wisp) * 0.45);
        }
        gl_FragColor = vec4(mix(shade, light, n), clamp(alpha, 0.0, 1.0));
        #include <colorspace_fragment>
      }
    `,
  })
}

export class Fog {
  readonly view = new THREE.Group()
  private readonly chunks = new Map<number, THREE.Group | null>()
  private terrain: Terrain | undefined

  // The fog over the chunks in view, for a player without truesight (`shown`); none for one with it. `player` is where
  // the player is (tiles), for the clearing round them, and `camera` the way it looks.
  update(terrain: Terrain | undefined, bounds: TileBounds, shown: boolean, player: { x: number; y: number } | undefined, camera: THREE.Camera): void {
    shared.time.value = (performance.now() / 1000) % 100_000
    shared.clearOn.value = player ? 1 : 0
    if (player) shared.clearAt.value.set(player.x, CLEAR_HEIGHT, player.y)
    camera.getWorldDirection(shared.viewDir.value)
    if (terrain !== this.terrain || !shown) {
      this.terrain = terrain
      this.clear()
    }
    if (!terrain || !shown) return
    const left = floorDiv(bounds.left, CHUNK_SIZE)
    const right = floorDiv(bounds.right, CHUNK_SIZE)
    const top = floorDiv(bounds.top, CHUNK_SIZE)
    const bottom = floorDiv(bounds.bottom, CHUNK_SIZE)
    let made = 0
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        const id = chunkId(cx, cy)
        if (this.chunks.has(id) || made >= 4) continue
        const fog = fogChunk(terrain, cx, cy)
        this.chunks.set(id, fog)
        if (fog) this.view.add(fog)
        made++
      }
    }
    for (const [id, fog] of this.chunks) {
      const { cx, cy } = chunkCoords(id)
      if (cx >= left - 1 && cx <= right + 1 && cy >= top - 1 && cy <= bottom + 1) continue
      if (fog) this.drop(fog)
      this.chunks.delete(id)
    }
  }

  private clear(): void {
    for (const fog of this.chunks.values()) if (fog) this.drop(fog)
    this.chunks.clear()
  }

  private drop(fog: THREE.Group): void {
    this.view.remove(fog)
    let density: THREE.Texture | undefined
    fog.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return
      part.geometry.dispose()
      const material = part.material as THREE.ShaderMaterial
      density = material.uniforms.density.value as THREE.Texture
      material.dispose()
    })
    density?.dispose()
  }
}

// A chunk's sheets of fog, or null if the fog does not reach it. How far inside the fog each tile is goes into a small
// picture (see fogDepthTexture).
function fogChunk(terrain: Terrain, cx: number, cy: number): THREE.Group | null {
  const depth = fogDepth(terrain, cx, cy)
  if (!depth) return null
  const density = fogDepthTexture(depth)
  const left = cx * CHUNK_SIZE
  const top = cy * CHUNK_SIZE
  const corner = new THREE.Vector2(left, top)
  const made = new THREE.Group()
  LAYERS.forEach((layer, index) => {
    // A sheet over the chunk. Every chunk's lowest sheet is drawn first, then the next up, and so on, so where one
    // chunk's sheet is seen over the next chunk's (the higher, the further it is seen to the north) they are laid over
    // each other the same way, with no seam between the chunks.
    const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE).rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geometry, sheetMaterial(layer, density, corner))
    mesh.position.set(left + CHUNK_SIZE / 2, layer.height, top + CHUNK_SIZE / 2)
    mesh.renderOrder = 8 + index
    mesh.frustumCulled = false
    made.add(mesh)
  })
  return made
}
