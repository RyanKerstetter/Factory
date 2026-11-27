import * as THREE from 'three'
import { liquidLook } from '../liquids.ts'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
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
  // A feed trough's boards, its pale rim, its dark inside and legs, and the food in it.
  trough: 0xa7773f,
  troughRim: 0xe2b46e,
  // The trim along the top of a wooden wall.
  wallTrim: 0x7a5432,
  troughInside: 0x3a2414,
  troughDark: 0x5a3a20,
  feed: 0xc9a84e,
  feedLight: 0xe0c46a,
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

const glowingMaterials = new Map<number, THREE.MeshBasicMaterial>()
// A colour that is not lit, but glows as it is (embers, flames, eyes), shared by everything that colour. (One that
// changes as it is drawn, fading or flashing, has its own.)
function glowing(color: number): THREE.MeshBasicMaterial {
  let made = glowingMaterials.get(color)
  if (!made) {
    made = new THREE.MeshBasicMaterial({ color })
    glowingMaterials.set(color, made)
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

// A group to turn about `at`, holding `children` placed where they would be without it (in its parent's terms): they
// are moved to be relative to it.
function pivot(at: [number, number, number], ...children: THREE.Object3D[]): THREE.Group {
  const made = group(...children)
  made.position.set(...at)
  for (const child of children) child.position.sub(made.position)
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

// A crop in farmland, by how far it has grown: green shoots, taller, and golden ears once it is ready.
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

// A wooden wall: a frame clad in upright boards on both faces, as thick as what of it stands in the way (`wallBoxes`
// in fences.ts). Each board stands a little proud of or back from the ones beside it, its top a little uneven, with dark
// gaps between, over a dark sill at the foot. Seen from
// above it is open between its two faces down to a dark cavity, a narrow top beam running along it, and a post stands
// at each corner where two faces meet (its ends, its outside corners). A block in the middle of its tile, and a stretch
// out to each side it joins (`mask`, as a fence's), so walls side by side run on unbroken.
const WALL_THICK = 0.75
const WALL_HEIGHT = 0.95
// How wide a board is (as the floor's planks): a quarter of a tile. Boards lie on a grid of that, from the tile's
// edge, so a wall's pieces (its middle and its stretches out) and walls side by side all share it.
const WALL_BOARD = 0.25
// A stretch of wall from `from` to `to` along x (or, `alongZ`, z): its cavity (unless `core` is false), the boards and
// sill on the faces `faces` (-1 or 1: which side across it), and its top beam (along all of it, or
// from and to where `beam` says, or none). `tile` is the wall's tile, so its boards differ from every other wall's.
function boardWall(from: number, to: number, alongZ: boolean, faces: readonly number[], core = true, beam: boolean | readonly [number, number] = true, tile = { x: 0, y: 0 }): THREE.Object3D[] {
  const at = (along: number, up: number, across: number): [number, number, number] => (alongZ ? [across, up, along] : [along, up, across])
  const length = to - from
  const middle = (from + to) / 2
  const half = WALL_THICK / 2
  const made: THREE.Object3D[] = []
  // The cavity between the faces, its dark top well down from the boards' tops.
  if (core) made.push(part(box(), PALETTE.barkDark, at(middle, (WALL_HEIGHT - 0.09) / 2, 0), at(length, WALL_HEIGHT - 0.09, WALL_THICK - 0.1)))
  if (beam) {
    const [start, stop] = beam === true ? [from, to] : beam
    made.push(part(box(), PALETTE.wallTrim, at((start + stop) / 2, WALL_HEIGHT - 0.055, 0), at(stop - start, 0.05, 0.13)))
  }
  // The browns its boards are, as the wooden floor's: from dark to a little lighter, none yellow.
  const shades = [0x8a6844, 0x7a5a3a, 0x94724c, 0x6e5034, 0x86603c, 0x9a7a54]
  const gap = 0.012
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6
  for (const face of faces) {
    // The boards on the grid, each cut to this stretch: a gap only where a board ends, not where the stretch does.
    for (let k = Math.floor(from / WALL_BOARD + 1e-6); k * WALL_BOARD < to - 1e-6; k++) {
      const start = k * WALL_BOARD
      const a = Math.max(from, start) + (near(Math.max(from, start), start) ? gap / 2 : 0)
      const b = Math.min(to, start + WALL_BOARD) - (near(Math.min(to, start + WALL_BOARD), start + WALL_BOARD) ? gap / 2 : 0)
      if (b <= a) continue
      // Each board a little different, by its place on the grid (the same in every piece of it): its colour, how far it
      // stands out, and how high its top comes.
      // Its place in the world: along the wall (the boards of tiles side by side running on), and across it.
      const board = k + Math.round(1 / WALL_BOARD) * (alongZ ? tile.y : tile.x)
      const line = alongZ ? tile.x : tile.y
      const which = Math.abs(board * 5 + face * 3)
      const depth = which % 2 === 0 ? 0.075 : 0.06
      const height = WALL_HEIGHT + ((which % 3) - 1) * 0.015
      const shade = shades[hashInts(board, face, line, 31) % shades.length]
      made.push(part(box(), shade, at((a + b) / 2, height / 2, face * (half - 0.085 + depth / 2)), at(b - a, height, depth)))
    }
    // The sill at the boards' foot.
    made.push(part(box(), PALETTE.troughDark, at(middle, 0.035, face * (half + 0.005)), at(length, 0.07, 0.04)))
  }
  return made
}
export function woodWall(mask: number, x = 0, y = 0): THREE.Group {
  const tile = { x, y }
  const half = WALL_THICK / 2
  // The middle: boards on each face that does not run on into more wall; its top beam along each way it runs on,
  // stopping inside the boards at an end (not poking out through them).
  const inside = half - 0.06
  const beamAlong = (low: number, high: number): readonly [number, number] => [mask & low ? -half : -inside, mask & high ? half : inside]
  const made = group(
    ...boardWall(-half, half, false, [mask & 1 ? 0 : -1, mask & 4 ? 0 : 1].filter((face) => face !== 0), true, (mask & 10) !== 0 || (mask & 5) === 0 ? beamAlong(8, 2) : false, tile),
    ...boardWall(-half, half, true, [mask & 8 ? 0 : -1, mask & 2 ? 0 : 1].filter((face) => face !== 0), false, (mask & 5) !== 0 ? beamAlong(1, 4) : false, tile),
  )
  // Out to each side it joins, to the tile's edge.
  if (mask & 1) made.add(...boardWall(-0.5, -half, true, [-1, 1], true, true, tile))
  if (mask & 2) made.add(...boardWall(half, 0.5, false, [-1, 1], true, true, tile))
  if (mask & 4) made.add(...boardWall(half, 0.5, true, [-1, 1], true, true, tile))
  if (mask & 8) made.add(...boardWall(-0.5, -half, false, [-1, 1], true, true, tile))
  // A post at each corner where two faces meet, set in so it stands only a little proud of the boards: [the side
  // across x, the side across z, which sides make it].
  for (const [x, z, sides] of [[-1, -1, 9], [1, -1, 3], [1, 1, 6], [-1, 1, 12]] as const) {
    if (mask & sides) continue
    made.add(part(box(), PALETTE.troughDark, [x * (half - 0.035), (WALL_HEIGHT + 0.03) / 2, z * (half - 0.035)], [0.1, WALL_HEIGHT + 0.03, 0.1]))
  }
  return made
}

// A wooden door, after its icon (icons/buildings/wood-door.png): a short stretch of board wall at each side of its tile
// (meeting the walls beside it) and a door of upright planks between, braced across its back, with an iron ring for a
// handle, hung across x (`across`) or z, and swung open like a gate's leaf.
// The doorway is DOOR_WIDTH wide (its door too), between slim jambs, with a short stretch of wall either side.
const DOOR_WIDTH = 0.78
export function woodDoor(across: boolean, open: boolean): THREE.Group {
  const half = DOOR_WIDTH / 2
  const made = group(...boardWall(-0.5, -half, !across, [-1, 1]), ...boardWall(half, 0.5, !across, [-1, 1]))
  // A jamb post at the inside end of each, framing the doorway, and a lintel over it.
  for (const end of [-half, half]) made.add(part(box(), PALETTE.troughDark, across ? [end, (WALL_HEIGHT + 0.03) / 2, 0] : [0, (WALL_HEIGHT + 0.03) / 2, end], across ? [0.06, WALL_HEIGHT + 0.03, WALL_THICK + 0.02] : [WALL_THICK + 0.02, WALL_HEIGHT + 0.03, 0.06]))
  made.add(part(box(), PALETTE.troughDark, [0, WALL_HEIGHT - 0.02, 0], across ? [DOOR_WIDTH + 0.06, 0.08, 0.16] : [0.16, 0.08, DOOR_WIDTH + 0.06]))
  // The door, hung from its hinge side: planks side by side, light and dark, a brace from batten to batten and a handle.
  const door = new THREE.Group()
  const width = DOOR_WIDTH
  const planks = 5
  for (let i = 0; i < planks; i++) {
    const x = (width / planks) * (i + 0.5)
    door.add(part(box(), i % 2 === 0 ? PALETTE.wood : PALETTE.woodLight, [x, 0.44, 0], [width / planks - 0.008, 0.86, 0.07]))
  }
  for (const height of [0.2, 0.68]) door.add(part(box(), PALETTE.barkDark, [width / 2, height, -0.045], [width - 0.04, 0.07, 0.025]))
  const across2 = width - 0.12
  door.add(part(box(), PALETTE.barkDark, [width / 2, 0.44, -0.045], [0.06, Math.hypot(across2, 0.48), 0.025], [0, 0, Math.atan2(across2, 0.48)]))
  door.add(part(geometry('doorRing', () => new THREE.TorusGeometry(0.5, 0.18, 4, 8)), PALETTE.iron, [width - 0.1, 0.46, 0.05], [0.07, 0.07, 0.07]))
  door.position.set(across ? -half : 0, 0, across ? 0 : -half)
  door.rotation.y = (across ? 0 : -Math.PI / 2) + (open ? -Math.PI / 2 : 0)
  made.add(door)
  return made
}

// The floors: boards or stones lying just over the ground (so whatever stands on a floor stands on it), in rows across
// x, laid as if over the whole world rather than tile by tile: each row's joints are at its own offset and a little
// uneven, so no two rows line up and no grid shows, and a board or stone is the same (its colour, its height) in every
// tile it crosses. Where a floor is beside it (`mask`, as a fence's: north 1, east 2, south 4, west 8) a floor stops at
// its tile's edge, meeting the next one's without a seam; on its other sides it reaches FLOOR_LIP past its tile, so it
// covers the ground a wall leaves at the edge of its tile.
export const FLOOR_TOP = 0.03
const FLOOR_LIP = 0.125
type Deck = {
  // How wide a row is (a whole number of rows to a tile), how long a piece is on average and how much that varies
  // (a share of it), and the gap between pieces. Each row's joints are offset by `stagger` (a share of a piece, by
  // the row: the list over and over), or by chance without it.
  row: number
  length: number
  jitter: number
  gap: number
  // The gap between rows, if not `gap` (the camera, looking down from the south, sees less of a gap between rows than
  // along one).
  rowGap?: number
  stagger?: readonly number[]
  // What shows in the gaps; each piece's colour and how high its top is, by its row and its place along it.
  under: number
  color: (row: number, piece: number) => number
  top: (row: number, piece: number) => number
  // Whether each piece is nailed down at its ends.
  nails: boolean
}
function deck(x: number, y: number, mask: number, look: Deck): THREE.Group {
  const made = new THREE.Group()
  const west = mask & 8 ? -0.5 : -0.5 - FLOOR_LIP
  const east = mask & 2 ? 0.5 : 0.5 + FLOOR_LIP
  const north = mask & 1 ? -0.5 : -0.5 - FLOOR_LIP
  const south = mask & 4 ? 0.5 : 0.5 + FLOOR_LIP
  made.add(part(box(), look.under, [(west + east) / 2, FLOOR_TOP / 2 - 0.004, (north + south) / 2], [east - west, FLOOR_TOP - 0.008, south - north]))
  // The tile's west and east edges, in the world.
  const left = x + 0.5 + west
  const right = x + 0.5 + east
  const rows = Math.round(1 / look.row)
  for (let i = -rows; i <= rows; i++) {
    const rowGap = look.rowGap ?? look.gap
    const from = Math.max(north, (i - 0.5) * look.row + rowGap / 2)
    const to = Math.min(south, (i + 0.5) * look.row - rowGap / 2)
    if (to <= from) continue
    const row = y * rows + i
    const stagger = look.stagger
    const offset = (stagger ? stagger[((row % stagger.length) + stagger.length) % stagger.length] : vary(row, 7, 11)) * look.length
    // Where the joint after piece `k` of this row is, in the world.
    const joint = (k: number): number => (k + 1) * look.length + offset + (vary(k, row, 13) - 0.5) * look.jitter * look.length
    let k = Math.floor((left - offset) / look.length) - 2
    while (joint(k) <= left) k++
    let at = left
    for (;;) {
      const next = Math.min(joint(k), right)
      // The gap at a joint, not at the tile's edge.
      const a = at === left ? at : at + look.gap / 2
      const b = next === right ? next : next - look.gap / 2
      if (b > a) {
        const height = look.top(row, k)
        made.add(part(box(), look.color(row, k), [(a + b) / 2 - x - 0.5, height / 2, (from + to) / 2], [b - a, height, to - from]))
        if (look.nails) {
          const middle = (from + to) / 2
          for (const [end, edge] of [[a, at !== left], [b, next !== right]] as const) {
            if (!edge) continue
            const u = end - x - 0.5 + (end === a ? 0.03 : -0.03)
            for (const dz of [-0.055, 0.055]) made.add(part(box(), PALETTE.iron, [u, height + 0.001, middle + dz], [0.018, 0.004, 0.018]))
          }
        }
      }
      if (next >= right) break
      at = next
      k++
    }
  }
  return made
}

// A wooden floor, after its icon (icons/buildings/floors/wood-floor.png): dark planks a quarter of a tile wide and a
// tile long, all alike, each row's joints staggered from the next's, each plank a little different in colour, nailed
// at its ends.
export function woodFloor(x: number, y: number, mask = 0): THREE.Group {
  return deck(x, y, mask, {
    row: 0.25,
    length: 1,
    jitter: 0,
    gap: 0.012,
    stagger: [0.125, 0.625, 0.375, 0.875],
    under: 0x2e1e12,
    color: (row, piece) => new THREE.Color(PALETTE.wood).multiplyScalar(0.68 + vary(piece, row, 5) * 0.2).getHex(),
    top: () => FLOOR_TOP,
    nails: true,
  })
}

// A stone floor, after its icon (icons/buildings/floors/stone-floor.png): square stones a third of a tile across, all
// alike, every other row set half a stone along, in dark mortar.
export function stoneFloor(x: number, y: number, mask = 0): THREE.Group {
  return deck(x, y, mask, {
    row: 1 / 3,
    length: 1 / 3,
    jitter: 0,
    gap: 0.025,
    rowGap: 0.045,
    stagger: [0.25, 0.75],
    under: 0x4a4740,
    color: () => PALETTE.stone,
    top: () => FLOOR_TOP,
    nails: false,
  })
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

// A carpenter's bench, after its icon (icons/buildings/station/carpenters-bench.png): a long top of planks on four legs,
// a shelf under it with planks on it, and behind, a pegboard of dark holes with a saw, a hammer and a square hung on it;
// a saw and a plank lie on the top, and a vice is clamped to its right-hand end.
export function carpentersBench(): THREE.Group {
  const made = group()
  const back = -0.26
  // The top: planks along it, seams between them, its front edge pale.
  for (const [i, z] of [-0.18, 0, 0.18].entries()) made.add(part(box(), i === 1 ? PALETTE.woodLight : PALETTE.wood, [0, 0.5, z + 0.06], [0.96, 0.07, 0.175]))
  for (const z of [-0.03, 0.15]) made.add(part(box(), PALETTE.barkDark, [0, 0.537, z], [0.96, 0.004, 0.01]))
  made.add(part(box(), PALETTE.troughRim, [0, 0.5, 0.33], [0.97, 0.072, 0.02]))
  // The legs, a rail under the front of the top, and the shelf low down, two planks on it.
  for (const [lx, lz] of [[-0.42, -0.2], [0.42, -0.2], [-0.42, 0.3], [0.42, 0.3]]) made.add(part(box(), PALETTE.bark, [lx, 0.23, lz], [0.08, 0.46, 0.08]))
  made.add(part(box(), PALETTE.barkDark, [0, 0.43, 0.3], [0.78, 0.06, 0.04]))
  made.add(part(box(), PALETTE.wood, [0, 0.12, 0.05], [0.8, 0.03, 0.46]))
  made.add(part(box(), PALETTE.woodLight, [-0.1, 0.15, 0.08], [0.6, 0.03, 0.12], [0, 0.06, 0]))
  made.add(part(box(), PALETTE.wood, [-0.08, 0.18, 0.06], [0.56, 0.03, 0.11], [0, -0.04, 0]))
  // The pegboard behind, on two posts, its holes in two rows.
  for (const lx of [-0.44, 0.44]) made.add(part(box(), PALETTE.bark, [lx, 0.76, back], [0.07, 0.52, 0.06]))
  made.add(part(box(), PALETTE.wood, [0, 0.8, back], [0.86, 0.4, 0.04]))
  made.add(part(box(), PALETTE.troughRim, [0, 1.01, back], [0.92, 0.04, 0.06]))
  for (const y of [0.9, 0.72]) for (let i = 0; i < 6; i++) made.add(part(box(), PALETTE.barkDark, [-0.3 + i * 0.12, y, back + 0.022], [0.04, 0.04, 0.004]))
  // Hung on it: a saw (its handle and blade), a hammer, a square.
  made.add(part(box(), PALETTE.wood, [-0.28, 0.82, back + 0.04], [0.08, 0.1, 0.025]))
  made.add(part(box(), PALETTE.iron, [-0.28, 0.67, back + 0.04], [0.07, 0.22, 0.008]))
  made.add(part(box(), PALETTE.woodLight, [0.02, 0.78, back + 0.04], [0.025, 0.2, 0.025]))
  made.add(part(box(), PALETTE.iron, [0.02, 0.88, back + 0.045], [0.1, 0.04, 0.04]))
  made.add(part(box(), PALETTE.iron, [0.26, 0.86, back + 0.04], [0.14, 0.025, 0.008]))
  made.add(part(box(), PALETTE.iron, [0.32, 0.79, back + 0.04], [0.025, 0.14, 0.008]))
  // On the top: a saw lying across it, and a plank.
  made.add(part(box(), PALETTE.iron, [0.12, 0.54, 0.16], [0.3, 0.008, 0.08], [0, 0.3, 0]))
  made.add(part(box(), PALETTE.wood, [-0.06, 0.55, 0.2], [0.1, 0.03, 0.06], [0, 0.3, 0]))
  made.add(part(box(), PALETTE.woodLight, [-0.22, 0.55, 0.02], [0.4, 0.03, 0.1], [0, -0.08, 0]))
  // The vice at the right-hand end, with its screw.
  made.add(part(box(), PALETTE.bark, [0.47, 0.46, 0.22], [0.08, 0.16, 0.14]))
  made.add(part(cylinder(6), PALETTE.iron, [0.53, 0.46, 0.22], [0.025, 0.12, 0.025], [0, 0, Math.PI / 2]))
  return made
}

// ---- furniture: smooth, polished wood (not the flat facets of everything else), tops in one piece with softly rounded
// edges and a moulding under them, turned legs with bulbs and rings, and the ornament of their icons.
// The same browns as the walls' boards and the wooden floor (PALETTE.wood and its shades), not brighter or redder.
const FURNITURE = {
  top: 0x8c6a45,
  edge: 0x563c22,
  leg: 0x5c4026,
  ring: 0x7a5a38,
  dark: 0x3a2818,
}
const smoothMaterials = new Map<number, THREE.MeshStandardMaterial>()
function smooth(color: number): THREE.MeshStandardMaterial {
  let made = smoothMaterials.get(color)
  if (!made) {
    made = new THREE.MeshStandardMaterial({ color, flatShading: false, roughness: 0.8, metalness: 0 })
    smoothMaterials.set(color, made)
  }
  return made
}
// A part of a piece of furniture, in its smooth wood.
function wood(shape: THREE.BufferGeometry, color: number, at: [number, number, number], scale: [number, number, number] = [1, 1, 1], turn: [number, number, number] = [0, 0, 0]): THREE.Mesh {
  const mesh = part(shape, color, at, scale, turn)
  mesh.material = smooth(color)
  return mesh
}
// A slab with softly rounded edges, of a size (cached by it).
function roundedSlab(width: number, height: number, depth: number, radius: number): THREE.BufferGeometry {
  return geometry(`slab${width}|${height}|${depth}|${radius}`, () => new RoundedBoxGeometry(width, height, depth, 3, radius))
}
// A turned shape, from its profile (pairs of radius and height, bottom to top), round its upright.
function turned(key: string, profile: ReadonlyArray<readonly [number, number]>): THREE.BufferGeometry {
  return geometry(`turned${key}`, () => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 14))
}
// A turned leg `height` tall (scaled from one a unit tall): a foot, a bulb low down, a ring, a slim shaft, a ring and a
// collar at the top, where it meets the apron.
const LEG_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.034, 0], [0.04, 0.03], [0.03, 0.07], [0.026, 0.14], [0.042, 0.24], [0.046, 0.3], [0.03, 0.37], [0.024, 0.46],
  [0.022, 0.62], [0.03, 0.7], [0.034, 0.74], [0.026, 0.78], [0.032, 0.82], [0.032, 1], [0, 1],
]
function leg(at: [number, number], height: number): THREE.Mesh {
  return wood(turned('leg', LEG_PROFILE), FURNITURE.leg, [at[0], 0, at[1]], [1, height, 1])
}
// A table top: one smooth slab, its rounded edge a little darker, and a moulding under it.
function tableTop(y: number, width: number, depth: number, thick: number): THREE.Object3D[] {
  return [
    wood(roundedSlab(width, thick, depth, 0.02), FURNITURE.top, [0, y, 0]),
    wood(roundedSlab(width - 0.05, 0.02, depth - 0.05, 0.008), FURNITURE.edge, [0, y - thick / 2 - 0.008, 0]),
  ]
}
// An apron round under a top, with a carved drop hanging from the middle of its long sides.
function apron(y: number, width: number, depth: number, tall: number): THREE.Object3D[] {
  const made: THREE.Object3D[] = []
  for (const z of [-depth / 2, depth / 2]) made.push(wood(roundedSlab(width, tall, 0.035, 0.008), FURNITURE.edge, [0, y, z]))
  for (const x of [-width / 2, width / 2]) made.push(wood(roundedSlab(0.035, tall, depth, 0.008), FURNITURE.edge, [x, y, 0]))
  for (const z of [-depth / 2, depth / 2]) {
    // The drop: a half disc under the apron, and a bead below it.
    made.push(wood(geometry('drop', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false, -Math.PI / 2, Math.PI)), FURNITURE.edge, [0, y - tall / 2, z], [0.14, 0.035, 0.14], [Math.PI / 2, 0, 0]))
    made.push(wood(geometry('bead', () => new THREE.SphereGeometry(0.5, 10, 8)), FURNITURE.ring, [0, y - tall / 2 - 0.075, z], [0.04, 0.04, 0.04]))
  }
  return made
}

// A table, after its icon (icons/buildings/furniture/table.png): a smooth top nearly as big as its tile on four turned
// legs, an apron under it with a carved drop in the middle of each long side.
export function table(): THREE.Group {
  const made = group(...tableTop(0.565, 0.94, 0.86, 0.06), ...apron(0.49, 0.8, 0.72, 0.08))
  for (const [x, z] of [[-0.4, -0.36], [0.4, -0.36], [-0.4, 0.36], [0.4, 0.36]] as const) made.add(leg([x, z], 0.535))
  return made
}

// A low table, after its icon (icons/buildings/furniture/low-table.png): the same, long and low, on short turned legs.
export function lowTable(): THREE.Group {
  const made = group(...tableTop(0.33, 0.96, 0.78, 0.055), ...apron(0.265, 0.82, 0.64, 0.065))
  for (const [x, z] of [[-0.41, -0.32], [0.41, -0.32], [-0.41, 0.32], [0.41, 0.32]] as const) made.add(leg([x, z], 0.3))
  return made
}

// A round table, after its icon (icons/buildings/furniture/round-table.png): a round top nearly as wide as its tile on
// one turned post, bulbs and rings up it, standing on four feet curving out to the ground.
const PEDESTAL_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.09, 0], [0.09, 0.04], [0.06, 0.07], [0.05, 0.1], [0.075, 0.16], [0.08, 0.2], [0.05, 0.25], [0.04, 0.3],
  [0.055, 0.34], [0.06, 0.37], [0.04, 0.4], [0.035, 0.46], [0.06, 0.5], [0.07, 0.53], [0, 0.53],
]
export function roundTable(): THREE.Group {
  const made = group(
    wood(geometry('roundTop', () => new THREE.CylinderGeometry(0.47, 0.47, 0.06, 40)), FURNITURE.top, [0, 0.565, 0]),
    // The rounded edge round the top, a little darker.
    wood(geometry('roundEdge', () => new THREE.TorusGeometry(0.47, 0.03, 8, 48).rotateX(Math.PI / 2)), FURNITURE.edge, [0, 0.565, 0]),
    wood(geometry('roundMoulding', () => new THREE.CylinderGeometry(0.36, 0.36, 0.03, 32)), FURNITURE.edge, [0, 0.52, 0]),
    wood(turned('pedestal', PEDESTAL_PROFILE), FURNITURE.leg, [0, 0, 0]),
  )
  // The feet: each a curve out from the foot of the post down to the ground, ending in a small pad.
  for (let i = 0; i < 4; i++) {
    const turn = (i / 4) * Math.PI * 2 + Math.PI / 4
    const foot = new THREE.Group()
    foot.add(wood(roundedSlab(0.3, 0.06, 0.07, 0.025), FURNITURE.leg, [0.17, 0.06, 0], [1, 1, 1], [0, 0, -0.28]))
    foot.add(wood(roundedSlab(0.08, 0.035, 0.08, 0.015), FURNITURE.ring, [0.32, 0.018, 0]))
    foot.rotation.y = -turn
    made.add(foot)
  }
  return made
}

// A chair, after its icon (icons/buildings/furniture/chair.png), facing south (towards the camera): a smooth seat on
// turned legs, stretchers between them, and a tall back of turned spindles between two posts under a curved crest rail
// pierced with a row of holes.
const POST_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.03, 0], [0.034, 0.03], [0.024, 0.08], [0.022, 0.3], [0.032, 0.36], [0.024, 0.4], [0.021, 0.62], [0.028, 0.66],
  [0.021, 0.7], [0.021, 0.9], [0.032, 0.94], [0.028, 0.98], [0, 1],
]
export function chair(): THREE.Group {
  const back = -0.19
  const rail = (): THREE.BufferGeometry => geometry('rail', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10))
  const made = group(
    wood(roundedSlab(0.48, 0.05, 0.46, 0.02), FURNITURE.top, [0, 0.36, 0.02]),
    wood(roundedSlab(0.44, 0.02, 0.42, 0.008), FURNITURE.edge, [0, 0.327, 0.02]),
  )
  // Front legs, and the back posts running on up into the back.
  for (const x of [-0.2, 0.2]) {
    made.add(leg([x, 0.21], 0.33))
    made.add(wood(turned('post', POST_PROFILE), FURNITURE.leg, [x, 0, back], [1, 0.98, 1]))
  }
  // Stretchers between the legs, low down.
  for (const x of [-0.2, 0.2]) made.add(wood(rail(), FURNITURE.leg, [x, 0.1, 0.01], [0.022, 0.4, 0.022], [Math.PI / 2, 0, 0]))
  made.add(wood(rail(), FURNITURE.leg, [0, 0.1, 0.21], [0.022, 0.4, 0.022], [0, 0, Math.PI / 2]))
  // The back: three turned spindles from a lower rail up to the crest.
  made.add(wood(roundedSlab(0.4, 0.04, 0.035, 0.012), FURNITURE.edge, [0, 0.44, back]))
  for (const x of [-0.1, 0, 0.1]) made.add(wood(turned('post', POST_PROFILE), FURNITURE.ring, [x, 0.44, back], [0.7, 0.4, 0.7]))
  // The crest rail: a slab with a curved top, pierced with a row of holes.
  made.add(wood(roundedSlab(0.44, 0.1, 0.045, 0.015), FURNITURE.top, [0, 0.89, back]))
  made.add(wood(geometry('crest', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1, false, Math.PI / 2, Math.PI)), FURNITURE.top, [0, 0.94, back], [0.36, 0.045, 0.06], [Math.PI / 2, 0, 0]))
  for (const x of [-0.12, -0.04, 0.04, 0.12]) made.add(part(box(), FURNITURE.dark, [x, 0.89, back + 0.024], [0.035, 0.035, 0.006]))
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
      const ember = new THREE.Mesh(lump(), glowing(ex > 0 ? 0xff5a1a : 0xff8a2a))
      ember.position.set(ex, 0.05, ez)
      ember.scale.set(0.08, 0.05, 0.08)
      made.add(ember)
    }
    // Flames: a tall one in the middle and lower tongues round it, each with a bright core.
    const flame = (color: number, at: [number, number, number], scale: [number, number, number]): void => {
      const mesh = new THREE.Mesh(cone(6), glowing(color))
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
    const glow = new THREE.Mesh(box(), glowing(0xff6a1a))
    // Just in front of the dark inside (never on it), behind the frame stones.
    glow.position.set(0, 0.07, mouthZ + 0.03)
    glow.scale.set(MOUTH_HALF * 1.6, 0.08, 0.02)
    made.add(glow)
    for (const [fx, height] of [[-0.05, 0.13], [0.05, 0.1], [0, 0.17]] as const) {
      const flame = new THREE.Mesh(cone(6), glowing(fx === 0 ? PALETTE.flameCore : PALETTE.flame))
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

// A waystone: a squat block of blue-grey stone with a flat top, narrowing a little as it rises (WAYSTONE_TAPER), on a
// base of two steps of dark stone. Three marks are cut in its face to the right of its middle, each in a carved rim, two
// bars and a small square above them, which light up from the bottom as it charges (see waystone-effects.ts, which
// draws the light over them at WAYSTONE_LIGHTS).
const WAYSTONE = {
  stone: 0x6f7186,
  base: 0x2e2f37,
  step: 0x45474f,
  mark: 0x14131b,
  rim: 0x5a5d72,
}
const WAYSTONE_WIDTH = 0.48
const WAYSTONE_DEPTH = 0.34
const WAYSTONE_BASE = 0.11
const WAYSTONE_TOP = 0.66
// How wide its top is, as a share of its foot.
const WAYSTONE_TAPER = 0.84
// How far in front of its middle its face is at a height (tiles), as the face leans back while it narrows.
function waystoneFace(y: number): number {
  const up = (y - WAYSTONE_BASE) / (WAYSTONE_TOP - WAYSTONE_BASE)
  return (WAYSTONE_DEPTH / 2) * (1 - (1 - WAYSTONE_TAPER) * up)
}
// How far its face leans back (radians).
const WAYSTONE_LEAN = Math.atan(((WAYSTONE_DEPTH / 2) * (1 - WAYSTONE_TAPER)) / (WAYSTONE_TOP - WAYSTONE_BASE))
// Where each of a waystone's marks is (tiles, from its tile's middle on the ground; `z` just in front of its face), and
// how wide and high, level by level from the bottom (see WARP_LIGHT_LEVELS): the bars, then the square at the top, the
// keystone.
export const WAYSTONE_LIGHTS: ReadonlyArray<{ x: number; y: number; z: number; w: number; h: number; level: number }> = [
  ...Array.from({ length: WARP_LIGHT_LEVELS }, (_, level) => ({ x: 0.08, y: 0.28 + level * 0.11, w: 0.1, h: 0.035, level })),
  { x: 0.11, y: 0.28 + WARP_LIGHT_LEVELS * 0.11 + 0.01, w: 0.045, h: 0.045, level: WARP_LIGHT_LEVELS },
].map((light) => ({ ...light, z: waystoneFace(light.y) }))
export function waystone(): THREE.Group {
  const tall = WAYSTONE_TOP - WAYSTONE_BASE
  // The block: a four-sided frustum, a square at its foot narrowing to WAYSTONE_TAPER of it at its flat top, stretched
  // to its width and depth.
  const block = geometry('waystoneBlock', () =>
    new THREE.CylinderGeometry((WAYSTONE_TAPER * Math.SQRT2) / 2, Math.SQRT2 / 2, 1, 4, 1).rotateY(Math.PI / 4),
  )
  const made = group(
    part(box(), WAYSTONE.base, [0, 0.03, 0], [WAYSTONE_WIDTH + 0.18, 0.06, WAYSTONE_DEPTH + 0.16]),
    part(box(), WAYSTONE.step, [0, 0.085, 0], [WAYSTONE_WIDTH + 0.08, 0.05, WAYSTONE_DEPTH + 0.07]),
    part(block, WAYSTONE.stone, [0, WAYSTONE_BASE + tall / 2, 0], [WAYSTONE_WIDTH, tall, WAYSTONE_DEPTH]),
  )
  // The marks, cut dark into its face, each in a carved rim, leaning back with it.
  for (const light of WAYSTONE_LIGHTS) {
    made.add(part(box(), WAYSTONE.rim, [light.x, light.y, light.z + 0.002], [light.w + 0.024, light.h + 0.024, 0.008], [-WAYSTONE_LEAN, 0, 0]))
    made.add(part(box(), WAYSTONE.mark, [light.x, light.y, light.z + 0.004], [light.w, light.h, 0.008], [-WAYSTONE_LEAN, 0, 0]))
  }
  return made
}

// A target dummy: a post driven into the ground, a sack stuffed with straw for a body tied round with rope, a crossbar
// for arms with straw sticking out of the ends, a sack for a head, and a red target painted on its chest (facing the
// camera). It sways when hit, like a plant (see `shakes`).
export function targetDummy(): THREE.Group {
  const sack = 0xc9b07a
  const sackDark = 0xa88f5c
  const rope = 0x8a6a3e
  const red = 0xb8322c
  return group(
    // The post, and a stake either side at its foot.
    part(box(), PALETTE.wood, [0, 0.4, 0], [0.08, 0.8, 0.08]),
    part(box(), PALETTE.woodLight, [0, 0.03, 0], [0.26, 0.06, 0.1]),
    // The crossbar for arms, the straw poking out of each end.
    part(box(), PALETTE.wood, [0, 0.78, 0], [0.62, 0.06, 0.06]),
    part(box(), PALETTE.hay, [-0.34, 0.78, 0], [0.08, 0.1, 0.1]),
    part(box(), PALETTE.hay, [0.34, 0.78, 0], [0.08, 0.1, 0.1]),
    // The body, a stuffed sack, tied round at the waist and the neck.
    part(box(), sack, [0, 0.62, 0], [0.34, 0.42, 0.26]),
    part(box(), rope, [0, 0.45, 0], [0.36, 0.035, 0.28]),
    part(box(), rope, [0, 0.83, 0], [0.2, 0.035, 0.18]),
    // Straw sticking out under the body.
    part(box(), PALETTE.hay, [0, 0.38, 0], [0.24, 0.08, 0.18]),
    // The head, a smaller sack, with stitched eyes.
    part(box(), sack, [0, 0.98, 0], [0.24, 0.24, 0.22]),
    part(box(), sackDark, [-0.05, 1.0, 0.112], [0.04, 0.04, 0.01]),
    part(box(), sackDark, [0.05, 1.0, 0.112], [0.04, 0.04, 0.01]),
    // The target on its chest: rings of red and straw.
    part(box(), red, [0, 0.64, 0.131], [0.22, 0.22, 0.01]),
    part(box(), sack, [0, 0.64, 0.136], [0.14, 0.14, 0.01]),
    part(box(), red, [0, 0.64, 0.141], [0.06, 0.06, 0.01]),
  )
}

// A worker skeleton (waiting for orders: it does nothing yet), facing out of its tile towards the camera: a skeleton
// standing easy, a heart of essence glowing blue in its ribs and in its eyes, a leather apron, and a pickaxe slung on
// its back.
export function workerSkeleton(): THREE.Group {
  const essence = glowing(0x8fd6ff)
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

// Farmland: its soil dark where it is well watered, drying out to pale (`water` 0 to 100).
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

// A feed trough, after its icon (icons/buildings/feed-trough.png): a long wooden trough on four short legs, its sides
// flaring out to a pale rim, dark inside. The food in it shows how full it is (`feed`, 0 empty to 1 full): a bed of it
// rising from the trough's floor to heaped just under the rim; empty, only the bare boards.
const TROUGH_FLOOR = 0.24
const TROUGH_DEPTH = 0.24
const TROUGH_FLARE = 0.28
export function feeder(feed = 0): THREE.Group {
  const made = group(
    // The legs, splayed a little, and a rail between each pair.
    ...[-1, 1].flatMap((x) => [-1, 1].map((z) => part(box(), PALETTE.troughDark, [x * 0.36, TROUGH_FLOOR / 2, z * 0.17], [0.06, TROUGH_FLOOR + 0.02, 0.06], [z * 0.12, 0, 0]))),
    ...[-1, 1].map((x) => part(box(), PALETTE.troughDark, [x * 0.36, 0.08, 0], [0.04, 0.04, 0.36])),
    // The floor and the dark inside.
    part(box(), PALETTE.trough, [0, TROUGH_FLOOR, 0], [0.84, 0.04, 0.4]),
    part(box(), PALETTE.troughInside, [0, TROUGH_FLOOR + 0.025, 0], [0.76, 0.01, 0.34]),
  )
  // The long sides, flaring out, each with its pale rim along the top.
  for (const side of [-1, 1]) {
    const lean = side * TROUGH_FLARE
    const wall = group(
      part(box(), PALETTE.trough, [0, 0, 0], [0.84, TROUGH_DEPTH + 0.04, 0.04]),
      part(box(), PALETTE.troughInside, [0, 0.01, -side * 0.021], [0.78, TROUGH_DEPTH, 0.004]),
      part(box(), PALETTE.troughRim, [0, (TROUGH_DEPTH + 0.04) / 2 + 0.015, 0], [0.9, 0.03, 0.07]),
    )
    wall.position.set(0, TROUGH_FLOOR + TROUGH_DEPTH / 2, side * (0.19 + Math.sin(TROUGH_FLARE) * TROUGH_DEPTH * 0.5))
    wall.rotation.x = lean
    made.add(wall)
  }
  // The ends: boards wide enough to close the flared sides, a pale rim on each.
  const top = TROUGH_FLOOR + TROUGH_DEPTH + 0.02
  for (const x of [-1, 1]) {
    made.add(part(box(), PALETTE.trough, [x * 0.42, TROUGH_FLOOR + TROUGH_DEPTH / 2, 0], [0.05, TROUGH_DEPTH + 0.04, 0.4 + 2 * Math.sin(TROUGH_FLARE) * TROUGH_DEPTH]))
    made.add(part(box(), PALETTE.troughRim, [x * 0.42, top + 0.015, 0], [0.08, 0.03, 0.44 + 2 * Math.sin(TROUGH_FLARE) * TROUGH_DEPTH]))
  }
  // The food: as deep as it is full, its top as wide as the flared sides are at that height (its body as narrow as the
  // floor, so it never pokes through them), with a few heaps on top.
  const fill = Math.max(0, Math.min(1, feed))
  if (fill > 0) {
    const depth = 0.03 + (TROUGH_DEPTH - 0.06) * fill
    const width = 0.32 + 2 * Math.tan(TROUGH_FLARE) * depth
    made.add(part(box(), PALETTE.feed, [0, TROUGH_FLOOR + 0.02 + depth / 2, 0], [0.76, depth, 0.32]))
    made.add(part(box(), PALETTE.feed, [0, TROUGH_FLOOR + 0.02 + depth - 0.012, 0], [0.76, 0.024, width]))
    for (const [x, z, size] of [[-0.22, -0.04, 0.16], [0.05, 0.05, 0.2], [0.25, -0.03, 0.14]] as const) {
      made.add(part(blob(), PALETTE.feedLight, [x, TROUGH_FLOOR + 0.02 + depth, z], [size, 0.06 + 0.04 * fill, size * 0.8]))
    }
  }
  return made
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
    knee.add(foot)
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

// The bone armour's leather (dark, nearly grey: it only holds the bones), and its horns (see `wear`); and the brown
// leather the bone weapons' grips are bound in.
const LEATHER = 0x48423c
const LEATHER_DARK = 0x2c2926
const HORN = 0x6e5a44
const HORN_TIP = 0x34281c
const GRIP = 0x6e4426

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
      if (key === 'bone-greaves') {
        boneGreave(foot)
        continue
      }
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
    } else if (key === 'bone-helmet') boneHelmet(worn)
    else worn.add(part(blob(), color, [-0.02, 0.98, 0], [0.23, 0.14, 0.23]))
    return
  }
  if (slot === 'body' && key === 'bone-chestplate') {
    boneChestplate(worn, sleeves)
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

// The bone helmet, after its icon (icons/armor/bone-helmet.png): a horned beast's skull worn over the head on a dark
// leather cap, its face over the brow with dark eye sockets and its snout, and two horns sweeping out and up, dark at
// their tips; thin straps down the cheeks.
function boneHelmet(worn: THREE.Object3D): void {
  worn.add(part(blob(), LEATHER, [-0.025, 0.955, 0], [0.23, 0.14, 0.23]))
  worn.add(part(blob(), PALETTE.bone, [-0.02, 0.995, 0], [0.235, 0.13, 0.225]))
  // The face: a broad plate of bone over the brow, its eye sockets, and the snout coming down over the nose.
  worn.add(part(box(), PALETTE.bone, [0.075, 0.995, 0], [0.06, 0.11, 0.17]))
  worn.add(part(box(), PALETTE.boneDark, [0.108, 1.04, 0], [0.012, 0.02, 0.14]))
  for (const z of [-0.045, 0.045]) worn.add(part(box(), 0x1e1a14, [0.106, 1.0, z], [0.012, 0.035, 0.04]))
  worn.add(part(box(), PALETTE.bone, [0.115, 0.955, 0], [0.05, 0.055, 0.085]))
  worn.add(part(box(), PALETTE.boneDark, [0.13, 0.93, 0], [0.04, 0.02, 0.07]))
  for (const z of [-0.018, 0.018]) worn.add(part(box(), 0x1e1a14, [0.141, 0.955, z], [0.006, 0.016, 0.012]))
  // The horns: from the sides of the skull out, then sweeping up and forward, darker towards their points.
  for (const side of [-1, 1]) {
    const points: Array<[number, number, number]> = [
      [-0.01, 1.03, side * 0.095],
      [0.0, 1.06, side * 0.18],
      [0.035, 1.12, side * 0.235],
      [0.075, 1.19, side * 0.235],
    ]
    worn.add(stick(PALETTE.boneDark, points[0], points[1], 0.05, 6))
    worn.add(stick(HORN, points[1], points[2], 0.042, 6))
    worn.add(stick(HORN_TIP, points[2], points[3], 0.032, 6))
    worn.add(part(cone(5), HORN_TIP, [0.09, 1.225, side * 0.228], [0.026, 0.06, 0.026], [0, 0, -0.45]))
    worn.add(part(box(), LEATHER_DARK, [0.025, 0.885, side * 0.087], [0.025, 0.1, 0.01]))
  }
}

// The bone chestplate, after its icon (icons/armor/bone-chesplate.png): a ribcage of bone, square and right round the
// body, its ribs running across the front, down the sides and round the back to the spine, its breastbone down the
// middle; collarbones, a shoulder blade over each shoulder with a row of bones along its top; a bone down the front of
// each arm; and a skirt of bone plates hanging from the belt. The leather under it (a dark jerkin, the belt) only holds
// the bones on.
function boneChestplate(worn: THREE.Object3D, sleeves: Array<THREE.Object3D | undefined>): void {
  worn.add(part(box(), LEATHER, [0, 0.61, 0], [0.162, 0.25, 0.272]))
  worn.add(part(box(), LEATHER, [0, 0.725, 0], [0.166, 0.075, 0.336]))
  worn.add(part(box(), LEATHER_DARK, [0, 0.77, 0], [0.12, 0.024, 0.14]))
  // The ribs, square round the body: across the front from the breastbone, down each side (a little thinner, so their
  // faces never lie in the front's), and round the back to the spine.
  for (const y of [0.702, 0.654, 0.606, 0.558]) {
    for (const side of [-1, 1]) {
      worn.add(part(box(), PALETTE.bone, [0.089, y, side * 0.077], [0.016, 0.026, 0.11]))
      worn.add(part(box(), PALETTE.boneDark, [0, y, side * 0.142], [0.17, 0.022, 0.014]))
      worn.add(part(box(), PALETTE.bone, [-0.089, y, side * 0.077], [0.016, 0.026, 0.11]))
    }
  }
  // The breastbone, and the spine with its knobs.
  worn.add(part(box(), PALETTE.bone, [0.094, 0.62, 0], [0.014, 0.23, 0.04]))
  worn.add(part(box(), PALETTE.bone, [-0.094, 0.615, 0], [0.014, 0.24, 0.032]))
  for (let i = 0; i < 5; i++) worn.add(part(box(), PALETTE.boneDark, [-0.104, 0.52 + i * 0.046, 0], [0.008, 0.018, 0.044]))
  // The collarbones, and over each shoulder its blade of bone with a row of bones along its top.
  for (const side of [-1, 1]) {
    worn.add(part(box(), PALETTE.bone, [0.074, 0.758, side * 0.085], [0.03, 0.024, 0.13]))
    worn.add(part(blob(), PALETTE.bone, [0, 0.785, side * 0.19], [0.15, 0.048, 0.115]))
    for (const x of [-0.045, 0, 0.045]) worn.add(part(box(), PALETTE.boneDark, [x, 0.812, side * 0.19], [0.024, 0.03, 0.085]))
    worn.add(part(cone(4), PALETTE.bone, [0, 0.835, side * 0.23], [0.035, 0.07, 0.035], [side * -0.5, 0, 0]))
  }
  // The belt, a buckle of bone, and the skirt of bone plates hanging from it all round.
  worn.add(part(box(), LEATHER_DARK, [0, 0.49, 0], [0.168, 0.032, 0.278]))
  worn.add(part(box(), PALETTE.bone, [0.087, 0.49, 0], [0.012, 0.04, 0.05]))
  for (let i = 0; i < 8; i++) {
    const turn = (i / 8) * Math.PI * 2
    const plate = part(box(), i % 2 === 0 ? PALETTE.bone : PALETTE.boneDark, [Math.cos(turn) * 0.085, 0.425, Math.sin(turn) * 0.13], [0.016, 0.1, 0.07])
    plate.rotation.set(0, -turn, -0.08)
    worn.add(plate)
  }
  // The sleeves: thin dark leather, a bone down the front of the upper arm and another down the forearm.
  sleeves.forEach((sleeve) => {
    sleeve?.add(part(box(), LEATHER, [0, -0.08, 0], [0.077, 0.16, 0.077]))
    sleeve?.add(part(box(), PALETTE.bone, [0.043, -0.1, 0], [0.014, 0.15, 0.038]))
    sleeve?.add(part(box(), PALETTE.bone, [0.044, -0.26, 0], [0.014, 0.1, 0.032]))
    sleeve?.add(part(box(), LEATHER_DARK, [0, -0.205, 0], [0.081, 0.018, 0.081]))
  })
}

// A bone greave, after its icon (icons/armor/bone-greaves.png), on one foot (see `wear`): a shaped boot of dark
// leather (a round toe), its leather going on up round the whole shin to the knee, solid all round (wider than the
// shin, square as it is, so none of it shows through), with bone along it: a toe cap, plates down the top of the foot,
// strips along its sides; up the shin, a plate of bone with splints down its sides and a kneecap, strapped on. (Nothing
// lies in the same plane as anything it touches, so nothing flickers.)
function boneGreave(foot: THREE.Object3D): void {
  foot.add(part(box(), LEATHER_DARK, [0.035, 0.008, 0], [0.16, 0.016, 0.094]))
  foot.add(part(blob(), LEATHER, [0.045, 0.045, 0], [0.17, 0.075, 0.093]))
  // The leather round the shin (0.075 across), from the sole to the knee (0.21 up), with a darker rolled top.
  foot.add(part(box(), LEATHER, [0.002, 0.1165, 0], [0.096, 0.197, 0.097]))
  foot.add(part(box(), LEATHER_DARK, [0.002, 0.209, 0], [0.104, 0.016, 0.105]))
  // Bone along the boot: its toe cap, plates down the top of the foot, and a strip along each side.
  foot.add(part(blob(), PALETTE.bone, [0.108, 0.045, 0], [0.066, 0.058, 0.084]))
  for (const [x, y, tilt] of [[0.072, 0.077, 0.5], [0.042, 0.1, 0.35]] as const) {
    foot.add(part(box(), PALETTE.bone, [x, y, 0], [0.03, 0.014, 0.062], [0, 0, tilt]))
  }
  for (const z of [-1, 1]) foot.add(part(box(), PALETTE.boneDark, [0.045, 0.05, z * 0.054], [0.11, 0.022, 0.006]))
  // Up the shin, over the leather: the plate, its splints, the kneecap, and two thin straps round them all.
  foot.add(part(box(), PALETTE.bone, [0.06, 0.15, 0], [0.018, 0.13, 0.066]))
  for (const z of [-1, 1]) foot.add(part(box(), PALETTE.boneDark, [0.004, 0.14, z * 0.055], [0.06, 0.12, 0.01]))
  foot.add(part(blob(), PALETTE.bone, [0.062, 0.222, 0], [0.05, 0.05, 0.066]))
  for (const y of [0.1, 0.18]) foot.add(part(box(), LEATHER_DARK, [0.008, y, 0], [0.124, 0.014, 0.124]))
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
      // Two limbs bent forward from the grip, and the string straight between their tips (`rest`: where its middle is
      // when it is not drawn; see three-view's `poseArms`).
      const made = group(
        part(box(), PALETTE.wood, [0, -0.04, 0], [0.05, 0.08, 0.05]),
        part(box(), PALETTE.wood, [0.17, -0.07, 0], [0.32, 0.04, 0.04], [0, 0, 0.25]),
        part(box(), PALETTE.wood, [-0.17, -0.07, 0], [0.32, 0.04, 0.04], [0, 0, -0.25]),
      )
      made.add(bowString(0.32, -0.03))
      return made
    }
    case 'bone-longbow':
      return boneLongbow()
    case 'skewer':
      return skewer()
    case 'permafrost':
      return permafrost()
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

// A bow's string: straight from tip to tip (at `x` each side, `y` along the hand), its middle the point drawn back.
function bowString(x: number, y: number): THREE.Line {
  const string = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, 0), new THREE.Vector3(0, y, 0), new THREE.Vector3(-x, y, 0)]),
    new THREE.LineBasicMaterial({ color: 0xf2efe6 }),
  )
  string.name = 'bow-string'
  string.userData.rest = y
  return string
}

// The bone longbow, after its icon (icons/tools/weapons/bone-longbow.png): a long bow of bone in one smooth curve, thick
// at the grip and tapering to the tips, its grip bound in leather; its tips capped darker and bent back a little, nocked
// for the string, which runs straight between them.
function boneLongbow(): THREE.Group {
  const half = 0.46
  const depth = 0.11
  const at = (t: number): [number, number, number] => [t * half, depth * t * t, 0]
  const made = group()
  const steps = 12
  for (let i = 0; i < steps; i++) {
    const from = -1 + (2 * i) / steps
    const to = -1 + (2 * (i + 1)) / steps
    made.add(stick(PALETTE.bone, at(from), at(to), 0.052 - 0.024 * Math.abs((from + to) / 2), 6))
  }
  made.add(stick(GRIP, at(-0.15), at(0.15), 0.066, 6))
  for (const side of [-1, 1]) {
    const tip = at(side)
    made.add(stick(PALETTE.boneDark, tip, [tip[0] + side * 0.045, tip[1] - 0.045, 0], 0.03, 5))
    made.add(part(ball(), PALETTE.boneDark, tip, [0.036, 0.036, 0.036]))
  }
  made.add(bowString(half, depth))
  return made
}

// The skewer, after its icon (icons/tools/weapons/skewer.png): a long spear of bone, capped at its butt, its lower half
// bound in a leather grip; at its head, bound on with leather, a long point of bone barbed back along both edges.
function skewer(): THREE.Group {
  const made = group(
    part(cylinder(6), PALETTE.bone, [0, -0.3, 0], [0.045, 1.3, 0.045]),
    part(ball(), PALETTE.bone, [0, 0.36, 0], [0.066, 0.066, 0.066]),
    part(cylinder(6), GRIP, [0, 0.05, 0], [0.058, 0.52, 0.058]),
    part(cylinder(6), GRIP, [0, -0.93, 0], [0.06, 0.08, 0.06]),
    part(cone(4), PALETTE.bone, [0, -1.12, 0], [0.09, 0.3, 0.035], [Math.PI, 0, 0]),
  )
  // The barbs, along both edges of the point, hooked back towards the grip.
  for (const [y, size] of [[-1.02, 0.1], [-1.1, 0.075]] as const) {
    for (const side of [-1, 1]) made.add(part(cone(3), PALETTE.boneDark, [side * 0.05, y, 0], [0.03, size, 0.022], [0, 0, -side * 0.55]))
  }
  return made
}

// Permafrost, after its icon (icons/tools/weapons/permafrost.png): a short staff of bone, capped at its foot, bound in
// leather at the grip and under its head, where three claws of bone hold a great crystal of ice, glowing.
function permafrost(): THREE.Group {
  const made = group(
    part(cylinder(6), PALETTE.bone, [0, -0.22, 0], [0.042, 0.98, 0.042]),
    part(ball(), PALETTE.boneDark, [0, 0.27, 0], [0.06, 0.06, 0.06]),
    part(cylinder(6), GRIP, [0, 0, 0], [0.056, 0.3, 0.056]),
    part(cylinder(6), GRIP, [0, -0.64, 0], [0.056, 0.09, 0.056]),
  )
  // Three claws, curling up round the crystal.
  for (let i = 0; i < 3; i++) {
    const turn = (i / 3) * Math.PI * 2
    const out = (r: number): [number, number] => [Math.cos(turn) * r, Math.sin(turn) * r]
    const [ax, az] = out(0.025)
    const [bx, bz] = out(0.085)
    const [cx, cz] = out(0.055)
    made.add(stick(PALETTE.bone, [ax, -0.68, az], [bx, -0.78, bz], 0.024, 5))
    made.add(stick(PALETTE.boneDark, [bx, -0.78, bz], [cx, -0.91, cz], 0.018, 5))
  }
  // The crystal: a long point of bright ice, a short one over it, and a glint.
  const crystal = group()
  crystal.position.set(0, -0.85, 0)
  const ice = (geometry: THREE.BufferGeometry, color: number, at: [number, number, number], scale: [number, number, number], turn: [number, number, number] = [0, 0, 0]): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, glowing(color))
    mesh.position.set(...at)
    mesh.scale.set(...scale)
    mesh.rotation.set(...turn)
    return mesh
  }
  crystal.add(ice(cone(5), 0x6fd8ff, [0, -0.1, 0], [0.15, 0.24, 0.15], [Math.PI, 0, 0]))
  crystal.add(ice(cone(5), 0xbff0ff, [0, 0.045, 0], [0.15, 0.09, 0.15]))
  crystal.add(ice(box(), 0xffffff, [0.035, -0.02, 0.03], [0.012, 0.09, 0.012], [0, 0.6, 0.15]))
  made.add(crystal)
  return made
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
    // Long horns sweeping out and then forward and up, a hump of muscle, and a ring in the nose.
    for (const side of [-1, 1]) made.add(...cowHorn(side, [0.5, 0.84, 0.15], [0.47, 0.87, 0.47], [0.66, 1.08, 0.44], 0.085, 0.016))
    made.add(part(box(), coat, [0.28, 0.86, 0], [0.3, 0.14, 0.4]))
    made.add(part(cylinder(8), PALETTE.ring, [0.75, 0.6, 0], [0.09, 0.02, 0.09], [0, 0, Math.PI / 2]))
  } else {
    // Shorter horns, out a little and curving up.
    for (const side of [-1, 1]) made.add(...cowHorn(side, [0.5, 0.85, 0.13], [0.49, 0.89, 0.28], [0.56, 1.03, 0.27], 0.055, 0.012))
    made.add(part(box(), PALETTE.pink, [-0.1, 0.32, 0], [0.22, 0.1, 0.2]))
  }
  for (const [lx, lz] of [[-0.32, -0.15], [-0.32, 0.15], [0.32, -0.15], [0.32, 0.15]]) made.add(part(box(), coat, [lx, 0.17, lz], [0.11, 0.34, 0.11]))
  return made
}

// A cow's or a bull's horn on one `side` of its head (-1 or 1): one smooth tube along a curve from `from` (on the
// head) bending towards `bend` and ending at `to` (all given for the +z side), tapering from `thick` across to a
// point; pale, going darker towards the tip (three lengths of it, each a shade darker), on a boss where it grows out.
function cowHorn(side: number, from: [number, number, number], bend: [number, number, number], to: [number, number, number], thick: number, tip: number): THREE.Object3D[] {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(from[0], from[1], from[2] * side),
    new THREE.Vector3(bend[0], bend[1], bend[2] * side),
    new THREE.Vector3(to[0], to[1], to[2] * side),
  )
  const radius = (t: number): number => (thick + (tip * 0.3 - thick) * t ** 1.3) / 2
  const made: THREE.Object3D[] = []
  for (const [t0, t1, color] of [[0, 0.62, PALETTE.horn], [0.62, 0.84, 0x9a8a70], [0.84, 1, 0x4a3e30]] as const) {
    const mesh = new THREE.Mesh(taperedTube(curve, t0, t1, radius), material(color))
    mesh.castShadow = true
    made.push(mesh)
  }
  made.push(part(ball(), PALETTE.horn, [from[0], from[1], from[2] * side], [thick * 1.3, thick, thick * 1.3]))
  return made
}

// A tube along part of a curve (`t0` to `t1` of it), `radius(t)` round at each point of it, closed at its far end
// when that comes to a point.
function taperedTube(curve: THREE.Curve<THREE.Vector3>, t0: number, t1: number, radius: (t: number) => number, rings = 8, sides = 8): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(64, false)
  const positions: number[] = []
  const index: number[] = []
  for (let i = 0; i <= rings; i++) {
    const t = t0 + ((t1 - t0) * i) / rings
    const frame = Math.min(64, Math.round(t * 64))
    const middle = curve.getPointAt(t)
    const r = radius(t)
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2
      const out = frames.normals[frame].clone().multiplyScalar(Math.cos(a)).add(frames.binormals[frame].clone().multiplyScalar(Math.sin(a)))
      positions.push(middle.x + out.x * r, middle.y + out.y * r, middle.z + out.z * r)
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j
      const b = i * sides + ((j + 1) % sides)
      index.push(a, a + sides, b, b, a + sides, b + sides)
    }
  }
  const made = new THREE.BufferGeometry()
  made.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  made.setIndex(index)
  made.computeVertexNormals()
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

// A deer: slender and long-legged, with a pale belly and tail; a buck darker at the neck, with antlers. Jointed so it
// can walk and run (see three-view's `gaitDeer`): all of it hangs from the middle of its back (`body`), so it can rise
// and pitch; its neck and head from the base of the neck (`head`); its tail from its rump (`tail`); and each straight
// leg from the hip or shoulder (`leg-fl`, `leg-fr`, `leg-hl`, `leg-hr`: front or hind, left or right).
export function deer(male: boolean): THREE.Group {
  // Antlers: a tall beam and three tines each side.
  const antlers = male
    ? [-1, 1].flatMap((side) => [
        part(cylinder(4), PALETTE.antler, [0.44, 1.3, side * 0.1], [0.03, 0.36, 0.03], [side * -0.45, 0, 0.15]),
        part(cylinder(4), PALETTE.antler, [0.52, 1.34, side * 0.14], [0.022, 0.16, 0.022], [0, 0, -0.7]),
        part(cylinder(4), PALETTE.antler, [0.47, 1.45, side * 0.19], [0.022, 0.14, 0.022], [side * -0.3, 0, -0.5]),
        part(cylinder(4), PALETTE.antler, [0.4, 1.47, side * 0.17], [0.02, 0.12, 0.02], [side * -0.6, 0, 0.3]),
      ])
    : []
  const head = pivot(
    [0.28, 0.76, 0],
    // The neck, leaning forward, and the head.
    part(box(), male ? PALETTE.deerDark : PALETTE.deer, [0.36, 0.86, 0], male ? [0.18, 0.36, 0.18] : [0.12, 0.34, 0.12], [0, 0, -0.45]),
    part(box(), PALETTE.deer, [0.5, 1.02, 0], [0.24, 0.15, 0.15]),
    part(box(), PALETTE.nose, [0.63, 1.0, 0], [0.04, 0.06, 0.08]),
    part(cone(4), PALETTE.deer, [0.44, 1.12, -0.09], [0.05, 0.12, 0.03], [0.5, 0, 0]),
    part(cone(4), PALETTE.deer, [0.44, 1.12, 0.09], [0.05, 0.12, 0.03], [-0.5, 0, 0]),
    ...antlers,
  )
  head.name = 'head'
  const tail = pivot([-0.34, 0.8, 0], part(box(), PALETTE.deerBelly, [-0.38, 0.74, 0], [0.06, 0.12, 0.08], [0, 0, 0.5]))
  tail.name = 'tail'
  const legs = ([['fl', 0.27, -0.1], ['fr', 0.27, 0.1], ['hl', -0.27, -0.1], ['hr', -0.27, 0.1]] as const).map(([name, lx, lz]) => {
    const leg = pivot([lx, 0.52, lz], part(box(), PALETTE.deer, [lx, 0.26, lz], [0.07, 0.52, 0.07]))
    leg.name = `leg-${name}`
    return leg
  })
  const body = pivot(
    [0, 0.66, 0],
    part(box(), PALETTE.deer, [0, 0.66, 0], male ? [0.76, 0.32, 0.32] : [0.68, 0.28, 0.28]),
    part(box(), PALETTE.deerBelly, [0, 0.52, 0], [0.6, 0.04, 0.26]),
    head,
    tail,
    ...legs,
  )
  body.name = 'body'
  return group(body)
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
    const eye = new THREE.Mesh(box(), glowing(0xff2a3a))
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

// The camps (see `isCampKind`): what keeps each stands on its own tile (and only that tile stands in the way), and
// the rest of the camp lies round it, flat or small enough to walk over: the fire in front of it (towards the camera),
// and bones, stakes and blocks off to the sides. Its rocks lie two tiles out to the sides and back (see campRockSpots).
// The building itself is a group of its own (`shaken`), the only part that rocks when it is hit.
function campBuilding(...parts: THREE.Object3D[]): THREE.Group {
  const made = group(...parts)
  made.name = 'shaken'
  return made
}

// A ring of stones round a fire burnt down to ash and blackened logs, at a point.
function campFire(x: number, z: number): THREE.Group {
  const made = group()
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    made.add(part(lump(), i % 2 ? PALETTE.stone : PALETTE.stoneDark, [Math.cos(angle) * 0.42, 0.07, Math.sin(angle) * 0.42], [0.18, 0.14, 0.18]))
  }
  made.add(part(cylinder(8), PALETTE.ash, [0, 0.02, 0], [0.66, 0.04, 0.66]))
  for (const angle of [0.3, 1.4, 2.5]) made.add(part(cylinder(5), PALETTE.char, [0, 0.08, 0], [0.08, 0.56, 0.08], [Math.PI / 2, angle, 0]))
  made.position.set(x, 0, z)
  return made
}

// A skeletons' camp: a ragged hide tent (what keeps it), a cold, blackened fire in front of it, bones lying about, and a
// skull on a stake.
export function camp(): THREE.Group {
  const made = group(
    campBuilding(
      part(cone(4), PALETTE.hide, [0, 0.62, 0], [1.15, 1.24, 1.15], [0, Math.PI / 4, 0]),
      part(box(), PALETTE.barkDark, [0, 1.3, 0], [0.06, 0.26, 0.06]),
      part(box(), PALETTE.soilDark, [0, 0.3, 0.38], [0.36, 0.56, 0.04]),
    ),
  )
  made.add(campFire(0, 1.9))
  for (const [bx, bz, turn] of [[0.9, 1.4, 0.4], [-0.8, 1.6, 1.7], [-0.7, 0.9, 2.6], [1.1, 2.4, 0.9]]) {
    made.add(part(box(), PALETTE.bone, [bx, 0.04, bz], [0.36, 0.05, 0.06], [0, turn, 0]))
  }
  made.add(part(box(), PALETTE.barkDark, [-1.0, 0.55, 2.3], [0.07, 1.1, 0.07]))
  made.add(part(box(), PALETTE.bone, [-1.0, 1.18, 2.3], [0.2, 0.2, 0.2]))
  made.add(part(box(), PALETTE.eye, [-0.89, 1.2, 2.3], [0.02, 0.06, 0.12]))
  return made
}

// A goblins' camp on the meadow: a lean-to of patched hides (what keeps it), its roof sloping from two poles at the
// front down to the ground at the back, open to the fire burnt down to ash in front of it; sharpened stakes stuck in the
// ground, and a heap of gnawed bones.
export function goblinCamp(): THREE.Group {
  const made = group(
    campBuilding(
      stick(PALETTE.bark, [-0.45, 0, 0.26], [-0.45, 0.84, 0.26], 0.06),
      stick(PALETTE.bark, [0.45, 0, 0.26], [0.45, 0.84, 0.26], 0.06),
      stick(PALETTE.bark, [-0.5, 0.82, 0.26], [0.5, 0.82, 0.26], 0.045),
      part(box(), PALETTE.hide, [0, 0.45, -0.05], [1.05, 0.05, 0.95], [-0.85, 0, 0]),
      part(box(), 0x7a6a3a, [-0.2, 0.47, -0.07], [0.4, 0.055, 0.4], [-0.85, 0, 0]),
      part(box(), 0x6a5a30, [0.28, 0.33, -0.2], [0.26, 0.055, 0.22], [-0.85, 0, 0]),
    ),
  )
  made.add(campFire(0, 1.9))
  for (const [sx, sz, tilt] of [[1.1, 1.2, 0.3], [-1.1, 1.3, -0.2], [1.0, 2.5, 0.25]]) {
    const stake = group(part(cylinder(5), PALETTE.bark, [0, 0.4, 0], [0.08, 0.8, 0.08]), part(cone(5), PALETTE.woodLight, [0, 0.88, 0], [0.08, 0.18, 0.08]))
    stake.position.set(sx, 0, sz)
    stake.rotation.set(tilt, 0, tilt / 2)
    made.add(stake)
  }
  for (const [bx, bz, turn] of [[-0.9, 2.3, 0.4], [-0.75, 2.4, 1.9], [-1.0, 2.5, 2.8]]) made.add(part(box(), PALETTE.bone, [bx, 0.04, bz], [0.32, 0.05, 0.06], [0, turn, 0]))
  return made
}

// A mummies' tomb in the desert (what keeps it): a squat sandstone tomb on a low plinth, a heavy capstone on it, its
// doorway a dark hole between two pillars under a lintel (facing south, as the camera looks), a step before it, and
// blocks fallen from it lying in the sand.
export function tomb(): THREE.Group {
  const sandstone = 0xd2b47a
  const sandstoneDark = 0xa98a55
  const made = group(
    campBuilding(
    part(box(), sandstoneDark, [0, 0.05, 0], [1.08, 0.1, 1.08]),
    part(box(), sandstone, [0, 0.5, -0.04], [0.86, 0.8, 0.86]),
    part(box(), sandstoneDark, [0, 0.96, -0.04], [0.98, 0.12, 0.98]),
    part(box(), sandstone, [0, 1.1, -0.04], [0.68, 0.16, 0.68]),
    part(box(), PALETTE.void, [0, 0.38, 0.4], [0.3, 0.56, 0.02]),
    part(box(), sandstoneDark, [-0.23, 0.42, 0.44], [0.12, 0.72, 0.1]),
    part(box(), sandstoneDark, [0.23, 0.42, 0.44], [0.12, 0.72, 0.1]),
    part(box(), sandstone, [0, 0.82, 0.45], [0.62, 0.13, 0.13]),
    part(box(), sandstoneDark, [0, 0.06, 0.62], [0.44, 0.12, 0.24]),
    ),
  )
  for (const [bx, bz, turn] of [[0.9, 1.1, 0.4], [-1.0, 1.0, 1.1], [0.3, 1.8, 2.0]]) made.add(part(box(), sandstoneDark, [bx, 0.11, bz], [0.32, 0.22, 0.24], [0, turn, 0]))
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
export function projectile(kind: 'arrow' | 'spear' | 'stone' | 'shard' | 'icicle' | 'ice-spear' | 'hex' | 'twister'): THREE.Group {
  // A twister: a funnel of whirling dust standing on the ground, wide at its top, a few shades of sand.
  if (kind === 'twister') {
    const made = group()
    const funnel: Array<[number, number, number]> = [
      [0.15, 0.08, 0.16],
      [0.4, 0.16, 0.2],
      [0.68, 0.26, 0.24],
      [0.98, 0.36, 0.26],
    ]
    funnel.forEach(([y, radius, height], i) => {
      const ring = new THREE.Mesh(cylinder(7), dustMaterial(i % 2 === 0 ? 0xd9bf86 : 0xbfa06a, 0.7))
      ring.position.set(0, y, 0)
      ring.scale.set(radius * 2, height, radius * 2)
      ring.rotation.y = i * 0.7
      made.add(ring)
    })
    return made
  }
  // A goblin shaman's hex: a glowing green ball.
  if (kind === 'hex') {
    const ball_ = new THREE.Mesh(ball(), glowing(0x8dff5a))
    ball_.scale.setScalar(0.18)
    return group(ball_)
  }
  // A staff's ice spear: an icicle, bigger, point down.
  if (kind === 'ice-spear') {
    const made = projectile('icicle')
    made.scale.setScalar(1.6)
    return made
  }
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

// ---- the desert and the meadow

// A sunflower, as tall as a player: a green stem leaning a little (each its own way), broad leaves, and a big head
// tipped to face the camera, a dark disc of seeds ringed with yellow petals.
export function sunflower(x: number, y: number): THREE.Group {
  const lean = (vary(x, y, 70) - 0.5) * 0.2
  const tall = 1.0 + vary(x, y, 71) * 0.25
  const made = group(
    part(cylinder(5), PALETTE.leafDark, [0, tall / 2, 0], [0.05, tall, 0.05]),
    part(blob(), PALETTE.leaf, [0.12, tall * 0.35, 0], [0.26, 0.04, 0.14], [0, 0.3, -0.5]),
    part(blob(), PALETTE.leafLight, [-0.12, tall * 0.55, 0.02], [0.24, 0.04, 0.13], [0, -0.4, 0.5]),
  )
  const head = group(part(cylinder(10), SUNFLOWER.seeds, [0, 0, 0], [0.26, 0.05, 0.26]))
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    head.add(part(blob(), i % 2 ? SUNFLOWER.petal : SUNFLOWER.petalDark, [Math.cos(angle) * 0.2, -0.005, Math.sin(angle) * 0.2], [0.13, 0.025, 0.07], [0, -angle, 0]))
  }
  head.position.set(0, tall + 0.04, 0.04)
  // Its face towards the camera (south), and up a little.
  head.rotation.x = Math.PI / 2 - 0.45
  made.add(head)
  made.rotation.z = lean
  made.rotation.x = lean / 2
  return made
}
const SUNFLOWER = { petal: 0xf2c41c, petalDark: 0xe0a812, seeds: 0x4a3018 }

// A sunflower seedling, at each of its looks on the way to a sunflower (see `growthLook`): two seed leaves; then a short
// stem with a few leaves; then a tall stem with a green bud not yet open.
export function seedling(look: number): THREE.Group {
  if (look <= 0) {
    return group(
      part(cylinder(5), PALETTE.leafDark, [0, 0.05, 0], [0.025, 0.1, 0.025]),
      part(blob(), PALETTE.sprout, [0.05, 0.1, 0], [0.1, 0.02, 0.05], [0, 0, 0.3]),
      part(blob(), PALETTE.sprout, [-0.05, 0.1, 0], [0.1, 0.02, 0.05], [0, 0, -0.3]),
    )
  }
  if (look === 1) {
    return group(
      part(cylinder(5), PALETTE.leafDark, [0, 0.18, 0], [0.035, 0.36, 0.035]),
      part(blob(), PALETTE.leaf, [0.08, 0.16, 0], [0.16, 0.03, 0.09], [0, 0.3, -0.4]),
      part(blob(), PALETTE.leafLight, [-0.08, 0.26, 0], [0.15, 0.03, 0.08], [0, -0.4, 0.4]),
      part(blob(), PALETTE.sprout, [0, 0.38, 0], [0.08, 0.05, 0.08]),
    )
  }
  return group(
    part(cylinder(5), PALETTE.leafDark, [0, 0.33, 0], [0.045, 0.66, 0.045]),
    part(blob(), PALETTE.leaf, [0.1, 0.24, 0], [0.22, 0.035, 0.12], [0, 0.3, -0.5]),
    part(blob(), PALETTE.leafLight, [-0.1, 0.42, 0.02], [0.2, 0.035, 0.11], [0, -0.4, 0.5]),
    part(blob(), PALETTE.leafDark, [0, 0.7, 0], [0.16, 0.14, 0.16]),
  )
}

// Clay on a river's bank: a few smooth, wet, grey lumps heaped together (the grey of the clay's icon).
export function clay(x: number, y: number): THREE.Group {
  const turn = vary(x, y, 72) * Math.PI * 2
  const lumps = group(
    part(lump(), 0xa49a9a, [0, 0.16, 0], [0.7, 0.34, 0.6]),
    part(lump(), 0x847d7d, [0.24, 0.1, 0.14], [0.36, 0.22, 0.34], [0, 1.1, 0]),
    part(lump(), 0xb2a9a9, [-0.2, 0.12, -0.12], [0.32, 0.2, 0.3], [0, 2.3, 0]),
  )
  for (const mesh of lumps.children as THREE.Mesh[]) mesh.material = shiny((mesh.material as THREE.MeshStandardMaterial).color.getHex())
  lumps.rotation.y = turn
  return group(lumps)
}

// A rock with ore in it (copper, tin): a rock, with nuggets of the metal showing in it, catching the light.
export function oreRock(x: number, y: number, metal: 'copper' | 'tin'): THREE.Group {
  const made = rock(x, y)
  const color = metal === 'copper' ? 0xd27a3c : 0xdcdfd4
  const turn = vary(x, y, 5) * Math.PI * 2
  const nuggets = group()
  // On the rock's face, poking out of it, all the way round.
  for (const [nx, ny, nz, size] of [[0, 0.47, 0.08, 0.16], [0.25, 0.36, 0.2, 0.15], [-0.22, 0.33, 0.25, 0.14], [0.08, 0.2, 0.36, 0.13], [-0.1, 0.42, -0.18, 0.14], [0.3, 0.26, -0.2, 0.12]] as const) {
    const nugget = part(lump(), color, [nx, ny, nz], [size, size * 0.8, size], [nx * 3, nz * 5, 0])
    nugget.material = shiny(color)
    nuggets.add(nugget)
  }
  nuggets.rotation.y = turn
  made.add(nuggets)
  return made
}

// A cactus: a tall, ribbed green column with an arm or two turned up, dotted with pale spines, and a flower on top of
// some.
export function cactus(x: number, y: number): THREE.Group {
  const tall = 0.95 + vary(x, y, 73) * 0.35
  const green = 0x4f8a4a
  const dark = 0x3a6e3a
  const made = group(
    part(cylinder(8), green, [0, tall / 2, 0], [0.32, tall, 0.32]),
    part(ball(), green, [0, tall, 0], [0.32, 0.2, 0.32]),
  )
  // Its ribs.
  for (let i = 0; i < 8; i += 2) {
    const angle = (i / 8) * Math.PI * 2
    made.add(part(box(), dark, [Math.cos(angle) * 0.155, tall / 2, Math.sin(angle) * 0.155], [0.03, tall * 0.96, 0.03], [0, -angle, 0]))
  }
  // An arm or two, out and then up.
  const arms = vary(x, y, 74) > 0.4 ? [1, -1] : [1]
  for (const side of arms) {
    const height = tall * (0.38 + vary(x, y, 75 + side) * 0.2)
    const up = 0.28 + vary(x, y, 77 + side) * 0.18
    made.add(part(cylinder(6), green, [side * 0.24, height, 0], [0.2, 0.16, 0.2], [0, 0, Math.PI / 2]))
    made.add(part(cylinder(6), green, [side * 0.33, height + up / 2, 0], [0.18, up, 0.18]))
    made.add(part(ball(), green, [side * 0.33, height + up, 0], [0.18, 0.12, 0.18]))
  }
  // Spines.
  for (let i = 0; i < 10; i++) {
    const angle = vary(x, y, 80 + i) * Math.PI * 2
    const at = 0.15 + vary(x, y, 90 + i) * (tall - 0.2)
    made.add(part(box(), 0xf0ead0, [Math.cos(angle) * 0.17, at, Math.sin(angle) * 0.17], [0.05, 0.012, 0.012], [0, -angle, 0]))
  }
  if (vary(x, y, 79) > 0.6) made.add(part(blob(), 0xe85a8a, [0, tall + 0.1, 0], [0.12, 0.08, 0.12]))
  made.rotation.y = vary(x, y, 78) * Math.PI * 2
  return made
}

// A young cactus, at each of its looks on the way to a cactus (see `growthLook`): a little round green nub just out of
// the sand, a few spines on it; then a short, fat column; then a column nearly as tall as a grown one, an arm budding.
export function youngCactus(look: number): THREE.Group {
  const green = 0x4f8a4a
  const dark = 0x3a6e3a
  const spine = 0xf0ead0
  const tall = [0.16, 0.42, 0.78][Math.max(0, Math.min(2, look))]
  const wide = [0.2, 0.26, 0.3][Math.max(0, Math.min(2, look))]
  const made = group(
    part(cylinder(8), green, [0, tall / 2, 0], [wide, tall, wide]),
    part(ball(), green, [0, tall, 0], [wide, wide * 0.65, wide]),
  )
  for (let i = 0; i < 8; i += 2) {
    const angle = (i / 8) * Math.PI * 2
    made.add(part(box(), dark, [Math.cos(angle) * wide * 0.48, tall / 2, Math.sin(angle) * wide * 0.48], [0.025, tall * 0.94, 0.025], [0, -angle, 0]))
  }
  const spines = 3 + look * 3
  for (let i = 0; i < spines; i++) {
    const angle = (i / spines) * Math.PI * 2 + i
    const at = tall * (0.3 + 0.6 * ((i * 0.37) % 1))
    made.add(part(box(), spine, [Math.cos(angle) * wide * 0.53, at, Math.sin(angle) * wide * 0.53], [0.04, 0.01, 0.01], [0, -angle, 0]))
  }
  if (look >= 2) {
    made.add(part(cylinder(6), green, [0.19, tall * 0.5, 0], [0.13, 0.12, 0.13], [0, 0, Math.PI / 2]))
    made.add(part(ball(), green, [0.25, tall * 0.5 + 0.04, 0], [0.13, 0.14, 0.13]))
  }
  return made
}

// A pocket of loose sand: a low drift heaped a little higher than the desert round it, rippled by the wind.
export function sandPile(x: number, y: number): THREE.Group {
  const turn = vary(x, y, 81) * Math.PI * 2
  const made = group(
    part(lump(), 0xe3cd94, [0, 0.07, 0], [0.86, 0.18, 0.72]),
    part(lump(), 0xd2b87c, [0.18, 0.05, 0.12], [0.44, 0.12, 0.38], [0, 1.3, 0]),
    part(box(), 0xc9ad70, [0, 0.135, -0.05], [0.4, 0.012, 0.04], [0, 0.2, 0]),
    part(box(), 0xc9ad70, [0.05, 0.12, 0.12], [0.36, 0.012, 0.04], [0, 0.25, 0]),
  )
  made.rotation.y = turn
  return group(made)
}

// A cobweb: a web strung between two dry twigs, facing the camera, threads radiating from its middle with rings of
// thread round them.
export function cobweb(x: number, y: number): THREE.Group {
  const made = group(
    stick(PALETTE.barkDark, [-0.36, 0, 0], [-0.3, 0.62, 0], 0.025),
    stick(PALETTE.barkDark, [0.34, 0, 0], [0.4, 0.56, 0], 0.025),
    stick(PALETTE.barkDark, [0.4, 0.4, 0], [0.48, 0.54, 0.02], 0.015),
  )
  const points: number[] = []
  const middle = { x: 0.02, y: 0.34 }
  const spokes = 8
  const tip = (i: number, r: number): [number, number, number] => {
    const angle = (i / spokes) * Math.PI * 2 + 0.2
    return [middle.x + Math.cos(angle) * r * 1.15, middle.y + Math.sin(angle) * r, 0]
  }
  for (let i = 0; i < spokes; i++) points.push(middle.x, middle.y, 0, ...tip(i, 0.3))
  for (const r of [0.08, 0.15, 0.22, 0.29]) for (let i = 0; i < spokes; i++) points.push(...tip(i, r), ...tip(i + 1, r))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  const web = new THREE.LineSegments(geometry, COBWEB_THREAD)
  made.add(web)
  made.rotation.y = (vary(x, y, 82) - 0.5) * 0.5
  return made
}
const COBWEB_THREAD = new THREE.LineBasicMaterial({ color: 0xf4f4ee, transparent: true, opacity: 0.85 })

// A wild beehive: a rounded heap of papery comb in tiers, banded darker between them, with a dark hole to fly in by at
// its foot, facing the camera.
export function beehive(): THREE.Group {
  const comb = 0xd9a441
  const band = 0xa8742a
  const made = group()
  const tiers = [[0.3, 0.18], [0.36, 0.2], [0.33, 0.2], [0.26, 0.17], [0.16, 0.13]] as const
  let height = 0
  tiers.forEach(([radius, tall], i) => {
    made.add(part(ball(), i % 2 ? band : comb, [0, height + tall / 2, 0], [radius * 2, tall * 1.3, radius * 2]))
    height += tall
  })
  made.add(part(box(), 0x2a1c0e, [0, 0.2, 0.33], [0.14, 0.1, 0.04]))
  // A drip of honey down its side.
  made.add(part(blob(), 0xe8a020, [0.2, 0.42, 0.27], [0.06, 0.12, 0.05]))
  return made
}

// A bee box, after its icon (icons/buildings/beebox.png): a round hive of coiled straw, golden, each coil a band round
// it, wider in the middle and drawing in to a knob on top, with dark holes for the bees in its face (towards the
// camera): one up near the top and two either side lower down.
const BEE_BOX = { middle: 0.36, radius: 0.33, coils: 8 }
export function beeBox(): THREE.Group {
  const { middle, radius, coils } = BEE_BOX
  const made = group()
  // How far out its round reaches at a height.
  const across = (y: number): number => radius * Math.sqrt(Math.max(0, 1 - ((y - middle) / (middle + 0.02)) ** 2))
  const step = (middle * 2) / coils
  for (let i = 0; i < coils; i++) {
    const y = step * (i + 0.5)
    const r = Math.max(0.06, across(y))
    made.add(part(cylinder(12), i % 2 ? 0xc98a32 : 0xe8b04a, [0, y, 0], [r * 2, step * 1.02, r * 2]))
    // The coil's rounded edge, a little proud of the band under it.
    made.add(part(cylinder(12), i % 2 ? 0xa86e24 : 0xd59a3a, [0, y - step * 0.42, 0], [r * 2 + 0.02, step * 0.16, r * 2 + 0.02]))
  }
  made.add(part(ball(), 0xf0c860, [0, middle * 2 + 0.01, 0], [0.12, 0.08, 0.12]))
  // The holes, on its face.
  for (const [x, y] of [[0, middle * 1.55], [-0.17, middle * 0.95], [0.17, middle * 0.95]] as const) {
    const out = Math.sqrt(Math.max(0, across(y) ** 2 - x * x))
    made.add(part(cylinder(8), 0x1a0e06, [x, y, out - 0.005], [0.1, 0.02, 0.1], [Math.PI / 2, 0, 0]))
  }
  return made
}

// A spider of the desert, cartoonish: a huge round abdomen, striped, a small head with two big eyes (and little ones
// round them) and a pair of fangs, and eight thick legs arched high at the knee, each knee a knob. A male is slighter,
// with a pale stripe. Each leg turns about its hip, named (`leg-l-0` to `leg-r-3`, front first; r is its right, +z) to
// walk (see gaitCrawler in three-view).
export function spider(male: boolean): THREE.Group {
  const coat = male ? 0x9a7a4a : 0x7a5a34
  const stripe = male ? 0xd8b878 : 0x4a3220
  const dark = 0x3a2a1a
  const made = group(
    // The abdomen: big, round, tipped up a little at the back, striped across.
    part(ball(), coat, [-0.26, 0.38, 0], [0.64, 0.56, 0.58], [0, 0, -0.25]),
    part(ball(), stripe, [-0.26, 0.38, 0], [0.46, 0.58, 0.6], [0, 0, -0.25]),
    part(ball(), coat, [-0.26, 0.38, 0], [0.28, 0.6, 0.61], [0, 0, -0.25]),
    // The head, small, low before it.
    part(ball(), coat, [0.1, 0.24, 0], [0.24, 0.2, 0.24]),
    // Two dark eyes, and four little ones round them.
    part(ball(), 0x1a1410, [0.21, 0.3, -0.05], [0.06, 0.065, 0.06]),
    part(ball(), 0x1a1410, [0.21, 0.3, 0.05], [0.06, 0.065, 0.06]),
    ...([[0.17, 0.35, -0.1], [0.17, 0.35, 0.1], [0.2, 0.25, -0.09], [0.2, 0.25, 0.09]] as const).map((at) => part(ball(), 0x1a1410, [...at], [0.03, 0.03, 0.03])),
    // Fangs.
    part(cone(4), 0xe8dcc0, [0.21, 0.16, -0.035], [0.03, 0.07, 0.03], [0, 0, Math.PI]),
    part(cone(4), 0xe8dcc0, [0.21, 0.16, 0.035], [0.03, 0.07, 0.03], [0, 0, Math.PI]),
  )
  // Four legs each side: up from the body, arched high to a knob of a knee, and down to a point on the ground.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const along = 0.2 - i * 0.13
      const hip: [number, number, number] = [0.06 - i * 0.03, 0.24, side * 0.1]
      const knee: [number, number, number] = [along + 0.02, 0.46, side * 0.3]
      const foot: [number, number, number] = [along + (i < 2 ? 0.14 : -0.1), 0.02, side * 0.46]
      const leg = pivot(
        hip,
        stick(dark, hip, knee, 0.08, 6),
        part(ball(), coat, knee, [0.12, 0.12, 0.12]),
        stick(dark, knee, foot, 0.07, 6),
        part(ball(), dark, foot, [0.07, 0.05, 0.07]),
      )
      leg.name = `leg-${side > 0 ? 'r' : 'l'}-${i}`
      made.add(leg)
    }
  }
  return made
}

// A scarab of the desert, cartoonish: a beetle with a huge, high-domed back of hard wing cases, split down the middle,
// shining, and swelling out round and full behind; a little dome of a thorax before it, rimmed; a small head with a
// broad toothed scoop and two big eyes; clubbed feelers; and six short, stout legs, each knee a knob. A male is dark
// green-black, with a great horn curving up off his head and a short one on his thorax; a female is bronze-brown,
// hornless. Its body (`body`, turning about the middle of its shell) curls up and rolls, and each leg turns about its
// hip, named as a spider's are (`leg-l-0` to `leg-r-2`, front first), to walk and to be drawn in (see three-view).
export function scarab(male: boolean): THREE.Group {
  const shell = male ? 0x1f3a36 : 0x5e4426
  const sheen = male ? 0x4f9a84 : 0xb88a4a
  const rim = male ? 0x2c524a : 0x7a5a32
  const dark = 0x1c1712
  const body = pivot(
    [-0.12, 0.34, 0],
    // The wing cases: a big, high dome, fuller behind, its rim a band round its foot.
    part(ball(), shell, [-0.08, 0.35, 0], [0.64, 0.62, 0.6]),
    part(ball(), shell, [-0.26, 0.32, 0], [0.5, 0.56, 0.58]),
    part(ball(), rim, [-0.14, 0.17, 0], [0.8, 0.14, 0.64]),
    // (The split: thin slices of the dome and its back a little bigger than them, so it follows the curve.)
    part(ball(), dark, [-0.08, 0.35, 0], [0.648, 0.628, 0.02]),
    part(ball(), dark, [-0.26, 0.32, 0], [0.508, 0.568, 0.02]),
    // Where the light catches it, either side of the split.
    part(ball(), sheen, [-0.04, 0.6, -0.13], [0.24, 0.08, 0.13], [0, 0, -0.15]),
    part(ball(), sheen, [-0.04, 0.6, 0.13], [0.24, 0.08, 0.13], [0, 0, -0.15]),
    part(ball(), 0xffffff, [0.02, 0.635, -0.13], [0.07, 0.03, 0.05], [0, 0, -0.3]),
    // The thorax, rimmed.
    part(ball(), shell, [0.22, 0.26, 0], [0.22, 0.22, 0.36]),
    part(ball(), rim, [0.22, 0.2, 0], [0.25, 0.08, 0.39]),
    part(ball(), sheen, [0.24, 0.33, 0], [0.09, 0.04, 0.16]),
    // The head, a broad scoop toothed along its front, and dark eyes at its sides.
    part(ball(), dark, [0.34, 0.16, 0], [0.14, 0.1, 0.24]),
    ...[-0.08, -0.027, 0.027, 0.08].map((z) => part(cone(3), dark, [0.415, 0.15, z], [0.03, 0.05, 0.03], [0, 0, -Math.PI / 2])),
    part(ball(), 0x101010, [0.37, 0.2, -0.1], [0.05, 0.05, 0.04]),
    part(ball(), 0x101010, [0.37, 0.2, 0.1], [0.05, 0.05, 0.04]),
  )
  // Its feelers: short, each ending in a little club. (What is added to it from here is placed from its middle.)
  for (const side of [-1, 1]) {
    body.add(stick(dark, [0.4, -0.1, side * 0.1], [0.48, -0.03, side * 0.17], 0.018, 3))
    body.add(part(lump(), 0x4a3a22, [0.49, -0.02, side * 0.175], [0.045, 0.035, 0.045]))
  }
  // A male's horns: a great one curving up off his head, and a short one on his thorax.
  if (male) {
    body.add(stick(dark, [0.38, -0.12, 0], [0.47, -0.01, 0], 0.07, 6))
    body.add(stick(dark, [0.47, -0.01, 0], [0.5, 0.12, 0], 0.055, 6))
    body.add(part(cone(6), dark, [0.495, 0.2, 0], [0.045, 0.16, 0.045], [0, 0, 0.3]))
    body.add(part(cone(5), shell, [0.29, 0.07, 0], [0.07, 0.13, 0.07], [0, 0, -0.6]))
  }
  body.name = 'body'
  const made = group(body)
  // Three legs a side from under it: out and up to a knob of a knee, down to the ground, stout.
  for (const side of [-1, 1]) {
    ;[0.18, 0.02, -0.16].forEach((along, i) => {
      const hip: [number, number, number] = [along, 0.14, side * 0.14]
      const knee: [number, number, number] = [along + (i === 0 ? 0.08 : i === 1 ? 0 : -0.08), 0.22, side * 0.33]
      const foot: [number, number, number] = [along + (i === 0 ? 0.16 : i === 1 ? 0.01 : -0.18), 0.01, side * 0.42]
      const leg = pivot(hip, stick(dark, hip, knee, 0.085, 6), part(ball(), rim, knee, [0.11, 0.11, 0.11]), stick(dark, knee, foot, 0.075, 6), part(ball(), dark, foot, [0.08, 0.05, 0.08]))
      leg.name = `leg-${side > 0 ? 'r' : 'l'}-${i}`
      made.add(leg)
    })
  }
  return made
}

const GOBLIN_SKIN = 0x6a9a3a
const GOBLIN_SKIN_DARK = 0x4e7a2a

// A goblin's body: small and green, a big head with long pointed ears and red eyes, a ragged hide tunic (`rag`), and
// legs; its arms are each kind's own.
function goblinBody(rag: number): THREE.Group {
  return group(
    part(box(), rag, [0, 0.42, 0], [0.24, 0.3, 0.3]),
    part(box(), 0x4a3418, [0, 0.29, 0], [0.26, 0.06, 0.32]),
    part(box(), GOBLIN_SKIN, [0.02, 0.72, 0], [0.26, 0.24, 0.26]),
    part(box(), GOBLIN_SKIN_DARK, [0.15, 0.66, 0], [0.06, 0.08, 0.1]),
    part(cone(4), GOBLIN_SKIN, [0.0, 0.76, -0.2], [0.06, 0.24, 0.06], [-Math.PI / 2 + 0.4, 0, 0]),
    part(cone(4), GOBLIN_SKIN, [0.0, 0.76, 0.2], [0.06, 0.24, 0.06], [Math.PI / 2 - 0.4, 0, 0]),
    part(box(), 0xff3a1a, [0.15, 0.75, -0.06], [0.02, 0.04, 0.05]),
    part(box(), 0xff3a1a, [0.15, 0.75, 0.06], [0.02, 0.04, 0.05]),
    part(box(), GOBLIN_SKIN_DARK, [0, 0.13, -0.08], [0.08, 0.26, 0.08]),
    part(box(), GOBLIN_SKIN_DARK, [0, 0.13, 0.08], [0.08, 0.26, 0.08]),
  )
}

// A goblin, with a crude spear: a wooden shaft and a point of knapped stone, bound on. Its spear arm is a group of its
// own from the shoulder (`spear-arm`), held low with the spear levelled forward, so it can be drawn back and jab, or be
// raised back and throw (see three-view's `poseSpearArm`).
export function goblin(): THREE.Group {
  const made = goblinBody(0x6a4a2a)
  made.add(part(box(), GOBLIN_SKIN, [0.02, 0.42, -0.2], [0.07, 0.26, 0.07], [0.2, 0, 0]))
  const arm = group(
    part(box(), GOBLIN_SKIN, [0.04, -0.09, 0], [0.07, 0.22, 0.07], [0, 0, 0.55]),
    stick(PALETTE.wood, [-0.32, -0.17, 0.03], [0.6, -0.14, 0.03], 0.034, 5),
    part(box(), PALETTE.rope, [0.58, -0.14, 0.03], [0.05, 0.045, 0.045]),
    part(cone(4), PALETTE.stoneDark, [0.66, -0.138, 0.03], [0.055, 0.15, 0.03], [0, 0, -Math.PI / 2]),
  )
  arm.position.set(0.05, 0.52, 0.2)
  arm.name = 'spear-arm'
  made.add(arm)
  return made
}

// A goblin archer: a goblin in a darker tunic with a short bow held out in its left hand and its right hand back at the
// string, a quiver on its back. While it aims, an arrow (named `nocked`) lies on the bow.
export function goblinArcher(): THREE.Group {
  const made = goblinBody(0x4a5a2a)
  made.add(
    part(cylinder(6), PALETTE.hide, [-0.15, 0.52, 0.05], [0.08, 0.3, 0.08], [0, 0, -0.35]),
    part(box(), 0xe8e2d4, [-0.21, 0.68, 0.04], [0.03, 0.07, 0.03], [0, 0, -0.35]),
    stick(GOBLIN_SKIN, [0, 0.5, -0.15], [0.26, 0.52, -0.06], 0.045, 4),
    stick(GOBLIN_SKIN, [0, 0.5, 0.15], [0.1, 0.52, 0.07], 0.045, 4),
    stick(PALETTE.wood, [0.28, 0.52, -0.05], [0.24, 0.74, -0.05], 0.03, 4),
    stick(PALETTE.wood, [0.28, 0.52, -0.05], [0.24, 0.3, -0.05], 0.03, 4),
  )
  const string = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.24, 0.74, -0.05), new THREE.Vector3(0.18, 0.52, -0.05), new THREE.Vector3(0.24, 0.3, -0.05)]),
    new THREE.LineBasicMaterial({ color: 0xf2efe6 }),
  )
  made.add(string)
  const nocked = group(
    stick(PALETTE.woodLight, [0.1, 0.52, -0.05], [0.4, 0.52, -0.05], 0.015, 4),
    part(cone(4), PALETTE.stoneDark, [0.42, 0.52, -0.05], [0.03, 0.06, 0.03], [0, 0, -Math.PI / 2]),
  )
  nocked.name = 'nocked'
  nocked.visible = false
  made.add(nocked)
  return made
}

// A goblin shaman: a goblin in a ragged hood with a bone mask, a crooked staff topped with a green stone in its right
// hand. While it aims a hex the stone blazes (named `nocked`).
export function goblinShaman(): THREE.Group {
  const made = goblinBody(0x5a3a5a)
  made.add(
    part(blob(), 0x4a2a4a, [-0.03, 0.82, 0], [0.32, 0.22, 0.32]),
    part(box(), PALETTE.bone, [0.15, 0.73, 0], [0.03, 0.14, 0.16]),
    part(box(), 0x1e1a14, [0.165, 0.75, -0.04], [0.01, 0.03, 0.04]),
    part(box(), 0x1e1a14, [0.165, 0.75, 0.04], [0.01, 0.03, 0.04]),
    part(box(), GOBLIN_SKIN, [0.02, 0.42, -0.2], [0.07, 0.26, 0.07], [0.2, 0, 0]),
    part(box(), GOBLIN_SKIN, [0.1, 0.48, 0.2], [0.07, 0.22, 0.07], [-0.2, 0, -0.6]),
    stick(PALETTE.barkDark, [0.2, 0.08, 0.24], [0.2, 1.0, 0.24], 0.035, 5),
    stick(PALETTE.barkDark, [0.2, 1.0, 0.24], [0.27, 1.08, 0.24], 0.03, 5),
    part(ball(), 0x3f8f2a, [0.27, 1.13, 0.24], [0.1, 0.1, 0.1]),
  )
  const blaze = new THREE.Mesh(ball(), glowing(0x8dff5a))
  blaze.position.set(0.27, 1.13, 0.24)
  blaze.scale.setScalar(0.16)
  blaze.name = 'nocked'
  blaze.visible = false
  made.add(blaze)
  return made
}

// A dust elemental: a whirling column of sand and grit, narrow at its foot and wide at its top, with two amber eyes
// burning in the dust, and grit going round it. The column and the grit are named (`swirl`) to be turned round and
// round (see three-view).
export function dustElemental(): THREE.Group {
  const swirl = group()
  swirl.name = 'swirl'
  const rings: Array<[number, number, number]> = [
    [0.15, 0.1, 0.12],
    [0.3, 0.17, 0.16],
    [0.47, 0.25, 0.18],
    [0.66, 0.33, 0.2],
    [0.85, 0.4, 0.2],
  ]
  rings.forEach(([y, radius, height], i) => {
    const ring = new THREE.Mesh(cylinder(7), dustMaterial(i % 2 === 0 ? 0xcdb07a : 0xb8975e, 0.82))
    ring.position.set(0, y, 0)
    ring.scale.set(radius * 2, height, radius * 2)
    ring.rotation.y = i * 0.5
    swirl.add(ring)
  })
  for (let i = 0; i < 6; i++) {
    const turn = (i / 6) * Math.PI * 2
    swirl.add(part(lump(), 0x8f7448, [Math.cos(turn) * 0.42, 0.25 + (i % 3) * 0.25, Math.sin(turn) * 0.42], [0.06, 0.05, 0.06]))
  }
  const made = group(swirl)
  for (const z of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(box(), glowing(0xffc860))
    eye.position.set(0.3, 0.72, z)
    eye.scale.set(0.02, 0.05, 0.05)
    made.add(eye)
  }
  return made
}

// See-through dust (a dust elemental, a twister): it does not hide what is behind it. One of each, shared.
const dustMaterials = new Map<string, THREE.MeshStandardMaterial>()
function dustMaterial(color: number, opacity: number): THREE.MeshStandardMaterial {
  const key = `${color}|${opacity}`
  let made = dustMaterials.get(key)
  if (!made) dustMaterials.set(key, (made = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, depthWrite: false, flatShading: true })))
  return made
}

// A mummy: tall, wrapped head to foot in old linen gone yellow, the wrappings in bands and stained here and there, two
// dim eyes glowing out of a dark gap in its head's wrappings, its arms held stiffly out in front, and a loose end of
// wrapping hanging from one.
export function mummy(): THREE.Group {
  const linen = 0xd8c9a2
  const band = 0xb3a074
  const stain = 0x8f7c56
  const made = group(
    // Legs.
    part(box(), linen, [0, 0.2, -0.08], [0.11, 0.4, 0.11]),
    part(box(), linen, [0, 0.2, 0.08], [0.11, 0.4, 0.11]),
    part(box(), band, [0, 0.12, -0.08], [0.12, 0.04, 0.12]),
    part(box(), band, [0, 0.28, 0.08], [0.12, 0.04, 0.12]),
    // The body, wrapped in slanting bands.
    part(box(), linen, [0, 0.6, 0], [0.24, 0.42, 0.34]),
    part(box(), band, [0, 0.5, 0], [0.25, 0.05, 0.35], [0.15, 0, 0]),
    part(box(), band, [0, 0.68, 0], [0.25, 0.05, 0.35], [-0.2, 0, 0]),
    part(box(), stain, [0.125, 0.57, 0.08], [0.01, 0.1, 0.08]),
    // The head, and the dark gap its eyes look out of.
    part(box(), linen, [0.02, 0.95, 0], [0.24, 0.26, 0.24]),
    part(box(), band, [0.02, 1.03, 0], [0.25, 0.04, 0.25]),
    part(box(), 0x1e1a14, [0.14, 0.93, 0], [0.01, 0.05, 0.16]),
  )
  // Arms straight out in front (each from its shoulder, `arm-l` and `arm-r`, so they can be raised to slam and
  // brought down: see three-view's `poseMummyArms`), and a loose end hanging off the right.
  const left = pivot([0.01, 0.74, -0.2], part(box(), linen, [0.2, 0.74, -0.2], [0.38, 0.09, 0.09]), part(box(), band, [0.24, 0.74, -0.2], [0.04, 0.1, 0.1]))
  const right = pivot(
    [0.01, 0.74, 0.2],
    part(box(), linen, [0.2, 0.74, 0.2], [0.38, 0.09, 0.09]),
    part(box(), band, [0.3, 0.74, 0.2], [0.04, 0.1, 0.1]),
    part(box(), linen, [0.16, 0.62, 0.25], [0.04, 0.2, 0.03], [0.3, 0, 0]),
  )
  left.name = 'arm-l'
  right.name = 'arm-r'
  made.add(left, right)
  for (const z of [-0.05, 0.05]) {
    const eye = new THREE.Mesh(box(), glowing(0xe8d060))
    eye.position.set(0.146, 0.935, z)
    eye.scale.set(0.015, 0.035, 0.035)
    made.add(eye)
  }
  return made
}

// A worker bee: a striped body, black and gold, a small dark head, and two pale, see-through wings. It flies, and the
// view bobs it.
export function bee(): THREE.Group {
  return beeModel(0.32, 0xf2b61c)
}

// A queen bee: bigger, with a longer, richer gold body.
export function queenBee(): THREE.Group {
  const made = beeModel(0.5, 0xe0961a)
  made.add(part(box(), 0xf6d860, [0, 0.62, 0], [0.1, 0.03, 0.1]))
  return made
}

function beeModel(length: number, gold: number): THREE.Group {
  const made = group(
    part(ball(), gold, [-length * 0.15, 0.5, 0], [length * 0.7, length * 0.45, length * 0.45]),
    part(box(), 0x1e1a14, [-length * 0.12, 0.5, 0], [length * 0.12, length * 0.47, length * 0.47]),
    part(box(), 0x1e1a14, [-length * 0.32, 0.5, 0], [length * 0.1, length * 0.4, length * 0.4]),
    part(ball(), 0x2a2218, [length * 0.28, 0.52, 0], [length * 0.28, length * 0.28, length * 0.28]),
  )
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(blob(), BEE_WING)
    wing.position.set(0, 0.5 + length * 0.3, side * length * 0.22)
    wing.scale.set(length * 0.5, length * 0.06, length * 0.4)
    wing.rotation.x = side * 0.4
    wing.name = 'wing'
    made.add(wing)
  }
  return made
}
const BEE_WING = new THREE.MeshBasicMaterial({ color: 0xf0f6ff, transparent: true, opacity: 0.55, depthWrite: false })

// The smoke off a fire cooking leaves: grey puffs, named so the view can float them up and fade them (see
// `smokePuffs` in three-view.ts).
export const SMOKE_PUFFS = 6
export function smoke(): THREE.Group {
  const made = group()
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const puff = new THREE.Mesh(blob(), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xd6d6d2 : 0xbcbcb8, transparent: true, opacity: 0.5, depthWrite: false }))
    puff.name = 'smoke-puff'
    puff.userData.offset = i / SMOKE_PUFFS
    made.add(puff)
  }
  made.name = 'smoke'
  return made
}
