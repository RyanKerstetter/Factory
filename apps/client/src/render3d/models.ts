import * as THREE from 'three'
import { liquidLook } from '../liquids.ts'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hashInts, WARP_LIGHT_LEVELS } from '../../../../packages/shared/src/index.ts'
import { POND_COLOR } from './ground-colors.ts'

// The 3D models: built in code from simple low-poly shapes (flat-shaded, in earthy colours), one function per kind of
// thing. A world unit is a tile; y is up; a model stands on y = 0 at its tile's middle and faces +x. Geometries and
// materials are made once and shared by every copy, so a forest of trees is cheap to draw. To change how something
// looks, change its function here.

const PALETTE = {
  bark: 0x6b4a2c,
  barkDark: 0x4a3220,
  wood: 0x9c7448,
  woodLight: 0xc49562,
  leaf: 0x3f7a35,
  leafDark: 0x2c5a2a,
  leafLight: 0x5a9a44,
  grass: 0x6aa84f,
  berry: 0xc8324f,
  stone: 0x8d8f94,
  stoneDark: 0x6c6f75,
  soil: 0x4a3220,
  soilDark: 0x3a2616,
  hay: 0xd8c27a,
  wheat: 0xd9b94a,
  sprout: 0x6fbf4a,
  hide: 0xa87a4f,
  fur: 0x7a5233,
  furLight: 0x9a7048,
  skin: 0xd8a27a,
  hair: 0x3a2616,
  cowWhite: 0xece8df,
  cowPatch: 0x3a2e28,
  horn: 0xe8dcc0,
  pink: 0xe0a0a0,
  chicken: 0xf3efe6,
  deer: 0x9a6a40,
  deerBelly: 0xd9c4a0,
  antler: 0xd8c8a4,
  wolf: 0x7d828c,
  wolfLight: 0x9ea2aa,
  wolfBlack: 0x34373d,
  bull: 0x5a3a28,
  bullDark: 0x3a2418,
  ring: 0xd8c070,
  hen: 0xb07a48,
  rooster: 0xc0662a,
  roosterTail: 0x23262e,
  roosterTailGreen: 0x2f5a3a,
  deerDark: 0x6e4a2c,
  wolfDark: 0x4f535b,
  wolfPale: 0xc9ccd2,
  nose: 0x22201e,
  ice: 0xcfeaff,
  iceDeep: 0x8cc4ef,
  robe: 0x22314e,
  robeDark: 0x161f33,
  iron: 0x4a4c52,
  brass: 0xc9a24a,
  bag: 0x6a7a4a,
  bagDark: 0x4f5a35,
  bagLight: 0x8a9a62,
  pillow: 0xd8cfb4,
  bone: 0xe6dfc8,
  boneDark: 0xb8ae92,
  eye: 0xff4a2a,
  rust: 0x8a5a3a,
  ash: 0x3a3632,
  char: 0x1e1b18,
  void: 0x0b0a09,
  comb: 0xd9264a,
  beak: 0xe8a23a,
  flame: 0xff8a2a,
  flameCore: 0xffe08a,
  rope: 0xb9a26a,
  water: 0x3a78b8,
}

// The colour of each liquid seen in an open barrel.

const doubleSided = new Map<number, THREE.MeshStandardMaterial>()
// The same, seen from both sides (the inside of an open barrel).
function bothSides(color: number): THREE.MeshStandardMaterial {
  let made = doubleSided.get(color)
  if (!made) {
    made = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide })
    doubleSided.set(color, made)
  }
  return made
}

const materials = new Map<number, THREE.MeshStandardMaterial>()
export function material(color: number): THREE.MeshStandardMaterial {
  let made = materials.get(color)
  if (!made) {
    made = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0 })
    materials.set(color, made)
  }
  return made
}

const shinyMaterials = new Map<number, THREE.MeshStandardMaterial>()
// The same, smooth and a little glossy (flint, catching the light).
function shiny(color: number): THREE.MeshStandardMaterial {
  let made = shinyMaterials.get(color)
  if (!made) {
    made = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.3, metalness: 0.15 })
    shinyMaterials.set(color, made)
  }
  return made
}

const geometries = new Map<string, THREE.BufferGeometry>()
function geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let made = geometries.get(key)
  if (!made) {
    made = make()
    geometries.set(key, made)
  }
  return made
}

// A mesh of a shared shape and colour, placed (and scaled, and turned) in its model.
function part(
  shape: THREE.BufferGeometry,
  color: number,
  at: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
  turn: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(shape, material(color))
  mesh.position.set(...at)
  mesh.scale.set(...scale)
  mesh.rotation.set(...turn)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

const box = (): THREE.BufferGeometry => geometry('box', () => new THREE.BoxGeometry(1, 1, 1))
const cylinder = (sides = 7): THREE.BufferGeometry => geometry(`cyl${sides}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, sides))
const cone = (sides = 5): THREE.BufferGeometry => geometry(`cone${sides}`, () => new THREE.ConeGeometry(0.5, 1, sides))
const blob = (): THREE.BufferGeometry => geometry('blob', () => new THREE.IcosahedronGeometry(0.5, 0))
const lump = (): THREE.BufferGeometry => geometry('lump', () => new THREE.DodecahedronGeometry(0.5, 0))
const ball = (): THREE.BufferGeometry => geometry('ball', () => new THREE.SphereGeometry(0.5, 8, 6))

// A number from 0 to 1 for a tile and a salt, so each tree and rock is a little different, and the same every time.
const vary = (x: number, y: number, salt: number): number => (hashInts(x, y, salt) % 1000) / 1000

function group(...children: THREE.Object3D[]): THREE.Group {
  const made = new THREE.Group()
  if (children.length > 0) made.add(...children)
  return made
}

// ---- what grows

export function tree(x: number, y: number): THREE.Group {
  const lean = (vary(x, y, 1) - 0.5) * 0.15
  const tall = 0.9 + vary(x, y, 2) * 0.35
  return group(
    part(cylinder(6), PALETTE.bark, [0, 0.5 * tall, 0], [0.24, tall, 0.24], [lean, 0, lean / 2]),
    part(blob(), PALETTE.leafDark, [0, 1.15 * tall, 0], [1.35, 1, 1.35], [0, vary(x, y, 3) * 3, 0]),
    part(blob(), PALETTE.leaf, [0.12, 1.5 * tall, -0.08], [1.05, 0.85, 1.05], [0, vary(x, y, 4) * 3, 0]),
    part(blob(), PALETTE.leafLight, [-0.1, 1.8 * tall, 0.1], [0.65, 0.6, 0.65]),
  )
}

// ---- foliage cards
//
// A berry bush (and a sprout growing into one) is made of foliage cards: flat planes crossing through its middle, each
// painted with a picture of leaves with gaps between them where it is see-through, so the cards behind show through
// the gaps and the bush has texture and depth. The pictures are pixel art, painted once here (the same every time) and
// shared; anything see-through is cut away (alphaTest), so they sort and cast their leafy shadows like anything solid.

type FoliageLook = 'leaves' | 'berries' | 'unripe' | 'young'
type FoliageShape = 'dome' | 'round'
const FOLIAGE_W = 48
const FOLIAGE_H = 40

// A little random number maker, seeded, so the pictures come out the same every time.
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const foliageMaterials = new Map<string, THREE.MeshStandardMaterial>()
// A foliage card's material: its picture of leaves (and berries: red and ripe, or small and green), in the outline of a
// bush seen from the side (`dome`, flat along the bottom) or from above (`round`).
function foliageMaterial(look: FoliageLook, shape: FoliageShape): THREE.MeshStandardMaterial {
  const key = `${look}|${shape}`
  let made = foliageMaterials.get(key)
  if (made) return made
  const width = FOLIAGE_W
  const height = shape === 'round' ? FOLIAGE_W : FOLIAGE_H
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  const random = seeded(look.length * 977 + (shape === 'round' ? 31 : 7))
  // Inside the outline: a half-ellipse standing on the bottom edge, or an ellipse filling the square, a little ragged.
  const inside = (x: number, y: number): number => {
    const dx = (x - width / 2) / (width / 2)
    const dy = shape === 'round' ? (y - height / 2) / (height / 2) : (height - y) / height
    return 1 - Math.hypot(dx, dy)
  }
  const shades =
    look === 'young'
      ? ['#4f8a34', '#6fbf4a', '#86cf5a', '#5aa23e', '#3f7a2c']
      : ['#1f4220', '#2c5a2a', '#3f7a35', '#4b8a3a', '#5a9a44', '#6aac4c']
  // Leaves: small pointed ovals, many of them, darker deep in and at the bottom, lighter towards the top and the edge,
  // with gaps left between the clumps.
  const leaves = look === 'young' ? 150 : 260
  for (let n = 0; n < leaves; n++) {
    const x = random() * width
    const y = random() * height
    const depth = inside(x, y)
    if (depth < 0.04 + random() * 0.08) continue
    // Fewer leaves in some patches, so there are holes to see through.
    if (Math.sin(x * 0.45 + y * 0.2) * Math.cos(y * 0.5 - x * 0.15) > 0.55 && random() < 0.85) continue
    const light = Math.min(shades.length - 1, Math.max(0, Math.floor((1 - y / height) * 2.2 + (1 - depth) * 2 + random() * 2.2)))
    g.fillStyle = shades[light]
    const angle = random() * Math.PI
    const long = 2 + random() * 1.6
    g.beginPath()
    g.ellipse(Math.round(x), Math.round(y), long, long * 0.5, angle, 0, Math.PI * 2)
    g.fill()
    // A light vein on some.
    if (random() < 0.3) {
      g.fillStyle = 'rgba(160, 210, 120, 0.7)'
      g.fillRect(Math.round(x), Math.round(y), 1, 1)
    }
  }
  // Berries: clusters of round red ones with a glint, or a few small green ones not yet ripe.
  if (look === 'berries' || look === 'unripe') {
    const clusters = look === 'berries' ? 9 : 5
    for (let c = 0; c < clusters; c++) {
      let x = 0
      let y = 0
      for (let tries = 0; tries < 20; tries++) {
        x = 6 + random() * (width - 12)
        y = 6 + random() * (height - 10)
        if (inside(x, y) > 0.2) break
      }
      const count = look === 'berries' ? 2 + Math.floor(random() * 3) : 1 + Math.floor(random() * 2)
      for (let b = 0; b < count; b++) {
        const bx = Math.round(x + (random() - 0.5) * 5)
        const by = Math.round(y + (random() - 0.5) * 4)
        if (look === 'berries') {
          g.fillStyle = '#8a1a30'
          g.fillRect(bx - 1, by - 1, 3, 3)
          g.fillStyle = '#c8324f'
          g.fillRect(bx - 1, by - 1, 2, 2)
          g.fillStyle = '#ffd0d8'
          g.fillRect(bx - 1, by - 1, 1, 1)
        } else {
          g.fillStyle = '#9ac85a'
          g.fillRect(bx, by, 2, 2)
        }
      }
    }
  }
  // Hard edges only: each pixel is a leaf or a gap.
  const image = g.getImageData(0, 0, width, height)
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = image.data[i] >= 128 ? 255 : 0
  g.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  made = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 })
  foliageMaterials.set(key, made)
  return made
}

// A foliage card standing on the ground through the middle (its foot at y = 0), turned `turn` round, `width` across
// and `height` high; or (`top`) lying over it at `height`, `width` across.
function foliageCard(look: FoliageLook, width: number, height: number, turn: number, top = false): THREE.Mesh {
  const plane = geometry('foliageCard', () => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0))
  const flat = geometry('foliageTop', () => new THREE.PlaneGeometry(1, 1))
  const mesh = new THREE.Mesh(top ? flat : plane, foliageMaterial(look, top ? 'round' : 'dome'))
  if (top) {
    mesh.position.y = height
    mesh.scale.set(width, width, 1)
    mesh.rotation.set(-Math.PI / 2, 0, turn)
  } else {
    mesh.scale.set(width, height, 1)
    mesh.rotation.y = turn
  }
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// A clump of foliage cards: `cards` standing through its middle, evenly turned, and a lid of leaves over the top, round a
// dark heart (so it never looks hollow), `width` across and `height` high. Every other card is `look`, the rest plain
// leaves (or young ones).
function foliageClump(look: FoliageLook, width: number, height: number, cards: number): THREE.Group {
  const plain: FoliageLook = look === 'young' ? 'young' : 'leaves'
  const made = group(part(lump(), look === 'young' ? PALETTE.leaf : PALETTE.leafDark, [0, height * 0.3, 0], [width * 0.32, height * 0.42, width * 0.32]))
  for (let i = 0; i < cards; i++) made.add(foliageCard(i % 2 === 0 ? look : plain, width, height, (i / cards) * Math.PI + 0.3))
  made.add(foliageCard(look, width * 0.8, height * 0.72, 0.5, true))
  return made
}

// A berry bush: a full clump of leafy cards, red berries among the leaves.
export function bush(): THREE.Group {
  return foliageClump('berries', 1.0, 0.72, 4)
}

export function rock(x: number, y: number): THREE.Group {
  const turn = vary(x, y, 5) * Math.PI * 2
  const made = group(part(lump(), PALETTE.stone, [0, 0.22, 0], [0.85, 0.55, 0.75], [0, turn, 0]))
  // Some are a pair: a big stone and a small one beside it.
  if (vary(x, y, 6) > 0.5) made.add(part(lump(), PALETTE.stoneDark, [0.3, 0.12, 0.22], [0.35, 0.28, 0.35], [0, turn * 2, 0]))
  return made
}

export function grass(x: number, y: number): THREE.Group {
  const made = new THREE.Group()
  for (let i = 0; i < 11; i++) {
    const angle = vary(x, y, 10 + i) * Math.PI * 2
    const out = 0.04 + vary(x, y, 20 + i) * 0.26
    const tall = 0.28 + vary(x, y, 30 + i) * 0.3
    const lean = 0.2 + out
    made.add(
      part(cone(3), i % 3 === 0 ? PALETTE.leafLight : i % 3 === 1 ? PALETTE.grass : PALETTE.leaf, [Math.cos(angle) * out, tall / 2, Math.sin(angle) * out], [0.11, tall, 0.11], [
        Math.sin(angle) * lean,
        0,
        -Math.cos(angle) * lean,
      ]),
    )
  }
  return made
}

// Something stuck in the ground, to be knocked loose: a piece of flint (a broken nodule, turned by its tile), a
// thrown spear standing where it came down (leaning, its point buried), or anything else (a small lump).
export function loose(item: string, x: number, y: number): THREE.Group {
  if (item.endsWith('spear')) {
    const turn = vary(x, y, 43) * Math.PI * 2
    const spear = group(
      part(cylinder(5), PALETTE.wood, [0, 0.55, 0], [0.045, 1.1, 0.045]),
      part(box(), PALETTE.rope, [0, 0.12, 0], [0.06, 0.06, 0.06]),
      part(cylinder(8), PALETTE.soil, [0, 0.01, 0], [0.16, 0.02, 0.16]),
    )
    spear.rotation.set(0.35, turn, 0.2)
    return group(spear)
  }
  if (item === 'flint') {
    // A few pieces of flint on the ground: thin, sharp-edged flakes of dark grey flint (flattened diamonds, like
    // knapped blades) lying on their sides, scattered a little apart, all one flint colour, a little glossy.
    const turn = vary(x, y, 40) * Math.PI * 2
    const facets = geometry('flintFacets', () => new THREE.OctahedronGeometry(0.5, 0))
    const flake = (color: number, at: [number, number, number], scale: [number, number, number], tilt: [number, number, number]): THREE.Mesh => {
      const mesh = part(facets, color, at, scale, tilt)
      mesh.material = shiny(color)
      return mesh
    }
    const made = group(
      flake(0x3a3d46, [0, 0.022, 0], [0.32, 0.045, 0.14], [0.05, 0.3, 0.04]),
      flake(0x31343c, [0.13, 0.028, 0.11], [0.24, 0.04, 0.11], [0.22, 1.5, -0.12]),
      flake(0x444853, [-0.15, 0.018, -0.09], [0.2, 0.035, 0.1], [-0.08, -0.9, 0.1]),
    )
    made.rotation.y = turn
    made.position.set((vary(x, y, 41) - 0.5) * 0.4, 0, (vary(x, y, 42) - 0.5) * 0.4)
    return group(made)
  }
  return group(part(lump(), PALETTE.stoneDark, [0, 0.06, 0], [0.2, 0.12, 0.2]))
}

// How many looks a sapling and a berry sprout go through before they are a tree and a bush (see `growthLook`).
export const GROWTH_LOOKS = 3

// Which of its GROWTH_LOOKS a sapling or sprout shows, from how far it has grown (`grown`, 0 to 1).
export function growthLook(grown: number): number {
  return Math.max(0, Math.min(GROWTH_LOOKS - 1, Math.floor(grown * GROWTH_LOOKS)))
}

// A sapling, at each of its looks on the way to a tree: just planted, a twig with a few leaves; then a thin young trunk
// with a tuft of leaves; then a small tree, two clumps of leaves on a slimmer trunk.
export function sapling(look: number): THREE.Group {
  if (look <= 0) {
    return group(
      part(cylinder(5), PALETTE.bark, [0, 0.09, 0], [0.035, 0.18, 0.035]),
      part(blob(), PALETTE.sprout, [0.03, 0.19, 0], [0.12, 0.08, 0.1], [0, 0.4, 0]),
      part(blob(), PALETTE.leafLight, [-0.03, 0.16, 0.02], [0.1, 0.07, 0.09], [0, 1.4, 0]),
    )
  }
  if (look === 1) {
    return group(
      part(cylinder(5), PALETTE.bark, [0, 0.22, 0], [0.06, 0.44, 0.06]),
      part(blob(), PALETTE.leaf, [0, 0.46, 0], [0.36, 0.3, 0.36]),
      part(blob(), PALETTE.leafLight, [0.04, 0.58, -0.02], [0.24, 0.2, 0.24], [0, 1, 0]),
    )
  }
  return group(
    part(cylinder(6), PALETTE.bark, [0, 0.36, 0], [0.13, 0.72, 0.13]),
    part(blob(), PALETTE.leafDark, [0, 0.78, 0], [0.78, 0.6, 0.78]),
    part(blob(), PALETTE.leaf, [0.06, 1.0, -0.04], [0.6, 0.48, 0.6], [0, 1.3, 0]),
    part(blob(), PALETTE.leafLight, [-0.05, 1.18, 0.05], [0.36, 0.32, 0.36]),
  )
}

// A berry sprout, at each of its looks on the way to a bush: just planted, a tiny seedling of a few young leaves; then a
// small leafy clump; then nearly a bush, with small green berries not yet ripe.
export function sprout(look: number): THREE.Group {
  if (look <= 0) {
    const made = group(part(cylinder(5), PALETTE.leafDark, [0, 0.05, 0], [0.025, 0.1, 0.025]))
    for (const [turn, tilt] of [[0, 0.9], [2.1, 1.0], [4.2, 0.8]] as const) {
      made.add(part(blob(), turn === 0 ? PALETTE.sprout : PALETTE.leafLight, [Math.cos(turn) * 0.05, 0.1, Math.sin(turn) * 0.05], [0.11, 0.025, 0.06], [0, -turn, tilt * 0.4]))
    }
    return made
  }
  if (look === 1) return foliageClump('young', 0.45, 0.32, 3)
  return foliageClump('unripe', 0.72, 0.52, 4)
}

// A crop in a garden plot, by how far it has grown: green shoots, taller, and golden ears once it is ready.
// Wheat, at one of its CROP_GROWTH_STAGES (see cropStage in art-catalog.ts): a few thin green shoots; then more and
// taller, with leaves; then a thick green stand; then heads forming; and last, ripe, a dense golden stand of heavy heads
// that fills the whole plot like a patch of a wheat field. Each stage is one mesh (its stalks, leaves and heads joined),
// made once and shared, turned a different way on each plot so a field does not repeat.
export const CROP_GROWTH_STAGES = 6
// A crop in its plot at a growth stage, standing in tidy rows along the plot's three furrows.
export function crop(stage: number): THREE.Group {
  const mesh = new THREE.Mesh(cropGeometry(Math.max(0, Math.min(CROP_GROWTH_STAGES - 1, stage))), cropMaterial)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return group(mesh)
}

const cropMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 })
const cropGeometries = new Map<number, THREE.BufferGeometry>()

// Wheat, as it grows: three rows of plants along the plot's furrows (see `plot`), evenly spaced, each plant a tidy
// tuft of stalks fanning a little out from its foot, all of a height. It thickens and rises stage by stage: shoots, then
// leafy green tufts, then green heads standing up, and at last a golden stand, every head nodding the same way.
function cropGeometry(stage: number): THREE.BufferGeometry {
  let made = cropGeometries.get(stage)
  if (made) return made
  // At each stage: plants in a row, stalks to a plant, how tall, and the colours of stalk, head and leaf.
  const perRow = [4, 5, 5, 6, 6, 7][stage]
  const stalks = [2, 3, 4, 5, 5, 6][stage]
  const tall = [0.08, 0.17, 0.28, 0.4, 0.5, 0.58][stage]
  const stalk = new THREE.Color([0x7ac64e, 0x6fbf4a, 0x5fae3e, 0x5ea23a, 0x86a83c, 0xcfa94a][stage])
  const head = new THREE.Color(stage >= 5 ? 0xe6c35a : 0x93b44c)
  const awn = new THREE.Color(0xf0d988)
  const leaf = new THREE.Color(stage >= 5 ? 0xb89a3e : 0x4f9a36)
  const pieces: THREE.BufferGeometry[] = []
  const add = (shape: THREE.BufferGeometry, color: THREE.Color, at: THREE.Vector3, scale: THREE.Vector3, turn: THREE.Quaternion): void => {
    const piece = shape.clone()
    piece.applyMatrix4(new THREE.Matrix4().compose(at, turn, scale))
    const count = piece.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3)
    piece.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    pieces.push(piece.index ? piece.toNonIndexed() : piece)
  }
  const stem = new THREE.CylinderGeometry(0.5, 0.5, 1, 4)
  const blade = new THREE.BoxGeometry(1, 1, 1)
  const ear = new THREE.CylinderGeometry(0.32, 0.5, 1, 6)
  const up = new THREE.Vector3(0, 1, 0)
  const ground = 0.1
  const thick = 0.011 + 0.007 * Math.min(stage, 4) / 4
  // The same small wave in height along each row, so the stand is even but not ruled flat.
  const wave = [1, 0.96, 1.02, 0.98, 1.01, 0.97, 1.03]
  for (const rowZ of [-0.25, 0, 0.25]) {
    for (let p = 0; p < perRow; p++) {
      const px = -0.36 + (0.72 * (p + 0.5)) / perRow
      const height = tall * wave[(p + Math.round(rowZ * 4) + 7) % wave.length]
      for (let s = 0; s < stalks; s++) {
        // The first stalk upright in the middle; the rest round it, leaning a little out.
        const around = s === 0 ? 0 : ((s - 1) / (stalks - 1)) * Math.PI * 2 + p * 0.5
        const spread = s === 0 ? 0 : 0.022
        const lean = s === 0 ? 0 : 0.12
        const foot = new THREE.Vector3(px + Math.cos(around) * spread, ground, rowZ + Math.sin(around) * spread)
        const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(around) * lean, 0, -Math.cos(around) * lean))
        const along = up.clone().applyQuaternion(tilt)
        const h = height * (s === 0 ? 1 : 0.92)
        add(stem, stalk, foot.clone().addScaledVector(along, h / 2), new THREE.Vector3(thick, h, thick), tilt)
        const top = foot.clone().addScaledVector(along, h)
        if (stage >= 4) {
          // A head on each stalk: upright and green, then golden, heavy and nodding east, with its whiskers.
          const nod = stage >= 5 ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.55)).multiply(tilt) : tilt
          const headUp = up.clone().applyQuaternion(nod)
          add(ear, head, top.clone().addScaledVector(headUp, 0.06), new THREE.Vector3(0.045, 0.12, 0.045), nod)
          if (stage >= 5) add(blade, awn, top.clone().addScaledVector(headUp, 0.15), new THREE.Vector3(0.005, 0.08, 0.005), nod)
        }
      }
      // Two leaves to a plant while it is green, one each way along the row.
      if (stage >= 1 && stage <= 4) {
        for (const side of [-1, 1]) {
          const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side * 0.55))
          add(blade, leaf, new THREE.Vector3(px + side * 0.035, ground + height * 0.35, rowZ), new THREE.Vector3(0.09, 0.008, 0.024), turn)
        }
      }
    }
  }
  made = mergeGeometries(pieces) ?? new THREE.BufferGeometry()
  made.computeVertexNormals()
  cropGeometries.set(stage, made)
  return made
}

// ---- what is put down

// A fence: a post, with rails to each side it joins (`mask`: north 1, east 2, south 4, west 8); with something tied
// to it (`tied`), a rope wound round the post near its top, its end hanging down.
export function fence(mask: number, tied = false): THREE.Group {
  const made = group(part(box(), PALETTE.bark, [0, 0.38, 0], [0.16, 0.76, 0.16]))
  if (tied) {
    for (const [height, turn] of [[0.6, 0.15], [0.65, -0.1], [0.7, 0.2]] as const) {
      made.add(part(box(), PALETTE.rope, [0, height, 0], [0.2, 0.04, 0.2], [0, turn, 0.08]))
    }
    made.add(part(box(), PALETTE.rope, [0.1, 0.62, 0.06], [0.035, 0.07, 0.035], [0, 0, 0.3]))
  }
  const rails: Array<[number, number, number]> = [
    [1, 0, -1],
    [2, 1, 0],
    [4, 0, 1],
    [8, -1, 0],
  ]
  for (const [side, dx, dz] of rails) {
    if (!(mask & side)) continue
    for (const height of [0.28, 0.55]) {
      made.add(part(box(), PALETTE.wood, [dx * 0.26, height, dz * 0.26], [dx ? 0.52 : 0.07, 0.08, dz ? 0.52 : 0.07]))
    }
  }
  return made
}

// A gate: a post at each end of its tile and a swinging leaf of planks between, across x (`across`) or z.
export function gate(across: boolean, open: boolean): THREE.Group {
  const made = new THREE.Group()
  const along = (d: number): [number, number, number] => (across ? [d, 0, 0] : [0, 0, d])
  for (const end of [-0.45, 0.45]) {
    const [px, , pz] = along(end)
    made.add(part(box(), PALETTE.bark, [px, 0.4, pz], [0.14, 0.8, 0.14]))
  }
  const leaf = new THREE.Group()
  for (const height of [0.22, 0.42, 0.62]) leaf.add(part(box(), PALETTE.woodLight, [0.42, height, 0], [0.84, 0.08, 0.06]))
  leaf.add(part(box(), PALETTE.wood, [0.42, 0.42, 0], [0.08, 0.48, 0.07], [0, 0, 0.6]))
  const [hx, , hz] = along(-0.42)
  leaf.position.set(hx, 0, hz)
  leaf.rotation.y = (across ? 0 : -Math.PI / 2) + (open ? -Math.PI / 2 : 0)
  made.add(leaf)
  return made
}

// A stump, with `tool` (an item key) in it: an axe is sunk blade first into its top, its handle up at a slant; a knife
// stuck point first into it, its handle up; any other tool lies on its top (see `restingTool`).
export function stump(tool?: string): THREE.Group {
  const made = group(
    part(cylinder(12), PALETTE.bark, [0, 0.18, 0], [0.74, 0.36, 0.74]),
    // The cut top: pale wood, with its rings.
    part(cylinder(12), PALETTE.woodLight, [0, 0.365, 0], [0.66, 0.02, 0.66]),
    part(cylinder(12), PALETTE.wood, [0, 0.368, 0], [0.46, 0.02, 0.46]),
    part(cylinder(12), PALETTE.woodLight, [0, 0.371, 0], [0.32, 0.02, 0.32]),
    part(cylinder(10), PALETTE.wood, [0, 0.374, 0], [0.12, 0.02, 0.12]),
  )
  // Ridges of bark up its sides, and roots spreading out into the ground.
  for (let i = 0; i < 7; i++) {
    const turn = (i / 7) * Math.PI * 2 + 0.3
    made.add(part(box(), PALETTE.barkDark, [Math.cos(turn) * 0.37, 0.18, Math.sin(turn) * 0.37], [0.05, 0.34, 0.07], [0, -turn, 0]))
  }
  for (const turn of [0.4, 1.9, 3.3, 4.8]) {
    made.add(stick(PALETTE.bark, [Math.cos(turn) * 0.3, 0.14, Math.sin(turn) * 0.3], [Math.cos(turn) * 0.52, 0, Math.sin(turn) * 0.52], 0.1))
  }
  if (tool === 'axe') made.add(axe())
  else if (tool === 'knife') {
    // Point first into the wood, half the blade sunk in, leaning a little.
    const knife = heldModel('knife')!
    knife.scale.setScalar(1.5)
    knife.position.set(0.1, 0.7, 0.02)
    knife.rotation.set(0.2, 0.6, 0.25)
    made.add(knife)
  } else if (tool) {
    const resting = restingTool(tool)
    if (resting) {
      resting.position.set(-0.08, 0.38, 0.04)
      made.add(resting)
    }
  }
  return made
}

// A tool lying on a flat top (its foot at y = 0): an axe, a pickaxe or a knife on its side, its handle along x from
// about x = 0 to x = 0.45; a mortar and pestle standing, the pestle leaning in the bowl. Undefined for anything else.
export function restingTool(key: string): THREE.Group | undefined {
  if (key === 'mortar') return mortar()
  const held = heldModel(key)
  if (!held || !['axe', 'pickaxe', 'knife'].includes(key)) return undefined
  // Turned about its handle so its head lies flat (an axe's blade already does), then laid down along x.
  if (key !== 'axe') held.rotation.y = Math.PI / 2
  const laid = group(held)
  laid.rotation.z = Math.PI / 2
  // Up off the top by half its thickness (the head is the thickest part).
  laid.position.y = key === 'knife' ? 0.02 : 0.035
  return group(laid)
}

// A mortar and pestle: a squat bowl of stone, dark inside, the pestle leaning in it.
function mortar(): THREE.Group {
  return group(
    part(geometry('mortarBowl', () => new THREE.CylinderGeometry(0.5, 0.38, 1, 9)), PALETTE.stone, [0, 0.055, 0], [0.2, 0.11, 0.2]),
    part(cylinder(9), PALETTE.stoneDark, [0, 0.106, 0], [0.15, 0.012, 0.15]),
    stick(PALETTE.stoneDark, [-0.02, 0.07, 0.01], [0.08, 0.24, -0.03], 0.04, 6),
    part(ball(), PALETTE.stoneDark, [0.085, 0.245, -0.032], [0.055, 0.055, 0.055]),
  )
}

// An axe chopped into the top of a stump (y 0.37): its flint blade sunk into the wood, lashed to a handle that sticks
// out, tilted up a little. Built along the handle (y), then laid over.
function axe(): THREE.Group {
  const made = group(
    part(cylinder(6), PALETTE.wood, [0, 0.3, 0], [0.075, 0.62, 0.075]),
    part(lump(), PALETTE.stoneDark, [0.12, 0.05, 0], [0.3, 0.2, 0.08]),
    part(cylinder(6), PALETTE.rope, [0, 0.06, 0], [0.11, 0.12, 0.11]),
  )
  made.position.set(-0.12, 0.4, 0.05)
  made.rotation.set(0, 0.5, -0.85)
  return made
}

// A stick (a cylinder) from one point to another.
function stick(color: number, from: [number, number, number], to: [number, number, number], thick: number, sides = 5): THREE.Mesh {
  const start = new THREE.Vector3(...from)
  const end = new THREE.Vector3(...to)
  const along = end.clone().sub(start)
  const mesh = part(cylinder(sides), color, [0, 0, 0], [thick, along.length(), thick])
  mesh.position.copy(start.clone().add(end).multiplyScalar(0.5))
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize())
  return mesh
}

// A workbench: a thick top of three planks on four legs, braced by rails under the top and stretchers low down, a
// shelf with logs on it, a block for a vice at one end, and on top a stone hammer, a flint knife, a few planks and
// curls of shavings; and the tool in its tool slot (`tool`, an item key), resting on its top at the back.
export function workbench(tool?: string): THREE.Group {
  const made = group()
  // The top: three planks, seams between them.
  for (const z of [-0.23, 0, 0.23]) made.add(part(box(), z === 0 ? PALETTE.woodLight : PALETTE.wood, [0, 0.54, z], [0.96, 0.08, 0.225]))
  for (const z of [-0.115, 0.115]) made.add(part(box(), PALETTE.barkDark, [0, 0.582, z], [0.96, 0.004, 0.012]))
  // Rails under the top, all round.
  made.add(part(box(), PALETTE.bark, [0, 0.46, 0.27], [0.78, 0.08, 0.04]))
  made.add(part(box(), PALETTE.bark, [0, 0.46, -0.27], [0.78, 0.08, 0.04]))
  made.add(part(box(), PALETTE.bark, [-0.38, 0.46, 0], [0.04, 0.08, 0.5]))
  made.add(part(box(), PALETTE.bark, [0.38, 0.46, 0], [0.04, 0.08, 0.5]))
  // The legs, with stretchers between them near the ground and a shelf on those, two logs on it.
  for (const [lx, lz] of [[-0.38, -0.27], [0.38, -0.27], [-0.38, 0.27], [0.38, 0.27]]) {
    made.add(part(box(), PALETTE.bark, [lx, 0.25, lz], [0.09, 0.5, 0.09]))
  }
  for (const lx of [-0.38, 0.38]) made.add(part(box(), PALETTE.barkDark, [lx, 0.12, 0], [0.05, 0.05, 0.56]))
  made.add(part(box(), PALETTE.wood, [0, 0.15, 0], [0.74, 0.03, 0.44]))
  made.add(part(cylinder(7), PALETTE.bark, [-0.12, 0.215, -0.07], [0.1, 0.5, 0.1], [0, 0, Math.PI / 2]))
  made.add(part(cylinder(7), PALETTE.bark, [-0.1, 0.215, 0.06], [0.1, 0.46, 0.1], [0, 0.1, Math.PI / 2]))
  made.add(part(cylinder(7), PALETTE.woodLight, [-0.371, 0.215, -0.07], [0.09, 0.012, 0.09], [0, 0, Math.PI / 2]))
  // A block for a vice at the right-hand end, with its peg.
  made.add(part(box(), PALETTE.bark, [0.44, 0.52, 0.2], [0.1, 0.14, 0.16]))
  made.add(part(cylinder(5), PALETTE.woodLight, [0.5, 0.52, 0.2], [0.025, 0.12, 0.025], [0, 0, Math.PI / 2]))
  const resting = tool ? restingTool(tool) : undefined
  if (!resting) {
    // With no tool in it: a stone hammer (its handle, and its head lashed on), and a flint knife.
    made.add(stick(PALETTE.woodLight, [0.06, 0.6, 0.2], [0.2, 0.6, -0.02], 0.035))
    made.add(part(lump(), PALETTE.stone, [0.21, 0.62, -0.035], [0.14, 0.09, 0.09], [0, 1, 0]))
    made.add(part(box(), PALETTE.rope, [0.205, 0.62, -0.027], [0.05, 0.1, 0.1], [0, 1, 0]))
    made.add(part(box(), PALETTE.wood, [-0.12, 0.595, 0.18], [0.1, 0.025, 0.035], [0, -0.3, 0]))
    made.add(part(cone(4), PALETTE.stoneDark, [-0.22, 0.595, 0.21], [0.04, 0.14, 0.015], [0, -0.3, Math.PI / 2]))
  }
  // A couple of planks, and shavings.
  made.add(part(box(), PALETTE.woodLight, [-0.22, 0.6, -0.14], [0.42, 0.03, 0.11], [0, 0.08, 0]))
  made.add(part(box(), PALETTE.wood, [-0.2, 0.63, -0.13], [0.4, 0.03, 0.1], [0, -0.05, 0]))
  for (const [sx, sz] of [[0.02, 0.02], [0.08, -0.08], [-0.02, 0.12], [0.3, 0.14]]) {
    made.add(part(cylinder(5), 0xe6c690, [sx, 0.592, sz], [0.04, 0.01, 0.04]))
  }
  // The tool in its slot, resting at the front of the top, where it is seen (in place of the hammer and knife).
  if (resting) {
    if (tool === 'mortar') resting.position.set(0.12, 0.58, 0.08)
    else {
      resting.position.set(-0.05, 0.58, 0.16)
      resting.rotation.y = 0.15
      resting.scale.setScalar(1.15)
    }
    made.add(resting)
  }
  return made
}

// A campfire: a ring of rough stones round a bed of ash, logs leant together over it, and forked sticks either side
// holding a spit. Lit, embers glow among the logs and flames (named, so they can flicker) rise from them; out, the
// logs are charred.
export function campfire(lit: boolean): THREE.Group {
  const made = new THREE.Group()
  for (let i = 0; i < 11; i++) {
    const angle = (i / 11) * Math.PI * 2
    const big = 0.15 + ((i * 7) % 5) * 0.015
    const shade = i % 3 === 0 ? PALETTE.stoneDark : i % 3 === 1 ? PALETTE.stone : 0x7d8086
    made.add(part(lump(), shade, [Math.cos(angle) * 0.36, 0.06, Math.sin(angle) * 0.36], [big, big * 0.75, big], [0, angle * 2, 0.2]))
  }
  made.add(part(cylinder(10), PALETTE.ash, [0, 0.012, 0], [0.56, 0.02, 0.56]))
  made.add(part(cylinder(10), PALETTE.char, [0, 0.02, 0], [0.34, 0.02, 0.34]))
  // The logs, leant together like a tent, their ends charred where they meet.
  const logs = 5
  for (let i = 0; i < logs; i++) {
    const angle = (i / logs) * Math.PI * 2 + 0.4
    const foot: [number, number, number] = [Math.cos(angle) * 0.24, 0.03, Math.sin(angle) * 0.24]
    const top: [number, number, number] = [Math.cos(angle) * 0.03, 0.36, Math.sin(angle) * 0.03]
    const charFrom: [number, number, number] = [Math.cos(angle) * 0.075, 0.29, Math.sin(angle) * 0.075]
    made.add(stick(i % 2 ? PALETTE.bark : PALETTE.barkDark, foot, top, 0.075, 6))
    made.add(stick(PALETTE.char, charFrom, top, 0.08, 6))
  }
  // Forked sticks either side, and a spit between them.
  for (const side of [-1, 1]) {
    made.add(stick(PALETTE.bark, [side * 0.46, 0, 0], [side * 0.46, 0.56, 0], 0.035))
    made.add(stick(PALETTE.bark, [side * 0.46, 0.5, 0], [side * 0.46, 0.62, 0.05], 0.025))
    made.add(stick(PALETTE.bark, [side * 0.46, 0.5, 0], [side * 0.46, 0.62, -0.05], 0.025))
  }
  made.add(stick(PALETTE.woodLight, [-0.54, 0.555, 0], [0.54, 0.555, 0], 0.025))
  if (lit) {
    // Embers glowing among the logs.
    for (const [ex, ez] of [[0.08, 0.02], [-0.07, 0.06], [0.02, -0.09], [-0.1, -0.05], [0.12, -0.04]]) {
      const ember = new THREE.Mesh(lump(), new THREE.MeshBasicMaterial({ color: ex > 0 ? 0xff5a1a : 0xff8a2a }))
      ember.position.set(ex, 0.05, ez)
      ember.scale.set(0.08, 0.05, 0.08)
      made.add(ember)
    }
    // Flames: a tall one in the middle and lower tongues round it, each with a bright core.
    const flame = (color: number, at: [number, number, number], scale: [number, number, number]): void => {
      const mesh = new THREE.Mesh(cone(6), new THREE.MeshBasicMaterial({ color }))
      mesh.position.set(...at)
      mesh.scale.set(...scale)
      mesh.name = 'flame'
      made.add(mesh)
    }
    flame(PALETTE.flame, [0, 0.3, 0], [0.3, 0.52, 0.3])
    flame(PALETTE.flameCore, [0, 0.24, 0], [0.16, 0.34, 0.16])
    for (const angle of [0.6, 2.7, 4.6]) {
      flame(0xff6a1a, [Math.cos(angle) * 0.1, 0.18, Math.sin(angle) * 0.1], [0.14, 0.3, 0.14])
      flame(PALETTE.flameCore, [Math.cos(angle) * 0.1, 0.14, Math.sin(angle) * 0.1], [0.07, 0.16, 0.07])
    }
  }
  return made
}

// A makeshift oven, after its icon: a beehive dome of rough stones laid in courses that touch and cover it all over
// (the dome itself is solid underneath, so no gap shows through), an arched dark mouth at the front (+z) framed by
// stones, and a short stone chimney on top. It stands straight on the ground. Lit, the mouth glows and flames (named, so
// they flicker) lick out of it.
const OVEN_RADIUS = 0.42
const OVEN_HEIGHT = 0.5
const OVEN_SHADES = [PALETTE.stone, PALETTE.stoneDark, 0x7d8086, 0x9a9ca0]
export function oven(lit: boolean): THREE.Group {
  const made = group()
  // The dome under the stones: the top half of a squashed sphere, in the stones' darkest colour, so the gaps between
  // them read as mortar.
  const dome = new THREE.Mesh(geometry('ovenDome', () => new THREE.SphereGeometry(0.5, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2)), material(0x5a5c60))
  dome.scale.set(OVEN_RADIUS * 2, OVEN_HEIGHT * 2, OVEN_RADIUS * 2)
  dome.castShadow = true
  dome.receiveShadow = true
  made.add(dome)
  // Where the mouth is: an arch at the front, `MOUTH_HALF` across either side of the middle and up to `MOUTH_TOP`.
  const MOUTH_HALF = 0.13
  const MOUTH_TOP = 0.27
  const inMouth = (x: number, y: number, z: number): boolean => z > 0 && Math.abs(x) < MOUTH_HALF + 0.03 && y < MOUTH_TOP + 0.03
  // The courses of stones, bottom to top: each a ring round the dome at an angle up from the ground, its stones as wide
  // as fits the ring with a little overlap, sunk half into the dome and turned to lie along it.
  const courses = 6
  for (let c = 0; c < courses; c++) {
    const up = ((c + 0.35) / courses) * (Math.PI / 2) * 0.92
    const ring = OVEN_RADIUS * Math.cos(up)
    const y = OVEN_HEIGHT * Math.sin(up)
    const count = Math.max(5, Math.round((Math.PI * 2 * ring) / 0.15))
    const wide = ((Math.PI * 2 * ring) / count) * 1.25
    const tall = (OVEN_HEIGHT / courses) * 1.7
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (c % 2) * (Math.PI / count)
      const x = Math.cos(angle) * ring
      const z = Math.sin(angle) * ring
      if (inMouth(x, y, z)) continue
      const normal = new THREE.Vector3(x / (OVEN_RADIUS * OVEN_RADIUS), y / (OVEN_HEIGHT * OVEN_HEIGHT), z / (OVEN_RADIUS * OVEN_RADIUS)).normalize()
      const shade = OVEN_SHADES[(i * 3 + c * 5) % OVEN_SHADES.length]
      const jitter = 0.9 + ((i * 7 + c * 3) % 5) * 0.05
      const stone = part(lump(), shade, [x, y, z], [wide * jitter, tall * jitter, 0.1])
      stone.lookAt(new THREE.Vector3(x, y, z).add(normal))
      made.add(stone)
    }
  }
  // A cap stone over the top, under the chimney.
  made.add(part(lump(), PALETTE.stone, [0, OVEN_HEIGHT - 0.03, 0], [0.26, 0.1, 0.26]))
  // The mouth: dark inside, an arch (a box with a half-disc on top) set back into the front of the dome, a little
  // narrower than the stones framing it, so its edges are tucked in behind them. The box stops where the half-disc
  // starts, so no two faces of it lie on one another.
  const mouthZ = OVEN_RADIUS * 0.9
  const inside = lit ? 0x2a1208 : 0x1a1816
  const mouthBack = mouthZ - 0.05
  const arch = MOUTH_HALF * 0.92
  made.add(part(box(), inside, [0, (MOUTH_TOP - MOUTH_HALF) / 2, mouthBack], [arch * 2, MOUTH_TOP - MOUTH_HALF, 0.12]))
  made.add(part(geometry('ovenArch', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false, Math.PI / 2, Math.PI)), inside, [0, MOUTH_TOP - MOUTH_HALF, mouthBack], [arch * 2, 0.12, arch * 2], [Math.PI / 2, 0, 0]))
  const frame = 9
  for (let i = 0; i < frame; i++) {
    // Up one side, over the arch, and down the other.
    const t = i / (frame - 1)
    const angle = Math.PI * (1 - t)
    const fx = Math.cos(angle) * (MOUTH_HALF + 0.05)
    const fy = MOUTH_TOP - MOUTH_HALF + Math.max(0, Math.sin(angle)) * (MOUTH_HALF + 0.05) - (i === 0 || i === frame - 1 ? 0.1 : 0)
    made.add(part(lump(), OVEN_SHADES[i % OVEN_SHADES.length], [fx, fy, mouthZ + 0.03], [0.11, 0.1, 0.18], [0, 0, angle]))
  }
  for (const side of [-1, 1]) made.add(part(lump(), PALETTE.stoneDark, [side * (MOUTH_HALF + 0.05), 0.05, mouthZ + 0.04], [0.12, 0.11, 0.1]))
  // The chimney: a short stack of stones, dark at its mouth.
  for (let i = 0; i < 2; i++) {
    made.add(part(cylinder(7), i === 0 ? PALETTE.stoneDark : PALETTE.stone, [0, OVEN_HEIGHT + 0.03 + i * 0.07, -0.02], [0.17 - i * 0.015, 0.08, 0.17 - i * 0.015], [0, i * 0.4, 0]))
  }
  made.add(part(cylinder(7), 0x141312, [0, OVEN_HEIGHT + 0.145, -0.02], [0.1, 0.01, 0.1]))
  if (lit) {
    const glow = new THREE.Mesh(box(), new THREE.MeshBasicMaterial({ color: 0xff6a1a }))
    // Just in front of the dark inside (never on it), behind the frame stones.
    glow.position.set(0, 0.07, mouthZ + 0.03)
    glow.scale.set(MOUTH_HALF * 1.6, 0.08, 0.02)
    made.add(glow)
    for (const [fx, height] of [[-0.05, 0.13], [0.05, 0.1], [0, 0.17]] as const) {
      const flame = new THREE.Mesh(cone(6), new THREE.MeshBasicMaterial({ color: fx === 0 ? PALETTE.flameCore : PALETTE.flame }))
      flame.position.set(fx, 0.06 + height / 2, mouthZ + 0.05)
      flame.scale.set(0.07, height, 0.07)
      flame.name = 'flame'
      made.add(flame)
    }
  }
  return made
}

// A barrel, open at the top: a round-bellied cask of thick staves (its wall has an inside and an outside, and a rim
// across the top between them), bound by two dark hoops. What is in it shows, a liquid at its level in its colour, or a
// heap of rotting compost (with flies over it) while it is making compost; sealed, a lid with a handle covers it.
export const BARREL_TOP = 0.74
const BARREL_WALL = 0.05
// Its outline from the bottom up: [radius, height], bellied out in the middle.
const BARREL_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.27, 0],
  [0.305, 0.12],
  [0.325, 0.26],
  [0.33, 0.37],
  [0.325, 0.48],
  [0.305, 0.62],
  [0.28, BARREL_TOP],
]
// How wide it is at a height (between the points of its outline).
function barrelRadius(y: number): number {
  for (let i = 1; i < BARREL_PROFILE.length; i++) {
    const [r0, y0] = BARREL_PROFILE[i - 1]
    const [r1, y1] = BARREL_PROFILE[i]
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0)
  }
  return BARREL_PROFILE[BARREL_PROFILE.length - 1][0]
}
export function barrel(sealed = false, liquid = '', fill = 0, composting = false): THREE.Group {
  const lathe = (key: string, inset: number): THREE.BufferGeometry =>
    geometry(key, () => new THREE.LatheGeometry(BARREL_PROFILE.map(([r, y]) => new THREE.Vector2(r - inset, y)), 14))
  const outside = new THREE.Mesh(lathe('barrelOut', 0), material(PALETTE.wood))
  const inside = new THREE.Mesh(lathe('barrelIn', BARREL_WALL), bothSides(PALETTE.bark))
  const topRadius = BARREL_PROFILE[BARREL_PROFILE.length - 1][0]
  const rim = new THREE.Mesh(geometry('barrelRim', () => new THREE.RingGeometry(topRadius - BARREL_WALL, topRadius, 14, 1)), bothSides(PALETTE.woodLight))
  rim.rotation.x = -Math.PI / 2
  rim.position.y = BARREL_TOP
  for (const mesh of [outside, inside]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  const bottom = (0.27 - BARREL_WALL) * 2
  const made = group(outside, inside, rim, part(cylinder(14), PALETTE.barkDark, [0, 0.04, 0], [bottom, 0.08, bottom]))
  // Dark grooves between the staves, up the outside: thin strips that follow its bellied outline all the way up, lying
  // on the staves (a narrow slice of the same outline, a hair further out).
  const groove = geometry('barrelGroove', () => new THREE.LatheGeometry(BARREL_PROFILE.slice(0).map(([r, y]) => new THREE.Vector2(r + 0.003, Math.min(BARREL_TOP - 0.01, Math.max(0.01, y)))), 1, 0, 0.035))
  for (let i = 0; i < 10; i++) {
    const strip = new THREE.Mesh(groove, bothSides(PALETTE.bark))
    strip.rotation.y = (i / 10) * Math.PI * 2
    strip.receiveShadow = true
    made.add(strip)
  }
  // The hoops: open bands lying on the staves, each sloping with the outline where it sits (open, so they never cover
  // what is inside).
  for (const y of [0.13, 0.61]) {
    const half = 0.035
    const bottomR = barrelRadius(y - half) + 0.006
    const topR = barrelRadius(y + half) + 0.006
    const hoop = new THREE.Mesh(geometry(`barrelHoop${y}`, () => new THREE.CylinderGeometry(topR, bottomR, half * 2, 14, 1, true)), bothSides(PALETTE.barkDark))
    hoop.position.set(0, y, 0)
    hoop.castShadow = true
    made.add(hoop)
  }
  if (sealed) {
    const lid = (topRadius + 0.01) * 2
    made.add(part(cylinder(14), PALETTE.woodLight, [0, BARREL_TOP + 0.015, 0], [lid, 0.04, lid]))
    made.add(part(box(), PALETTE.bark, [0, BARREL_TOP + 0.055, 0], [0.3, 0.05, 0.07]))
    return made
  }
  if (liquid && fill > 0) {
    const y = 0.08 + (BARREL_TOP - 0.14) * Math.min(1, fill)
    const r = barrelRadius(y) - BARREL_WALL - 0.004
    const surface = new THREE.Mesh(cylinder(14), material(liquidLook(liquid).color))
    surface.position.set(0, y, 0)
    surface.scale.set(r * 2, 0.02, r * 2)
    made.add(surface)
  }
  if (composting) {
    made.add(part(lump(), PALETTE.soil, [0, 0.64, 0], [0.46, 0.18, 0.46]))
    made.add(part(lump(), PALETTE.leafDark, [0.1, 0.7, -0.05], [0.12, 0.08, 0.12]))
    for (const [fx, fy, fz] of [[0.12, 0.97, 0.05], [-0.1, 1.07, -0.08], [0.02, 1.17, 0.12]]) made.add(part(ball(), 0x1c1a16, [fx, fy, fz], [0.035, 0.035, 0.035]))
  }
  return made
}

// A well, after its icon: a round wall of grey stones with water deep inside (the colour of a pond), two wooden posts holding a pitched
// roof of planks, and a crossbar between them with a rope wound on it, a bucket hanging from it over the water.
const WELL_WATER = new THREE.MeshStandardMaterial({ color: POND_COLOR, roughness: 1, metalness: 0 })
export function well(): THREE.Group {
  const made = group()
  const shades = [PALETTE.stone, PALETTE.stoneDark, 0x7b7f81, 0x9a9ca0]
  // The wall: a solid ring under courses of stones laid round it.
  const wall = new THREE.Mesh(geometry('wellWall', () => new THREE.CylinderGeometry(0.36, 0.38, 0.42, 14, 1, true)), bothSides(0x55595b))
  wall.position.y = 0.21
  wall.castShadow = true
  wall.receiveShadow = true
  made.add(wall)
  for (let course = 0; course < 3; course++) {
    const count = 12
    for (let i = 0; i < count; i++) {
      const turn = ((i + (course % 2) * 0.5) / count) * Math.PI * 2
      const stone = part(lump(), shades[(i + course * 2) % shades.length], [Math.cos(turn) * 0.37, 0.07 + course * 0.14, Math.sin(turn) * 0.37], [0.22, 0.15, 0.12])
      stone.rotation.y = -turn + Math.PI / 2
      made.add(stone)
    }
  }
  // The coping round the top, and the water down inside.
  made.add(part(geometry('wellCoping', () => new THREE.TorusGeometry(0.36, 0.05, 5, 14)), 0x9a9ca0, [0, 0.43, 0], [1, 1, 1], [Math.PI / 2, 0, 0]))
  // Lit like the ponds' water on the ground (not darkened by the wall's shadow), so it is the same blue.
  const water = new THREE.Mesh(cylinder(14), WELL_WATER)
  water.position.set(0, 0.16, 0)
  water.scale.set(0.66, 0.02, 0.66)
  made.add(water)
  // The posts, the crossbar with its rope, and the bucket.
  for (const side of [-1, 1]) made.add(part(box(), PALETTE.bark, [side * 0.33, 0.46, 0], [0.07, 0.92, 0.07]))
  made.add(stick(PALETTE.wood, [-0.38, 0.7, 0], [0.38, 0.7, 0], 0.05, 6))
  made.add(part(cylinder(8), PALETTE.rope, [0, 0.7, 0], [0.08, 0.2, 0.08], [0, 0, Math.PI / 2]))
  made.add(stick(PALETTE.rope, [0, 0.68, 0], [0, 0.56, 0], 0.012, 4))
  made.add(part(cylinder(8), PALETTE.wood, [0, 0.5, 0], [0.12, 0.12, 0.12]))
  made.add(part(cylinder(8), PALETTE.barkDark, [0, 0.53, 0], [0.13, 0.02, 0.13]))
  // The roof: two steep slopes meeting along a ridge over the crossbar, narrow enough that the water shows. Each slope
  // is a row of planks running down it, side by side with thin gaps between, each a little different in shade, length
  // and lie, held together by two battens across them, pegged at each plank; a ridge beam caps the top.
  const planks = 6
  const span = 0.86
  const shadesOf = [PALETTE.wood, PALETTE.woodLight, 0x8a6640, PALETTE.wood, 0xa87c4e, 0x94693f]
  for (const side of [-1, 1]) {
    const slope = group()
    slope.position.set(0, 0.86, side * 0.14)
    slope.rotation.x = side * 0.75
    for (let i = 0; i < planks; i++) {
      const x = -span / 2 + (i + 0.5) * (span / planks)
      const long = 0.36 + ((i * 7 + (side > 0 ? 3 : 0)) % 5) * 0.012
      const plank = part(box(), shadesOf[(i + (side > 0 ? 2 : 0)) % shadesOf.length], [x, ((i * 5) % 3) * 0.003, side * (long - 0.36) * 0.4], [span / planks - 0.012, 0.03, long])
      plank.rotation.set(0, ((i * 3) % 5 - 2) * 0.012, ((i % 3) - 1) * 0.03)
      slope.add(plank)
    }
    // The battens across the planks, near the top and the foot of the slope, and a peg through each into each plank.
    for (const z of [-0.11, 0.11]) {
      slope.add(part(box(), PALETTE.bark, [0, 0.026, z], [span + 0.04, 0.024, 0.045]))
      for (let i = 0; i < planks; i++) {
        slope.add(part(box(), PALETTE.barkDark, [-span / 2 + (i + 0.5) * (span / planks), 0.04, z], [0.014, 0.008, 0.014]))
      }
    }
    made.add(slope)
  }
  made.add(part(box(), PALETTE.barkDark, [0, 0.985, 0], [0.92, 0.055, 0.06]))
  return made
}

// An altar, after its icon: a low slab of dark stone set with knuckles of bone, a deep basin of dark stone on it, empty
// (a ritual fills it with blood: see ritual-effects.ts), and either side of it a great curved bone horn rising and
// hooking in over the basin, streaked with blood from the tip down.
const ALTAR = { stone: 0x2c2830, stoneLight: 0x433d48, stoneDark: 0x1b181e, blood: 0x7a0f1a, bloodDark: 0x5a0a14 }
// The basin: open at the top, from its floor up to just under its rim, wider at the top (tiles, on the altar's middle).
const BASIN = { bottom: 0.15, height: 0.22, top: 0.25, foot: 0.19, wall: 0.025 }
export const ALTAR_BOWL = {
  floor: 0.2,
  brim: BASIN.bottom + BASIN.height - 0.025,
  // How far across the inside of the basin is at a height.
  radius: (y: number): number => BASIN.foot + ((y - BASIN.bottom) / BASIN.height) * (BASIN.top - BASIN.foot) - BASIN.wall,
  color: ALTAR.blood,
}
// Where what is on an altar or a pedestal floats, over the middle of its tile (tiles up).
export const ALTAR_HOLD_Y = 1.04
export const PEDESTAL_HOLD_Y = 0.98
export function altar(): THREE.Group {
  const made = group()
  // The slab, a lip of lighter stone round its top, and bone set into its front and back like the icon's pale knuckles.
  made.add(part(box(), ALTAR.stone, [0, 0.07, 0], [0.78, 0.14, 0.62]))
  made.add(part(box(), ALTAR.stoneLight, [0, 0.145, 0], [0.72, 0.03, 0.56]))
  for (const z of [-0.31, 0.31]) {
    for (const [x, s] of [[-0.26, 0.11], [-0.08, 0.08], [0.1, 0.1], [0.27, 0.09]] as const) {
      made.add(part(lump(), x < 0 ? PALETTE.bone : PALETTE.boneDark, [x, 0.07, z], [s, s * 0.8, s * 0.55]))
    }
  }
  // The basin: a squat bowl of dark stone, open at the top (its inside seen from above), a floor down in it, and its rim.
  const basin = new THREE.Mesh(
    geometry('altarBasin', () => new THREE.CylinderGeometry(BASIN.top, BASIN.foot, BASIN.height, 10, 1, true)),
    bothSides(ALTAR.stoneDark),
  )
  basin.position.y = BASIN.bottom + BASIN.height / 2
  basin.castShadow = true
  basin.receiveShadow = true
  made.add(basin)
  const floorAcross = ALTAR_BOWL.radius(ALTAR_BOWL.floor) * 2 + 0.02
  made.add(part(cylinder(10), 0x120f14, [0, ALTAR_BOWL.floor - 0.01, 0], [floorAcross, 0.02, floorAcross]))
  made.add(part(geometry('altarRim', () => new THREE.TorusGeometry(0.24, 0.035, 5, 10)), ALTAR.stoneLight, [0, 0.37, 0], [1, 1, 1], [Math.PI / 2, 0, 0]))
  // A spill down the front of the basin and pooled on the slab.
  made.add(part(box(), ALTAR.blood, [0.06, 0.27, 0.215], [0.07, 0.18, 0.02], [0.12, 0, 0]))
  made.add(part(ball(), ALTAR.bloodDark, [0.07, 0.165, 0.25], [0.16, 0.02, 0.1]))
  // The horns: each a run of bone segments, thick at the foot and tapering, rising outward from the slab's ends, then
  // curling in over the basin, with a socket of dark stone at the foot and blood running down from the tip.
  const curve: Array<[number, number]> = [[0.3, 0.14], [0.34, 0.34], [0.35, 0.52], [0.32, 0.68], [0.25, 0.8], [0.17, 0.86]]
  for (const side of [-1, 1]) {
    made.add(part(cylinder(8), ALTAR.stoneDark, [side * 0.3, 0.17, 0], [0.16, 0.08, 0.16]))
    for (let i = 0; i + 1 < curve.length; i++) {
      const [x0, y0] = curve[i]
      const [x1, y1] = curve[i + 1]
      const thick = 0.11 - i * 0.017
      made.add(stick(i % 2 === 0 ? PALETTE.bone : PALETTE.horn, [side * x0, y0, 0], [side * x1, y1, 0], thick, 7))
      // Blood on the upper part of the horn's inner side, running down from the tip.
      if (i >= 2) made.add(stick(i === 4 ? ALTAR.blood : ALTAR.bloodDark, [side * (x0 - 0.035), y0, 0.02], [side * (x1 - 0.03), y1, 0.02], thick * 0.55, 5))
    }
    // A ring of darker bone where it narrows, and a drop hanging from the tip.
    made.add(part(geometry('altarHornRing', () => new THREE.TorusGeometry(0.05, 0.016, 4, 8)), PALETTE.boneDark, [side * 0.345, 0.43, 0], [1, 1, 1], [Math.PI / 2, 0, 0]))
    made.add(part(ball(), ALTAR.blood, [side * 0.16, 0.83, 0], [0.04, 0.06, 0.04]))
  }
  return made
}

// A pedestal, after its icon: dark slate-grey stone, a broad flared foot on a step, a slim waisted column, and a wide
// square top slab over a collar, its top face catching the light.
const PEDESTAL = { stone: 0x4a4a5e, light: 0x7c7e98, dark: 0x2e2e3e }
// The top of a pedestal (tiles up), where what is drawn off it to an altar leaves from.
export const PEDESTAL_TOP = 0.725
export function pedestal(): THREE.Group {
  const made = group()
  made.add(part(box(), PEDESTAL.dark, [0, 0.04, 0], [0.56, 0.08, 0.56]))
  made.add(part(geometry('pedestalFoot', () => new THREE.CylinderGeometry(0.17, 0.25, 1, 4)), PEDESTAL.stone, [0, 0.13, 0], [1, 0.1, 1], [0, Math.PI / 4, 0]))
  made.add(part(geometry('pedestalColumn', () => new THREE.CylinderGeometry(0.1, 0.12, 1, 8)), PEDESTAL.stone, [0, 0.36, 0], [1, 0.36, 1]))
  // A lighter edge down the column's front, as the icon's highlight.
  made.add(part(box(), PEDESTAL.light, [-0.05, 0.36, 0.095], [0.03, 0.34, 0.02]))
  made.add(part(geometry('pedestalCollar', () => new THREE.CylinderGeometry(0.25, 0.14, 1, 4)), PEDESTAL.stone, [0, 0.58, 0], [1, 0.08, 1], [0, Math.PI / 4, 0]))
  made.add(part(box(), PEDESTAL.stone, [0, 0.67, 0], [0.6, 0.1, 0.6]))
  made.add(part(box(), PEDESTAL.light, [0, 0.722, 0], [0.54, 0.006, 0.54]))
  made.add(part(box(), PEDESTAL.dark, [0, 0.617, 0], [0.62, 0.012, 0.62]))
  return made
}

// A waystone, after its icon: a tall slab of blue-grey stone with a rounded top, standing on a dark plinth, lit from
// the upper left (a pale edge down its left, a dark one down its right, a pale crown), dark runes cut in its face, and up
// each edge of its face a row of sockets, with a keystone socket at the top, which light up as it charges (see
// waystone-effects.ts, which draws the light over them at WAYSTONE_LIGHTS).
const WAYSTONE = {
  stone: 0x6f7186,
  light: 0x878ca7,
  crown: 0xafb5cc,
  dark: 0x26213d,
  plinth: 0x2e2f37,
  step: 0x656879,
  rune: 0x14131b,
  socket: 0x34405a,
}
const WAYSTONE_HALF = 0.28
const WAYSTONE_DEPTH = 0.26
const WAYSTONE_SHOULDER = 1.08
// The face of a waystone, how far in front of its middle (tiles).
export const WAYSTONE_FACE = WAYSTONE_DEPTH / 2
// Where each of a waystone's lights is (tiles, from its tile's middle on the ground), level by level from the bottom
// (a pair a level, left then right), the keystone last.
export const WAYSTONE_LIGHTS: ReadonlyArray<{ x: number; y: number; level: number }> = [
  ...Array.from({ length: WARP_LIGHT_LEVELS }, (_, level) => {
    const y = 0.3 + (level * (WAYSTONE_SHOULDER - 0.3)) / (WARP_LIGHT_LEVELS - 1)
    return [
      { x: -0.19, y, level },
      { x: 0.19, y, level },
    ]
  }).flat(),
  { x: 0, y: WAYSTONE_SHOULDER + 0.15, level: WARP_LIGHT_LEVELS },
]
export function waystone(): THREE.Group {
  const made = group()
  // The plinth and the step on it.
  made.add(part(box(), WAYSTONE.plinth, [0, 0.05, 0], [0.84, 0.1, 0.5]))
  made.add(part(box(), WAYSTONE.step, [0, 0.13, 0], [0.7, 0.06, 0.4]))
  // The slab, and its rounded top: half a disc of stone as thick as the slab.
  const tall = WAYSTONE_SHOULDER - 0.16
  made.add(part(box(), WAYSTONE.stone, [0, 0.16 + tall / 2, 0], [WAYSTONE_HALF * 2, tall, WAYSTONE_DEPTH]))
  made.add(
    part(
      geometry('waystoneTop', () => new THREE.CylinderGeometry(WAYSTONE_HALF, WAYSTONE_HALF, WAYSTONE_DEPTH, 12, 1, false, -Math.PI / 2, Math.PI)),
      WAYSTONE.stone,
      [0, WAYSTONE_SHOULDER, 0],
      [1, 1, 1],
      [-Math.PI / 2, 0, 0],
    ),
  )
  // Its light from the upper left: a pale edge down the left of its face, a dark one down the right, a pale crown.
  const front = WAYSTONE_FACE + 0.004
  made.add(part(box(), WAYSTONE.light, [-WAYSTONE_HALF + 0.03, 0.16 + tall / 2, front], [0.05, tall, 0.01]))
  made.add(part(box(), WAYSTONE.dark, [WAYSTONE_HALF - 0.025, 0.16 + tall / 2, front], [0.05, tall, 0.01]))
  made.add(part(box(), WAYSTONE.dark, [WAYSTONE_HALF + 0.002, 0.16 + tall / 2, 0], [0.01, tall, WAYSTONE_DEPTH]))
  made.add(
    part(
      geometry('waystoneCrown', () => new THREE.TorusGeometry(WAYSTONE_HALF - 0.03, 0.025, 3, 10, Math.PI * 0.7)),
      WAYSTONE.crown,
      [0, WAYSTONE_SHOULDER, front],
      [1, 1, 1],
      [0, 0, Math.PI * 0.3],
    ),
  )
  // A darker band at its foot, where it meets the plinth.
  made.add(part(box(), WAYSTONE.step, [0, 0.2, front], [WAYSTONE_HALF * 2 - 0.02, 0.08, 0.01]))
  // The runes cut down the middle of its face.
  for (const [x, y, w, h] of [
    [0.02, 0.92, 0.05, 0.05],
    [-0.02, 0.8, 0.1, 0.03],
    [0.03, 0.72, 0.03, 0.1],
    [-0.03, 0.6, 0.08, 0.03],
    [0.0, 0.5, 0.03, 0.12],
    [0.02, 0.38, 0.1, 0.03],
  ] as const) {
    made.add(part(box(), WAYSTONE.rune, [x, y, front + 0.002], [w, h, 0.01]))
  }
  // The sockets the lights come on in.
  for (const light of WAYSTONE_LIGHTS) {
    const size = light.level === WARP_LIGHT_LEVELS ? 0.08 : 0.06
    made.add(part(box(), WAYSTONE.rune, [light.x, light.y, front + 0.001], [size + 0.025, size + 0.025, 0.01]))
    made.add(part(box(), WAYSTONE.socket, [light.x, light.y, front + 0.004], [size, size, 0.01]))
  }
  return made
}

// A worker skeleton (waiting for orders: it does nothing yet), facing out of its tile towards the camera: a skeleton
// standing easy, a heart of essence glowing blue in its ribs and in its eyes, a leather apron, and a pickaxe slung on
// its back.
export function workerSkeleton(): THREE.Group {
  const essence = new THREE.MeshBasicMaterial({ color: 0x8fd6ff })
  const glow = (at: [number, number, number], scale: [number, number, number]): THREE.Mesh => {
    const mesh = new THREE.Mesh(box(), essence)
    mesh.position.set(...at)
    mesh.scale.set(...scale)
    return mesh
  }
  const body = group(
    // The spine, ribs and hips.
    part(box(), PALETTE.bone, [0, 0.62, 0], [0.06, 0.42, 0.06]),
    part(box(), PALETTE.bone, [0, 0.72, 0], [0.12, 0.05, 0.3]),
    part(box(), PALETTE.bone, [0, 0.64, 0], [0.12, 0.05, 0.27]),
    part(box(), PALETTE.bone, [0, 0.56, 0], [0.1, 0.05, 0.22]),
    part(box(), PALETTE.boneDark, [0, 0.42, 0], [0.12, 0.08, 0.26]),
    // The heart of essence in its ribs.
    glow([0.03, 0.64, 0], [0.07, 0.07, 0.07]),
    // The skull, and its eyes glowing blue.
    part(box(), PALETTE.bone, [0.02, 0.96, 0], [0.22, 0.22, 0.22]),
    part(box(), PALETTE.boneDark, [0.06, 0.86, 0], [0.16, 0.06, 0.16]),
    glow([0.135, 0.98, -0.055], [0.02, 0.05, 0.05]),
    glow([0.135, 0.98, 0.055], [0.02, 0.05, 0.05]),
    // Both arms hanging.
    part(box(), PALETTE.bone, [0.02, 0.6, -0.19], [0.05, 0.3, 0.05], [0.12, 0, 0]),
    part(box(), PALETTE.bone, [0.02, 0.6, 0.19], [0.05, 0.3, 0.05], [-0.12, 0, 0]),
    // The leather apron on a belt, over its hips.
    part(box(), PALETTE.rust, [0.07, 0.44, 0], [0.02, 0.06, 0.3]),
    part(box(), 0x8a5a3a, [0.08, 0.33, 0], [0.02, 0.22, 0.2]),
    // The legs.
    part(box(), PALETTE.bone, [0, 0.19, -0.07], [0.06, 0.4, 0.06]),
    part(box(), PALETTE.bone, [0, 0.19, 0.07], [0.06, 0.4, 0.06]),
  )
  // The pickaxe slung across its back, handle up to the right.
  const pick = group(
    stick(PALETTE.wood, [0, -0.25, 0], [0, 0.25, 0], 0.025),
    part(box(), 0x6c7280, [0, 0.25, 0], [0.04, 0.05, 0.3]),
    part(cone(4), 0x6c7280, [0, 0.25, 0.18], [0.04, 0.08, 0.04], [Math.PI / 2, 0, 0]),
    part(cone(4), 0x6c7280, [0, 0.25, -0.18], [0.04, 0.08, 0.04], [-Math.PI / 2, 0, 0]),
  )
  pick.position.set(-0.08, 0.66, 0)
  pick.rotation.x = 0.6
  body.add(pick)
  // Facing out of its tile, towards the camera.
  body.rotation.y = -Math.PI / 2
  return group(body)
}

// A drying rack: its frame alone; with a fresh hide hung over it, wet and dark red-brown, sagging; or with the dried
// hide, pale, flat and stiff, waiting to be taken.
export function rack(state: 'empty' | 'drying' | 'done' = 'empty'): THREE.Group {
  const made = group()
  // Each end: two poles splayed apart at the foot and lashed together at the top.
  for (const x of [-0.38, 0.38]) {
    for (const z of [-0.2, 0.2]) made.add(stick(PALETTE.bark, [x, 0, z], [x, 0.94, -z * 0.15], 0.06))
    made.add(part(cylinder(6), PALETTE.rope, [x, 0.86, 0], [0.09, 0.07, 0.09]))
  }
  // The pole across the top, and a lower one across the back to brace it.
  made.add(stick(PALETTE.bark, [-0.48, 0.87, 0], [0.48, 0.87, 0], 0.055))
  made.add(stick(PALETTE.barkDark, [-0.38, 0.28, -0.15], [0.38, 0.28, -0.15], 0.04))
  if (state === 'drying') {
    // A fresh hide over the pole: hanging down both sides, wet and dark, its edges ragged, tied down at the corners.
    made.add(part(box(), 0x8a4a35, [0, 0.62, 0.06], [0.66, 0.5, 0.03], [0.22, 0, 0]))
    made.add(part(box(), 0x7a4030, [0, 0.66, -0.06], [0.62, 0.42, 0.03], [-0.22, 0, 0]))
    for (const [rx, ry] of [[-0.24, 0.36], [0, 0.34], [0.22, 0.37]]) made.add(part(box(), 0x6e3a2a, [rx, ry, 0.12], [0.16, 0.08, 0.025], [0.3, 0, 0]))
    for (const x of [-0.3, 0.3]) made.add(stick(PALETTE.rope, [x, 0.86, 0.02], [x, 0.42, 0.11], 0.012, 4))
  } else if (state === 'done') {
    // The dried hide, stretched flat and stiff in the frame by cords to the poles.
    made.add(part(box(), 0xd9b98a, [0, 0.56, 0], [0.6, 0.5, 0.025]))
    made.add(part(box(), 0xc9a676, [0, 0.56, 0.014], [0.44, 0.34, 0.004]))
    for (const side of [-1, 1]) {
      for (const y of [0.36, 0.5, 0.64, 0.78]) made.add(stick(PALETTE.rope, [side * 0.3, y, 0], [side * 0.37, y + 0.02, 0], 0.012, 4))
    }
  }
  return made
}

// A garden plot: its soil dark where it is well watered, drying out to pale (`water` 0 to 100).
export function plot(water = 0): THREE.Group {
  const wet = Math.max(0, Math.min(1, water / 100))
  const soil = new THREE.Color(0x9a7a52).lerp(new THREE.Color(0x3a2616), wet).getHex()
  const furrow = new THREE.Color(0x7a5e3c).lerp(new THREE.Color(0x24170c), wet).getHex()
  return group(
    part(box(), PALETTE.bark, [0, 0.04, 0], [0.96, 0.08, 0.96]),
    part(box(), soil, [0, 0.06, 0], [0.84, 0.06, 0.84]),
    ...[-0.25, 0, 0.25].map((z) => part(box(), furrow, [0, 0.095, z], [0.8, 0.02, 0.06])),
  )
}

export function feeder(): THREE.Group {
  return group(
    part(box(), PALETTE.wood, [0, 0.2, 0], [0.9, 0.3, 0.55]),
    part(box(), PALETTE.hay, [0, 0.37, 0], [0.78, 0.06, 0.42]),
    part(box(), PALETTE.bark, [-0.35, 0.08, 0], [0.08, 0.16, 0.6]),
    part(box(), PALETTE.bark, [0.35, 0.08, 0], [0.08, 0.16, 0.6]),
  )
}

// A sleeping bag: a long, soft roll of green-dyed hide on the ground, its top folded back, and a pale pillow.
export function sleepingBag(): THREE.Group {
  return group(
    part(box(), PALETTE.bagDark, [0, 0.05, 0.04], [0.5, 0.1, 0.86]),
    part(box(), PALETTE.bag, [0, 0.11, 0.1], [0.46, 0.06, 0.66]),
    // The folded-back top: a little higher and wider than the bag, so no face of it lies in the bag's (no flicker).
    part(box(), PALETTE.bagLight, [0, 0.135, -0.2], [0.48, 0.03, 0.1]),
    part(box(), PALETTE.pillow, [0, 0.1, -0.32], [0.34, 0.08, 0.16]),
  )
}

// A chest: a wide box of dark planks with a lid of lighter ones (its planks running its length), two iron straps over
// it, iron caps on its corners, and a brass lock on its front, which faces south (+z), towards the camera.
export function chest(): THREE.Group {
  const made = group(
    part(box(), PALETTE.bark, [0, 0.2, 0], [0.84, 0.4, 0.56]),
    // Seams between the planks of the front.
    part(box(), PALETTE.barkDark, [0, 0.13, 0.282], [0.82, 0.02, 0.01]),
    part(box(), PALETTE.barkDark, [0, 0.26, 0.282], [0.82, 0.02, 0.01]),
    // The lid: a little wider, its planks lengthways, and higher along its middle.
    part(box(), PALETTE.wood, [0, 0.46, 0], [0.88, 0.12, 0.6]),
    part(box(), PALETTE.woodLight, [0, 0.535, 0], [0.88, 0.04, 0.36]),
    part(box(), PALETTE.barkDark, [0, 0.522, -0.1], [0.88, 0.01, 0.015]),
    part(box(), PALETTE.barkDark, [0, 0.522, 0.1], [0.88, 0.01, 0.015]),
    // The lid's iron rim along the front.
    part(box(), PALETTE.iron, [0, 0.4, 0.302], [0.9, 0.035, 0.02]),
    // The lock: a brass plate hanging down from the lid, with its keyhole.
    part(box(), PALETTE.brass, [0, 0.36, 0.31], [0.13, 0.15, 0.03]),
    part(box(), PALETTE.nose, [0, 0.34, 0.327], [0.025, 0.05, 0.01]),
  )
  // Two iron straps over the lid and down front and back, and iron on each top corner.
  for (const x of [-0.25, 0.25]) made.add(part(box(), PALETTE.iron, [x, 0.3, 0], [0.06, 0.58, 0.62]))
  for (const x of [-0.42, 0.42]) {
    for (const z of [-0.29, 0.29]) {
      made.add(part(box(), PALETTE.iron, [x, 0.47, z], [0.07, 0.15, 0.07]))
      made.add(part(box(), PALETTE.barkDark, [x * 0.92, 0.02, z * 0.9], [0.08, 0.04, 0.08]))
    }
  }
  return made
}

// The factory's machines (put away for now): plain blocks.
export function machine(color: number): THREE.Group {
  return group(part(box(), color, [0, 0.3, 0], [0.9, 0.6, 0.9]))
}

// ---- people and animals

// The player: a caveman in a fur tunic, with shaggy hair and a beard, facing +x. Its arms and legs are named, to swing
// as it walks and fights; its body (`body`, everything above the hips) to lean and sway.
export function caveman(): THREE.Group {
  const made = group()
  // Each leg: a hip that swings it to and fro (`leg-left`, `leg-right`: 0 hangs straight down, more swings it forward),
  // and a knee in it that bends the shin back (`knee-left`, `knee-right`), with the foot at its end, where a boot goes
  // (`armor-foot-left`, `armor-foot-right`, see `wear`).
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'left' : 'right'
    const hip = new THREE.Group()
    hip.position.set(0, 0.42, side * 0.058)
    hip.name = `leg-${name}`
    hip.add(part(box(), PALETTE.skin, [0, -0.105, 0], [0.08, 0.22, 0.08]))
    const knee = new THREE.Group()
    knee.position.set(0, -0.21, 0)
    knee.name = `knee-${name}`
    knee.add(part(box(), PALETTE.skin, [0, -0.1, 0], [0.075, 0.21, 0.075]))
    const foot = new THREE.Group()
    foot.position.set(0, -0.21, 0)
    foot.name = `armor-foot-${name}`
    knee.add(part(box(), PALETTE.hide, [0.025, 0.018, 0], [0.12, 0.036, 0.08]), foot)
    hip.add(knee)
    made.add(hip)
  }
  const body = group(
    // Lean and in proportion, so armour on top of it does not make it bulky: long legs, hips, a flat torso wider at the
    // shoulders than the waist (a fitted fur tunic), a neck, and a head no bigger than it should be, with its hair.
    part(box(), PALETTE.fur, [0, 0.45, 0], [0.15, 0.1, 0.24]),
    part(box(), PALETTE.fur, [0, 0.6, 0], [0.14, 0.22, 0.25]),
    part(box(), PALETTE.fur, [0, 0.72, 0], [0.15, 0.08, 0.32]),
    part(box(), PALETTE.furLight, [0.072, 0.63, 0.02], [0.01, 0.1, 0.09]),
    part(box(), PALETTE.skin, [0, 0.8, 0], [0.07, 0.06, 0.07]),
    part(ball(), PALETTE.skin, [0, 0.9, 0], [0.18, 0.2, 0.17]),
    part(blob(), PALETTE.hair, [-0.03, 0.96, 0], [0.21, 0.14, 0.21]),
    part(blob(), PALETTE.hair, [0.07, 0.84, 0], [0.07, 0.09, 0.11]),
    part(ball(), 0x1c1a16, [0.087, 0.915, -0.042], [0.03, 0.03, 0.03]),
    part(ball(), 0x1c1a16, [0.087, 0.915, 0.042], [0.03, 0.03, 0.03]),
  )
  // Each arm: a shoulder that turns about the upright (`arm-left`, `arm-right`), and in it a joint that swings the arm
  // up and down (`...-pitch`: 0 hangs down, π/2 points straight ahead, π straight up), with the fist at its end
  // (`hand-left`, `hand-right`), where what is held goes. The right arm is on the +z side (the model faces +x).
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'left' : 'right'
    const shoulder = new THREE.Group()
    shoulder.position.set(0, 0.74, side * 0.19)
    shoulder.name = `arm-${name}`
    const pitch = new THREE.Group()
    pitch.name = `arm-${name}-pitch`
    pitch.add(part(box(), PALETTE.skin, [0, -0.15, 0], [0.065, 0.3, 0.065]))
    pitch.add(part(box(), PALETTE.skin, [0.005, -0.325, 0], [0.075, 0.07, 0.075]))
    // Where body armour's sleeve goes (see `wear`), so it swings with the arm.
    const sleeve = new THREE.Group()
    sleeve.name = `armor-sleeve-${name}`
    pitch.add(sleeve)
    const hand = new THREE.Group()
    hand.position.set(0.005, -0.325, 0)
    hand.name = `hand-${name}`
    pitch.add(hand)
    shoulder.add(pitch)
    body.add(shoulder)
  }
  // Where armour goes, filled in by `wear` (boots go on the feet).
  for (const slot of ['head', 'body']) {
    const worn = new THREE.Group()
    worn.name = `armor-${slot}`
    body.add(worn)
  }
  // Everything above the hips turns about them (to lean into a stride), so it is held up there.
  body.position.y = -HIP_HEIGHT
  const torso = group(body)
  torso.position.y = HIP_HEIGHT
  torso.name = 'body'
  made.add(torso)
  return made
}

// How high a caveman's hips are, where its legs swing from and its body leans (tiles).
export const HIP_HEIGHT = 0.42

// Dresses a caveman (see `caveman`) in a piece of armour, by its item key and colour, in its slot; or takes off what
// is there (no key). Pieces without a model of their own are drawn in their item's colour.
export function wear(person: THREE.Object3D, slot: 'head' | 'body' | 'feet', key: string | undefined, color = 0x8a5a3a): void {
  if (slot === 'feet') {
    // A boot on each foot, so it steps with it: up over the ankle, the toe out in front.
    for (const side of ['left', 'right']) {
      const foot = person.getObjectByName(`armor-foot-${side}`)
      if (!foot) continue
      foot.clear()
      if (!key) continue
      const dark = new THREE.Color(color).multiplyScalar(0.7).getHex()
      foot.add(part(box(), color, [0.01, 0.07, 0], [0.105, 0.14, 0.095]))
      foot.add(part(box(), color, [0.04, 0.03, 0], [0.15, 0.06, 0.095]))
      foot.add(part(box(), dark, [0.01, 0.145, 0], [0.11, 0.02, 0.1]))
    }
    return
  }
  const worn = person.getObjectByName(`armor-${slot}`)
  if (!worn) return
  worn.clear()
  const sleeves = slot === 'body' ? ['left', 'right'].map((side) => person.getObjectByName(`armor-sleeve-${side}`)) : []
  for (const sleeve of sleeves) sleeve?.clear()
  if (!key) return
  if (slot === 'head') {
    if (key === 'wolf-helmet') {
      // A wolf's head worn as a hood: grey fur over the scalp, pricked ears, the muzzle over the brow.
      worn.add(part(blob(), PALETTE.wolf, [-0.02, 0.97, 0], [0.24, 0.17, 0.24]))
      worn.add(part(box(), PALETTE.wolfPale, [0.1, 0.99, 0], [0.1, 0.06, 0.11]))
      worn.add(part(box(), PALETTE.nose, [0.155, 0.99, 0], [0.025, 0.03, 0.04]))
      worn.add(part(cone(4), PALETTE.wolfBlack, [-0.02, 1.09, -0.07], [0.05, 0.09, 0.035]))
      worn.add(part(cone(4), PALETTE.wolfBlack, [-0.02, 1.09, 0.07], [0.05, 0.09, 0.035]))
      worn.add(part(box(), PALETTE.wolf, [-0.11, 0.84, 0], [0.05, 0.18, 0.2]))
    } else worn.add(part(blob(), color, [-0.02, 0.98, 0], [0.23, 0.14, 0.23]))
    return
  }
  if (slot === 'body') {
    // A leather tunic, fitted close over the body from the shoulders to the hips (barely bigger than the fur under it),
    // its front a lighter panel, with low shoulder pads, sleeves down the upper arms, a belt, and a short skirt of flaps.
    const dark = new THREE.Color(color).multiplyScalar(0.62).getHex()
    const light = new THREE.Color(color).lerp(new THREE.Color(0xd9a070), 0.25).getHex()
    worn.add(part(box(), color, [0, 0.61, 0], [0.16, 0.25, 0.27]))
    worn.add(part(box(), color, [0, 0.725, 0], [0.165, 0.075, 0.335]))
    worn.add(part(box(), light, [0.081, 0.62, 0], [0.01, 0.18, 0.12]))
    // The collar, round the neck.
    worn.add(part(box(), dark, [0, 0.77, 0], [0.12, 0.025, 0.14]))
    // Shoulder pads, low over the tops of the arms.
    for (const z of [-0.18, 0.18]) worn.add(part(box(), dark, [0, 0.765, z], [0.11, 0.035, 0.08]))
    // The belt, with its buckle.
    worn.add(part(box(), PALETTE.barkDark, [0, 0.49, 0], [0.165, 0.04, 0.27]))
    worn.add(part(box(), PALETTE.brass, [0.084, 0.49, 0], [0.01, 0.035, 0.04]))
    // The skirt: flaps hanging close from the belt all round, over the tops of the legs.
    for (let i = 0; i < 8; i++) {
      const turn = (i / 8) * Math.PI * 2
      const flap = part(box(), i % 2 === 0 ? color : dark, [Math.cos(turn) * 0.08, 0.42, Math.sin(turn) * 0.125], [0.02, 0.11, 0.08])
      flap.rotation.set(0, -turn, -0.06)
      worn.add(flap)
    }
    // A sleeve on each upper arm, with a dark cuff.
    for (const sleeve of sleeves) {
      sleeve?.add(part(box(), color, [0, -0.08, 0], [0.08, 0.16, 0.08]))
      sleeve?.add(part(box(), dark, [0, -0.165, 0], [0.084, 0.02, 0.084]))
    }
    return
  }
}

// What a player holds in a hand (see `caveman`): a model of the weapon or tool, by its item key, pointing on from the
// arm (along the hand's -y) with its working end out there; undefined for anything else (see three-view, which holds
// an item's picture instead). A bow is held in the left hand, its string (named `bow-string`) pulled back along +y.
export function heldModel(key: string): THREE.Group | undefined {
  switch (key) {
    case 'axe':
      return group(
        part(cylinder(6), PALETTE.wood, [0, -0.2, 0], [0.05, 0.5, 0.05]),
        part(box(), PALETTE.stoneDark, [0, -0.42, -0.08], [0.06, 0.16, 0.16]),
        part(box(), PALETTE.rope, [0, -0.38, 0], [0.07, 0.06, 0.07]),
      )
    case 'pickaxe':
      return group(
        part(cylinder(6), PALETTE.wood, [0, -0.2, 0], [0.05, 0.5, 0.05]),
        part(cone(4), PALETTE.stoneDark, [0.12, -0.44, 0], [0.06, 0.22, 0.06], [0, 0, -Math.PI / 2]),
        part(cone(4), PALETTE.stoneDark, [-0.12, -0.44, 0], [0.06, 0.22, 0.06], [0, 0, Math.PI / 2]),
        part(box(), PALETTE.rope, [0, -0.43, 0], [0.07, 0.07, 0.07]),
      )
    case 'knife':
      return group(
        part(box(), PALETTE.wood, [0, -0.05, 0], [0.05, 0.1, 0.05]),
        part(cone(4), PALETTE.stoneDark, [0, -0.2, 0], [0.06, 0.22, 0.03], [Math.PI, 0, 0]),
      )
    case 'club':
      return group(
        part(cylinder(6), PALETTE.bark, [0, -0.12, 0], [0.06, 0.26, 0.06]),
        part(cylinder(7), PALETTE.bark, [0, -0.36, 0], [0.13, 0.26, 0.13]),
        part(lump(), PALETTE.barkDark, [0.04, -0.44, 0.03], [0.07, 0.07, 0.07]),
      )
    case 'wood-spear':
    case 'flint-spear':
      return group(
        part(cylinder(5), PALETTE.wood, [0, -0.3, 0], [0.04, 1.3, 0.04]),
        part(cone(4), key === 'flint-spear' ? PALETTE.stoneDark : PALETTE.woodLight, [0, -1.02, 0], [0.07, 0.16, 0.07], [Math.PI, 0, 0]),
      )
    case 'oar':
      // A long shaft with a knob at the top, and a broad flat blade at its foot.
      return group(
        part(cylinder(6), PALETTE.woodLight, [0, -0.45, 0], [0.045, 1.2, 0.045]),
        part(box(), PALETTE.wood, [0, 0.16, 0], [0.07, 0.04, 0.07]),
        part(box(), PALETTE.woodLight, [0, -1.2, 0], [0.18, 0.36, 0.03]),
        part(box(), PALETTE.wood, [0, -1.02, 0], [0.1, 0.08, 0.04]),
      )
    case 'bow': {
      // Two limbs bent forward from the grip, and the string between their tips.
      const made = group(
        part(box(), PALETTE.wood, [0, -0.04, 0], [0.05, 0.08, 0.05]),
        part(box(), PALETTE.wood, [0.17, -0.07, 0], [0.32, 0.04, 0.04], [0, 0, 0.25]),
        part(box(), PALETTE.wood, [-0.17, -0.07, 0], [0.32, 0.04, 0.04], [0, 0, -0.25]),
      )
      const string = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.32, -0.03, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.32, -0.03, 0)]),
        new THREE.LineBasicMaterial({ color: 0xf2efe6 }),
      )
      string.name = 'bow-string'
      made.add(string)
      return made
    }
    case 'sling': {
      // Two thin cords from the fist (a loop round a finger) down to a leather pouch cupping a stone. The cords and pouch
      // hang from a pivot (`sling-cords`) along the hand's -y, so they hang down from the fist; turned a quarter round
      // (see three-view's `pose`), they stand straight out to the side, to be whirled round. The stone (`sling-stone`)
      // is gone once it has been let fly.
      const cords = new THREE.Group()
      cords.name = 'sling-cords'
      const length = 0.24
      for (const z of [-1, 1]) cords.add(stick(PALETTE.rope, [0, 0, z * 0.006], [0, -length, z * 0.034], 0.012, 4))
      const pouch = part(geometry('slingPouch', () => new THREE.SphereGeometry(0.5, 7, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), PALETTE.hide, [0, -length - 0.004, 0], [0.075, 0.07, 0.09])
      pouch.material = bothSides(PALETTE.hide)
      cords.add(pouch)
      cords.add(part(box(), PALETTE.barkDark, [0, -length + 0.002, 0], [0.072, 0.012, 0.086]))
      const stone = part(lump(), PALETTE.stoneDark, [0, -length - 0.006, 0], [0.06, 0.055, 0.06])
      stone.name = 'sling-stone'
      cords.add(stone)
      return group(part(geometry('slingLoop', () => new THREE.TorusGeometry(0.5, 0.18, 4, 8)), PALETTE.rope, [0, 0, 0], [0.06, 0.06, 0.06], [0, Math.PI / 2, 0]), cords)
    }
    default:
      return undefined
  }
}

// The animals, each as a male or a female, told apart at a glance: a bull is dark, broad and long-horned, a cow pied
// with an udder; a rooster has a tall red comb, wattles and a sweeping dark tail, a hen a small comb and brown
// feathers; a buck has antlers and a dark neck, a doe none; a male wolf is bigger and darker with a heavy mane, a female
// slighter and paler.
export function cow(male: boolean): THREE.Group {
  const coat = male ? PALETTE.bull : PALETTE.cowWhite
  const made = group(
    part(box(), coat, [0, 0.57, 0], male ? [0.96, 0.48, 0.52] : [0.9, 0.42, 0.45]),
    part(box(), PALETTE.cowWhite === coat ? PALETTE.cowPatch : PALETTE.bullDark, [-0.1, 0.64, male ? 0.261 : 0.226], [0.3, 0.22, 0.01]),
    part(box(), PALETTE.cowWhite === coat ? PALETTE.cowPatch : PALETTE.bullDark, [0.2, 0.54, male ? -0.261 : -0.226], [0.26, 0.2, 0.01]),
    part(box(), coat, [0.54, 0.7, 0], [0.32, 0.32, 0.34]),
    part(box(), PALETTE.pink, [0.71, 0.64, 0], [0.06, 0.16, 0.22]),
    part(box(), coat, [-0.5, 0.57, 0], [0.04, 0.32, 0.04], [0, 0, 0.3]),
  )
  if (male) {
    // Long horns curving out and forward, a hump of muscle, and a ring in the nose.
    made.add(part(cone(4), PALETTE.horn, [0.54, 0.9, -0.26], [0.07, 0.34, 0.07], [Math.PI / 2 - 0.3, 0, -0.2]))
    made.add(part(cone(4), PALETTE.horn, [0.54, 0.9, 0.26], [0.07, 0.34, 0.07], [-Math.PI / 2 + 0.3, 0, -0.2]))
    made.add(part(box(), coat, [0.28, 0.86, 0], [0.3, 0.14, 0.4]))
    made.add(part(cylinder(8), PALETTE.ring, [0.75, 0.6, 0], [0.09, 0.02, 0.09], [0, 0, Math.PI / 2]))
  } else {
    made.add(part(cone(4), PALETTE.horn, [0.54, 0.9, -0.12], [0.06, 0.14, 0.06], [0, 0, -0.3]))
    made.add(part(cone(4), PALETTE.horn, [0.54, 0.9, 0.12], [0.06, 0.14, 0.06], [0, 0, -0.3]))
    made.add(part(box(), PALETTE.pink, [-0.1, 0.32, 0], [0.22, 0.1, 0.2]))
  }
  for (const [lx, lz] of [[-0.32, -0.15], [-0.32, 0.15], [0.32, -0.15], [0.32, 0.15]]) made.add(part(box(), coat, [lx, 0.17, lz], [0.11, 0.34, 0.11]))
  return made
}

export function chicken(male: boolean): THREE.Group {
  const feathers = male ? PALETTE.chicken : PALETTE.hen
  const made = group(
    part(ball(), feathers, [0, 0.3, 0], [0.42, 0.32, 0.3]),
    part(ball(), feathers, [0.18, 0.48, 0], [0.2, 0.22, 0.2]),
    part(cone(4), PALETTE.beak, [0.31, 0.47, 0], [0.06, 0.12, 0.06], [0, 0, -Math.PI / 2]),
    part(cylinder(4), PALETTE.beak, [0, 0.08, -0.07], [0.03, 0.16, 0.03]),
    part(cylinder(4), PALETTE.beak, [0, 0.08, 0.07], [0.03, 0.16, 0.03]),
  )
  if (male) {
    // A tall comb, long wattles, a copper neck, and a high, sweeping tail of dark feathers.
    made.add(part(box(), PALETTE.comb, [0.17, 0.66, 0], [0.18, 0.16, 0.035]))
    made.add(part(box(), PALETTE.comb, [0.27, 0.37, 0], [0.05, 0.13, 0.04]))
    made.add(part(ball(), PALETTE.rooster, [0.12, 0.42, 0], [0.18, 0.18, 0.22]))
    made.add(part(box(), PALETTE.roosterTail, [-0.26, 0.52, 0], [0.08, 0.36, 0.05], [0, 0, 0.55]))
    made.add(part(box(), PALETTE.roosterTailGreen, [-0.32, 0.5, 0.04], [0.06, 0.3, 0.04], [0, 0, 0.9]))
    made.add(part(box(), PALETTE.roosterTail, [-0.3, 0.46, -0.04], [0.06, 0.28, 0.04], [0, 0, 1.15]))
  } else {
    made.add(part(box(), PALETTE.comb, [0.18, 0.61, 0], [0.09, 0.05, 0.03]))
    made.add(part(box(), feathers, [-0.22, 0.38, 0], [0.12, 0.16, 0.18], [0, 0, 0.5]))
  }
  return made
}

// A deer: slender and long-legged, with a pale belly and tail; a buck darker at the neck, with antlers.
export function deer(male: boolean): THREE.Group {
  const made = group(
    part(box(), PALETTE.deer, [0, 0.66, 0], male ? [0.76, 0.32, 0.32] : [0.68, 0.28, 0.28]),
    part(box(), PALETTE.deerBelly, [0, 0.52, 0], [0.6, 0.04, 0.26]),
    // The neck, leaning forward, and the head.
    part(box(), male ? PALETTE.deerDark : PALETTE.deer, [0.36, 0.86, 0], male ? [0.18, 0.36, 0.18] : [0.12, 0.34, 0.12], [0, 0, -0.45]),
    part(box(), PALETTE.deer, [0.5, 1.02, 0], [0.24, 0.15, 0.15]),
    part(box(), PALETTE.nose, [0.63, 1.0, 0], [0.04, 0.06, 0.08]),
    part(cone(4), PALETTE.deer, [0.44, 1.12, -0.09], [0.05, 0.12, 0.03], [0.5, 0, 0]),
    part(cone(4), PALETTE.deer, [0.44, 1.12, 0.09], [0.05, 0.12, 0.03], [-0.5, 0, 0]),
    part(box(), PALETTE.deerBelly, [-0.38, 0.74, 0], [0.06, 0.12, 0.08], [0, 0, 0.5]),
  )
  if (male) {
    // Antlers: a tall beam and three tines each side.
    for (const side of [-1, 1]) {
      made.add(part(cylinder(4), PALETTE.antler, [0.44, 1.3, side * 0.1], [0.03, 0.36, 0.03], [side * -0.45, 0, 0.15]))
      made.add(part(cylinder(4), PALETTE.antler, [0.52, 1.34, side * 0.14], [0.022, 0.16, 0.022], [0, 0, -0.7]))
      made.add(part(cylinder(4), PALETTE.antler, [0.47, 1.45, side * 0.19], [0.022, 0.14, 0.022], [side * -0.3, 0, -0.5]))
      made.add(part(cylinder(4), PALETTE.antler, [0.4, 1.47, side * 0.17], [0.02, 0.12, 0.02], [side * -0.6, 0, 0.3]))
    }
  }
  for (const [lx, lz] of [[-0.27, -0.1], [-0.27, 0.1], [0.27, -0.1], [0.27, 0.1]]) made.add(part(box(), PALETTE.deer, [lx, 0.26, lz], [0.07, 0.52, 0.07]))
  return made
}

// A wolf: grey, low and long, with a pointed muzzle, pricked ears and a bushy tail; a male bigger and darker, with a
// heavy mane, a female slighter and paler.
export function wolf(male: boolean): THREE.Group {
  const coat = male ? PALETTE.wolfDark : PALETTE.wolfLight
  const made = group(
    part(box(), coat, [0, 0.46, 0], [0.7, 0.28, 0.28]),
    part(box(), PALETTE.wolfPale, [0.02, 0.33, 0], [0.56, 0.04, 0.22]),
    part(box(), male ? PALETTE.wolfBlack : PALETTE.wolf, [-0.05, 0.61, 0], [0.5, 0.04, 0.2]),
    // The ruff and head.
    part(box(), male ? PALETTE.wolfBlack : coat, [0.32, 0.54, 0], male ? [0.26, 0.44, 0.4] : [0.16, 0.3, 0.28]),
    part(box(), coat, [0.46, 0.6, 0], [0.22, 0.2, 0.22]),
    part(box(), PALETTE.wolfPale, [0.62, 0.55, 0], [0.16, 0.1, 0.12]),
    part(box(), PALETTE.nose, [0.71, 0.58, 0], [0.04, 0.05, 0.06]),
    part(cone(4), PALETTE.wolfBlack, [0.42, 0.77, -0.07], [0.06, 0.13, 0.04]),
    part(cone(4), PALETTE.wolfBlack, [0.42, 0.77, 0.07], [0.06, 0.13, 0.04]),
    // The tail, hanging back and down.
    part(box(), coat, [-0.46, 0.44, 0], [0.32, 0.1, 0.1], [0, 0, 0.5]),
    part(box(), PALETTE.wolfBlack, [-0.6, 0.35, 0], [0.1, 0.08, 0.08], [0, 0, 0.5]),
  )
  for (const [lx, lz] of [[-0.24, -0.09], [-0.24, 0.09], [0.24, -0.09], [0.24, 0.09]]) made.add(part(box(), coat, [lx, 0.17, lz], [0.08, 0.34, 0.08]))
  return made
}

// A skeleton: bones, a skull with dark eyes, and a rusty sword held out in front. All of it is in a group (`body`) so it
// can crouch and lean into a charge; the sword arm in its own (`weapon-arm`, from the shoulder) so it can be raised to
// swing or held out to charge; and its eyes (`fury`) blaze red while it charges and dashes.
export function skeleton(): THREE.Group {
  const body = group(
    // The spine and ribs.
    part(box(), PALETTE.bone, [0, 0.62, 0], [0.06, 0.42, 0.06]),
    part(box(), PALETTE.bone, [0, 0.72, 0], [0.12, 0.05, 0.3]),
    part(box(), PALETTE.bone, [0, 0.64, 0], [0.12, 0.05, 0.27]),
    part(box(), PALETTE.bone, [0, 0.56, 0], [0.1, 0.05, 0.22]),
    part(box(), PALETTE.boneDark, [0, 0.42, 0], [0.12, 0.08, 0.26]),
    // The skull.
    part(box(), PALETTE.bone, [0.02, 0.96, 0], [0.22, 0.22, 0.22]),
    part(box(), PALETTE.boneDark, [0.06, 0.86, 0], [0.16, 0.06, 0.16]),
    part(box(), PALETTE.eye, [0.13, 0.98, -0.055], [0.02, 0.06, 0.05]),
    part(box(), PALETTE.eye, [0.13, 0.98, 0.055], [0.02, 0.06, 0.05]),
    // The left arm hanging.
    part(box(), PALETTE.bone, [0.02, 0.6, -0.19], [0.05, 0.3, 0.05], [0.15, 0, 0]),
  )
  // The right arm, a rusty sword in its fist: a wrapped grip, a crossguard, and a broad, notched blade.
  const arm = group(
    part(box(), PALETTE.bone, [0.14, 0, 0], [0.28, 0.05, 0.05]),
    part(box(), PALETTE.rope, [0.3, 0.02, 0], [0.12, 0.045, 0.045]),
    part(box(), PALETTE.rust, [0.37, 0.02, 0], [0.03, 0.05, 0.2]),
    part(box(), 0x9a8c7a, [0.66, 0.02, 0], [0.56, 0.025, 0.09]),
    part(box(), PALETTE.rust, [0.6, 0.02, 0.03], [0.14, 0.03, 0.035]),
    part(cone(4), 0x9a8c7a, [0.98, 0.02, 0], [0.09, 0.12, 0.025], [0, 0, -Math.PI / 2]),
  )
  arm.position.set(0.02, 0.7, 0.18)
  arm.name = 'weapon-arm'
  body.add(arm)
  // The eyes ablaze, over the dark ones, shown only while it charges.
  const fury = group(...[-0.055, 0.055].map((z) => {
    const eye = new THREE.Mesh(box(), new THREE.MeshBasicMaterial({ color: 0xff2a3a }))
    eye.position.set(0.135, 0.98, z)
    eye.scale.set(0.03, 0.08, 0.07)
    return eye
  }))
  fury.name = 'fury'
  fury.visible = false
  body.add(fury)
  for (const lz of [-0.07, 0.07]) body.add(part(box(), PALETTE.bone, [0, 0.19, lz], [0.06, 0.4, 0.06]))
  body.name = 'body'
  return group(body)
}

// A skeleton archer: a skeleton with a bow held out in its left hand, a quiver of arrows on its back, and its right
// hand back at the string. While it aims, an arrow (named `nocked`) lies on the bow and the string is drawn back.
export function skeletonArcher(): THREE.Group {
  const made = group(
    part(box(), PALETTE.bone, [0, 0.62, 0], [0.06, 0.42, 0.06]),
    part(box(), PALETTE.bone, [0, 0.72, 0], [0.12, 0.05, 0.3]),
    part(box(), PALETTE.bone, [0, 0.64, 0], [0.12, 0.05, 0.27]),
    part(box(), PALETTE.bone, [0, 0.56, 0], [0.1, 0.05, 0.22]),
    part(box(), PALETTE.boneDark, [0, 0.42, 0], [0.12, 0.08, 0.26]),
    // The skull, under a ragged hood.
    part(box(), PALETTE.bone, [0.02, 0.96, 0], [0.22, 0.22, 0.22]),
    part(box(), PALETTE.boneDark, [0.06, 0.86, 0], [0.16, 0.06, 0.16]),
    part(box(), PALETTE.eye, [0.13, 0.98, -0.055], [0.02, 0.06, 0.05]),
    part(box(), PALETTE.eye, [0.13, 0.98, 0.055], [0.02, 0.06, 0.05]),
    part(blob(), 0x4a3f36, [-0.04, 1.03, 0], [0.28, 0.2, 0.28]),
    // The quiver on its back, with fletchings showing.
    part(cylinder(6), PALETTE.hide, [-0.16, 0.72, 0.06], [0.1, 0.36, 0.1], [0, 0, -0.35]),
    part(box(), 0xe8e2d4, [-0.24, 0.92, 0.04], [0.04, 0.08, 0.03], [0, 0, -0.35]),
    part(box(), 0xd9483b, [-0.22, 0.93, 0.09], [0.04, 0.08, 0.03], [0, 0, -0.35]),
    // The left arm held out to the front with the bow upright in its hand; the right arm bent back to the string.
    stick(PALETTE.bone, [0, 0.74, -0.15], [0.34, 0.74, -0.06], 0.05, 4),
    stick(PALETTE.bone, [0, 0.74, 0.15], [0.14, 0.74, 0.08], 0.05, 4),
    stick(PALETTE.wood, [0.36, 0.74, -0.05], [0.31, 1.02, -0.05], 0.035, 4),
    stick(PALETTE.wood, [0.36, 0.74, -0.05], [0.31, 0.46, -0.05], 0.035, 4),
  )
  const string = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.31, 1.02, -0.05), new THREE.Vector3(0.24, 0.74, -0.05), new THREE.Vector3(0.31, 0.46, -0.05)]),
    new THREE.LineBasicMaterial({ color: 0xf2efe6 }),
  )
  made.add(string)
  const nocked = group(
    stick(PALETTE.woodLight, [0.14, 0.74, -0.05], [0.5, 0.74, -0.05], 0.018, 4),
    part(cone(4), PALETTE.stoneDark, [0.53, 0.74, -0.05], [0.035, 0.07, 0.035], [0, 0, -Math.PI / 2]),
  )
  nocked.name = 'nocked'
  nocked.visible = false
  made.add(nocked)
  for (const lz of [-0.07, 0.07]) made.add(part(box(), PALETTE.bone, [0, 0.19, lz], [0.06, 0.4, 0.06]))
  return made
}

// The frost lich: a tall skeleton in a dark, frayed robe and hood, a crown of ice on its skull, and a staff topped with a
// glowing crystal of ice in its right hand.
export function frostLich(): THREE.Group {
  const made = group(
    // The robe, wide at the hem, and its hood.
    part(cone(7), PALETTE.robe, [0, 0.5, 0], [0.62, 1.0, 0.62]),
    part(cylinder(7), PALETTE.robeDark, [0, 0.04, 0], [0.64, 0.08, 0.64]),
    part(box(), PALETTE.robeDark, [0.2, 0.55, 0], [0.04, 0.7, 0.08]),
    part(blob(), PALETTE.robe, [-0.04, 1.08, 0], [0.34, 0.32, 0.34]),
    // The skull in the hood, eyes burning blue, and the crown of ice.
    part(box(), PALETTE.bone, [0.06, 1.04, 0], [0.2, 0.2, 0.2]),
    part(box(), PALETTE.ice, [0.17, 1.07, -0.05], [0.02, 0.05, 0.05]),
    part(box(), PALETTE.ice, [0.17, 1.07, 0.05], [0.02, 0.05, 0.05]),
    part(cone(4), PALETTE.ice, [0, 1.3, -0.08], [0.06, 0.18, 0.06]),
    part(cone(4), PALETTE.ice, [0.04, 1.33, 0], [0.07, 0.24, 0.07]),
    part(cone(4), PALETTE.ice, [0, 1.3, 0.08], [0.06, 0.18, 0.06]),
    // A bony hand.
    part(box(), PALETTE.bone, [0.24, 0.72, -0.26], [0.06, 0.24, 0.06], [0.4, 0, 0.3]),
  )
  // The staff in the other hand, in its own group (`staff`), turning about the hand that holds it (the group's middle,
  // at the hand: `baseY` up), to be raised or levelled as it casts, its crystal glowing then (`glow`). Forward is +x.
  const hand = { x: 0.3, y: 0.8, z: 0.3 }
  const staff = group(
    part(cylinder(6), PALETTE.barkDark, [0, 0.72 - hand.y, 0], [0.05, 1.5, 0.05]),
    part(box(), PALETTE.bone, [0, 0, 0], [0.08, 0.08, 0.08]),
    part(blob(), PALETTE.iceDeep, [0, 1.52 - hand.y, 0], [0.2, 0.26, 0.2]),
    part(blob(), PALETTE.ice, [0, 1.55 - hand.y, 0], [0.12, 0.16, 0.12]),
  )
  staff.position.set(hand.x, hand.y, hand.z)
  staff.userData.baseY = hand.y
  staff.name = 'staff'
  const glow = new THREE.Mesh(ball(), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.55, depthWrite: false }))
  glow.position.set(0, 1.54 - hand.y, 0)
  glow.scale.setScalar(0.4)
  glow.name = 'glow'
  glow.visible = false
  staff.add(glow)
  made.add(staff)
  return made
}

// A frozen wisp, called up by the frost lich: a glowing knot of ice, a bright core in it, trailing shards. It floats,
// and the view bobs it.
export function frostWisp(): THREE.Group {
  const glow = new THREE.Mesh(ball(), new THREE.MeshBasicMaterial({ color: 0xd8f2ff, transparent: true, opacity: 0.35, depthWrite: false }))
  glow.position.set(0, 0.55, 0)
  glow.scale.setScalar(0.55)
  return group(
    glow,
    part(blob(), PALETTE.iceDeep, [0, 0.55, 0], [0.32, 0.36, 0.32], [0.3, 0.5, 0.2]),
    part(blob(), PALETTE.ice, [0.02, 0.57, 0], [0.2, 0.22, 0.2]),
    part(cone(4), PALETTE.ice, [-0.2, 0.5, 0.06], [0.06, 0.22, 0.06], [0, 0, Math.PI / 2 + 0.3]),
    part(cone(4), PALETTE.iceDeep, [-0.22, 0.6, -0.06], [0.05, 0.18, 0.05], [0, 0, Math.PI / 2 - 0.2]),
  )
}

// The ice door that seals the frost lich's hall: a slab of blue ice filling the doorway, frosted, with dark bars of
// iron frozen into it.
export function iceDoor(): THREE.Group {
  const made = group(part(box(), PALETTE.iceDeep, [0, 0.55, 0], [0.96, 1.1, 0.5]), part(box(), PALETTE.ice, [0, 0.55, 0.01], [0.86, 1.0, 0.52]))
  for (const z of [-0.3, 0, 0.3]) made.add(part(box(), PALETTE.iron, [z, 0.55, 0], [0.06, 1.1, 0.56]))
  made.add(part(box(), PALETTE.iron, [0, 0.95, 0], [0.96, 0.06, 0.56]))
  return made
}

// ---- landmarks

// A skeletons' camp: a ring of stones round a cold, blackened fire, a ragged hide tent, and bones about.
export function camp(): THREE.Group {
  const made = group()
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    made.add(part(lump(), i % 2 ? PALETTE.stone : PALETTE.stoneDark, [Math.cos(angle) * 0.45, 0.07, Math.sin(angle) * 0.45], [0.2, 0.15, 0.2]))
  }
  made.add(part(cylinder(8), PALETTE.ash, [0, 0.02, 0], [0.7, 0.04, 0.7]))
  for (const angle of [0.3, 1.4, 2.5]) made.add(part(cylinder(5), PALETTE.char, [0, 0.08, 0], [0.08, 0.6, 0.08], [Math.PI / 2, angle, 0]))
  // The tent, behind the fire.
  const tent = group(
    part(cone(4), PALETTE.hide, [0, 0.7, 0], [1.6, 1.4, 1.6], [0, Math.PI / 4, 0]),
    part(box(), PALETTE.barkDark, [0, 1.45, 0], [0.06, 0.3, 0.06]),
    part(box(), PALETTE.soilDark, [0.56, 0.35, 0], [0.04, 0.6, 0.4]),
  )
  tent.position.set(-1.9, 0, -1.6)
  tent.rotation.y = 0.6
  made.add(tent)
  // Bones lying about, and a skull on a stake.
  for (const [bx, bz, turn] of [[1.2, 0.8, 0.4], [0.9, -1.3, 1.7], [-0.6, 1.5, 2.6], [1.7, -0.2, 0.9]]) {
    made.add(part(box(), PALETTE.bone, [bx, 0.04, bz], [0.36, 0.05, 0.06], [0, turn, 0]))
  }
  made.add(part(box(), PALETTE.barkDark, [1.6, 0.55, 1.4], [0.07, 1.1, 0.07]))
  made.add(part(box(), PALETTE.bone, [1.6, 1.18, 1.4], [0.2, 0.2, 0.2]))
  made.add(part(box(), PALETTE.eye, [1.71, 1.2, 1.4], [0.02, 0.06, 0.12]))
  return made
}

// The way into the dungeon: dark steps going down into the snow between two standing stones, under a lintel, with
// skulls either side.
export function dungeonEntrance(): THREE.Group {
  const made = group(
    part(box(), PALETTE.void, [0, 0.01, 0], [1.4, 0.02, 1.4]),
    part(box(), PALETTE.stoneDark, [-0.85, 0.85, 0], [0.4, 1.7, 0.5]),
    part(box(), PALETTE.stoneDark, [0.85, 0.85, 0], [0.4, 1.7, 0.5]),
    part(box(), PALETTE.stone, [0, 1.85, 0], [2.3, 0.35, 0.6]),
    part(box(), PALETTE.bone, [-0.85, 1.85, 0.32], [0.24, 0.24, 0.1]),
    part(box(), PALETTE.bone, [0.85, 1.85, 0.32], [0.24, 0.24, 0.1]),
  )
  // The steps, going down towards the back.
  for (let i = 0; i < 4; i++) made.add(part(box(), i % 2 ? PALETTE.stoneDark : PALETTE.stone, [0, 0.03 - i * 0.002, 0.45 - i * 0.3], [1.2, 0.04, 0.26]))
  return made
}

// The stairs out of the dungeon: steps going up, lit from above.
export function dungeonExit(): THREE.Group {
  const made = group()
  for (let i = 0; i < 4; i++) made.add(part(box(), i % 2 ? PALETTE.stone : PALETTE.stoneDark, [0, 0.06 + i * 0.12, 0.35 - i * 0.24], [0.9, 0.12 + i * 0.24, 0.26]))
  const light = new THREE.Mesh(cylinder(10), new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.25, depthWrite: false }))
  light.position.set(0, 1.2, 0)
  light.scale.set(1, 2.4, 1)
  made.add(light)
  return made
}

// ---- rafts

// A raft (see rafts.ts), 1.5 tiles a side, its middle at the model's, floating with its deck just over the ground's
// level (so whoever stands on it stands as on land) and its logs half under the water: seven logs side by side along
// x, each a little different in length and shade, lashed together with rope at both ends over two beams across under
// them.
export function raft(): THREE.Group {
  const made = group()
  const logs = 7
  const size = 1.5
  const thick = size / logs
  const shades = [PALETTE.bark, 0x7a5636, PALETTE.barkDark, 0x6f4d2f, PALETTE.bark, 0x80593a, 0x5e4128]
  for (let i = 0; i < logs; i++) {
    const z = -size / 2 + thick * (i + 0.5)
    const long = size - ((i * 5) % 3) * 0.03
    const log = part(cylinder(7), shades[i], [((i * 3) % 3 - 1) * 0.012, 0.02 - thick / 2, z], [thick * 0.98, long, thick * 0.98], [0, 0, Math.PI / 2])
    log.rotation.x = i * 0.7
    made.add(log)
    // The cut ends, paler.
    for (const end of [-1, 1]) made.add(part(cylinder(7), PALETTE.woodLight, [end * (long / 2 + 0.002), 0.02 - thick / 2, z], [thick * 0.8, 0.006, thick * 0.8], [0, 0, Math.PI / 2]))
  }
  for (const x of [-0.55, 0.55]) {
    made.add(part(box(), PALETTE.barkDark, [x, -0.17, 0], [0.12, 0.08, size * 0.96]))
    made.add(part(box(), PALETTE.rope, [x, 0.025, 0], [0.06, 0.02, size * 1.01]))
    for (let i = 0; i < logs; i++) made.add(part(box(), PALETTE.rope, [x, 0.02 - thick / 2, -size / 2 + thick * (i + 0.5)], [0.065, thick * 1.04, 0.025]))
  }
  // A short stick standing up from its middle, for a rope (RAFT_POST_HEIGHT tall), with a groove cut round its top.
  made.add(part(cylinder(6), PALETTE.wood, [0, 0.03 + RAFT_POST_HEIGHT / 2, 0], [0.07, RAFT_POST_HEIGHT, 0.07]))
  made.add(part(cylinder(6), PALETTE.barkDark, [0, RAFT_POST_HEIGHT - 0.04, 0], [0.075, 0.025, 0.075]))
  return made
}

// How tall the post in a raft's middle is (tiles): where a rope on it is tied.
export const RAFT_POST_HEIGHT = 0.42

// ---- what flies

// An arrow, a thrown spear, a sling stone, a shard of ice or an icicle, pointing along +x.
export function projectile(kind: 'arrow' | 'spear' | 'stone' | 'shard' | 'icicle'): THREE.Group {
  if (kind === 'spear') {
    return group(
      part(cylinder(5), PALETTE.wood, [0, 0, 0], [0.05, 1.2, 0.05], [0, 0, Math.PI / 2]),
      part(cone(4), PALETTE.stoneDark, [0.66, 0, 0], [0.09, 0.2, 0.06], [0, 0, -Math.PI / 2]),
      part(box(), PALETTE.rope, [0.52, 0, 0], [0.07, 0.065, 0.065]),
    )
  }
  if (kind === 'stone') return group(part(lump(), PALETTE.stoneDark, [0, 0, 0], [0.14, 0.12, 0.14]))
  // A shard of ice, long and sharp, along +x.
  if (kind === 'shard') {
    return group(
      part(cone(4), PALETTE.ice, [0.14, 0, 0], [0.12, 0.3, 0.12], [0, 0, -Math.PI / 2]),
      part(cone(4), PALETTE.iceDeep, [-0.06, 0, 0], [0.12, 0.12, 0.12], [0, 0, Math.PI / 2]),
    )
  }
  // An icicle, point down.
  if (kind === 'icicle') {
    return group(part(cone(5), PALETTE.ice, [0, 0.35, 0], [0.3, 0.9, 0.3], [Math.PI, 0, 0]), part(cone(5), PALETTE.iceDeep, [0.06, 0.55, 0.04], [0.14, 0.5, 0.14], [Math.PI, 0, 0]))
  }
  const length = 0.6
  return group(
    part(cylinder(5), PALETTE.wood, [0, 0, 0], [0.04, length, 0.04], [0, 0, Math.PI / 2]),
    part(cone(4), PALETTE.stoneDark, [length / 2 + 0.06, 0, 0], [0.08, 0.14, 0.08], [0, 0, -Math.PI / 2]),
    part(box(), 0xf2efe6, [-length / 2 + 0.06, 0, 0], [0.12, 0.08, 0.01]),
  )
}

