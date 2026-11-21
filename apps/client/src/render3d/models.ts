import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hashInts } from '../../../../packages/shared/src/index.ts'

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
export const LIQUID_COLORS: Readonly<Record<string, number>> = { water: 0x3a74b0, tannin: 0x7a4a22, milk: 0xf0ece0 }

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

export function bush(): THREE.Group {
  // The clumps of leaves: where each is, and how big (its size across, up, and deep).
  const clumps: Array<{ color: number; at: [number, number, number]; size: [number, number, number] }> = [
    { color: PALETTE.leafDark, at: [-0.15, 0.22, 0.05], size: [0.55, 0.45, 0.55] },
    { color: PALETTE.leaf, at: [0.15, 0.25, -0.05], size: [0.55, 0.5, 0.55] },
    { color: PALETTE.leafLight, at: [0, 0.38, 0.12], size: [0.45, 0.4, 0.45] },
  ]
  const made = group(...clumps.map((clump) => part(lump(), clump.color, clump.at, clump.size)))
  // Berries sit on the clumps' surfaces (a little sunk in), on their upper and outer sides: each is a clump and a
  // direction out from its middle.
  const berries: Array<[number, number, number]> = [
    [0, 140, 30],
    [0, 230, 50],
    [1, 20, 35],
    [1, 300, 55],
    [2, 90, 45],
    [2, 200, 65],
  ]
  for (const [which, around, up] of berries) {
    const clump = clumps[which]
    const a = (around * Math.PI) / 180
    const b = (up * Math.PI) / 180
    // The lumps are a little smaller than their size, at their flat faces, so berries go in to 0.42 of it.
    const reach = 0.42
    const at: [number, number, number] = [
      clump.at[0] + Math.cos(a) * Math.cos(b) * clump.size[0] * reach,
      clump.at[1] + Math.sin(b) * clump.size[1] * reach,
      clump.at[2] + Math.sin(a) * Math.cos(b) * clump.size[2] * reach,
    ]
    made.add(part(ball(), PALETTE.berry, at, [0.09, 0.09, 0.09]))
  }
  return made
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

// Something stuck in the ground, to be knocked loose: a piece of flint (dark shards poking up, turned by its tile), a
// thrown spear (standing at a slant, its point in the ground), or anything else (a small lump).
export function loose(item: string, x: number, y: number): THREE.Group {
  if (item === 'flint') {
    const turn = vary(x, y, 40) * Math.PI * 2
    const made = group(
      part(lump(), 0x3e3f46, [0, 0.09, 0], [0.34, 0.24, 0.25], [0.3, turn, 0.2]),
      part(cone(4), 0x55565e, [0.12, 0.12, 0.06], [0.14, 0.3, 0.11], [0.2, turn, -0.4]),
      part(lump(), 0x2c2d33, [-0.11, 0.06, -0.08], [0.18, 0.12, 0.15], [0, turn * 2, 0]),
    )
    made.position.set((vary(x, y, 41) - 0.5) * 0.4, 0, (vary(x, y, 42) - 0.5) * 0.4)
    return group(made)
  }
  if (item.endsWith('spear')) {
    const spear = projectile('spear')
    // Pointing down into the ground, leaning back the way it came.
    spear.rotation.set(0, vary(x, y, 43) * Math.PI * 2, -Math.PI / 2 + 0.45)
    spear.position.set(0, 0.5, 0)
    return group(spear)
  }
  return group(part(lump(), PALETTE.stoneDark, [0, 0.06, 0], [0.2, 0.12, 0.2]))
}

// A sapling grows from a twig with a tuft of leaves to a small tree: `grown` from 0 to 1.
export function sapling(grown: number): THREE.Group {
  const size = 0.35 + grown * 0.45
  const made = group(
    part(cylinder(5), PALETTE.bark, [0, 0.3, 0], [0.08, 0.6, 0.08]),
    part(blob(), PALETTE.leafLight, [0, 0.62, 0], [0.45, 0.4, 0.45]),
  )
  made.scale.setScalar(size)
  return made
}

// A berry sprout: young, light green leaves and no berries (they come when it becomes a bush), bigger at each stage.
export function sprout(grown: number): THREE.Group {
  const made = group(
    part(lump(), PALETTE.leaf, [-0.1, 0.18, 0.04], [0.42, 0.36, 0.42]),
    part(lump(), PALETTE.leafLight, [0.1, 0.22, -0.04], [0.42, 0.4, 0.42]),
    part(lump(), PALETTE.sprout, [0, 0.33, 0.08], [0.32, 0.3, 0.32]),
  )
  made.scale.setScalar(0.45 + grown * 0.5)
  return made
}

// A crop in a garden plot, by how far it has grown: green shoots, taller, and golden ears once it is ready.
// Wheat, at one of its CROP_GROWTH_STAGES (see cropStage in art-catalog.ts): a few thin green shoots; then more and
// taller, with leaves; then a thick green stand; then heads forming; and last, ripe, a dense golden stand of heavy heads
// that fills the whole plot like a patch of a wheat field. Each stage is one mesh (its stalks, leaves and heads joined),
// made once and shared, turned a different way on each plot so a field does not repeat.
export const CROP_GROWTH_STAGES = 6
// A crop in its plot at a growth stage, standing in tidy rows along the plot's three furrows.
export function crop(stage: number, _x = 0, _y = 0): THREE.Group {
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

// A fence: a post, and rails to each side it joins (north 1, east 2, south 4, west 8).
export function fence(mask: number): THREE.Group {
  const made = group(part(box(), PALETTE.bark, [0, 0.38, 0], [0.16, 0.76, 0.16]))
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

// A stump, with `tool` (an item key) stuck in it: an axe is sunk blade first into its top, its handle up at a slant.
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
  return made
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
// curls of shavings.
export function workbench(): THREE.Group {
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
  // A stone hammer: its handle, and its head lashed on.
  made.add(stick(PALETTE.woodLight, [0.06, 0.6, 0.2], [0.2, 0.6, -0.02], 0.035))
  made.add(part(lump(), PALETTE.stone, [0.21, 0.62, -0.035], [0.14, 0.09, 0.09], [0, 1, 0]))
  made.add(part(box(), PALETTE.rope, [0.205, 0.62, -0.027], [0.05, 0.1, 0.1], [0, 1, 0]))
  // A flint knife.
  made.add(part(box(), PALETTE.wood, [-0.12, 0.595, 0.18], [0.1, 0.025, 0.035], [0, -0.3, 0]))
  made.add(part(cone(4), PALETTE.stoneDark, [-0.22, 0.595, 0.21], [0.04, 0.14, 0.015], [0, -0.3, Math.PI / 2]))
  // A couple of planks, and shavings.
  made.add(part(box(), PALETTE.woodLight, [-0.22, 0.6, -0.14], [0.42, 0.03, 0.11], [0, 0.08, 0]))
  made.add(part(box(), PALETTE.wood, [-0.2, 0.63, -0.13], [0.4, 0.03, 0.1], [0, -0.05, 0]))
  for (const [sx, sz] of [[0.02, 0.02], [0.08, -0.08], [-0.02, 0.12], [0.3, 0.14]]) {
    made.add(part(cylinder(5), 0xe6c690, [sx, 0.592, sz], [0.04, 0.01, 0.04]))
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

// A barrel, open at the top: what is in it shows, a liquid at its level in its colour, or a heap of rotting compost
// (with flies over it) while it is making compost; sealed, a lid with a handle covers it.
export function barrel(sealed = false, liquid = '', fill = 0, composting = false): THREE.Group {
  const wall = new THREE.Mesh(geometry('tube12', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true)), bothSides(PALETTE.wood))
  wall.position.set(0, 0.36, 0)
  wall.scale.set(0.6, 0.72, 0.6)
  wall.castShadow = true
  wall.receiveShadow = true
  // The hoops are open rings, so they do not hide what is inside.
  const hoop = (y: number): THREE.Mesh => {
    const ring = new THREE.Mesh(geometry('tube12', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true)), bothSides(PALETTE.barkDark))
    ring.position.set(0, y, 0)
    ring.scale.set(0.63, 0.06, 0.63)
    return ring
  }
  const made = group(wall, part(cylinder(12), PALETTE.barkDark, [0, 0.06, 0], [0.58, 0.04, 0.58]), hoop(0.16), hoop(0.56))
  if (sealed) {
    made.add(part(cylinder(12), PALETTE.woodLight, [0, 0.735, 0], [0.64, 0.04, 0.64]))
    made.add(part(box(), PALETTE.bark, [0, 0.775, 0], [0.3, 0.05, 0.07]))
    return made
  }
  if (liquid && fill > 0) {
    const surface = new THREE.Mesh(cylinder(12), material(LIQUID_COLORS[liquid] ?? 0x3a74b0))
    surface.position.set(0, 0.08 + 0.6 * Math.min(1, fill), 0)
    surface.scale.set(0.57, 0.02, 0.57)
    made.add(surface)
  }
  if (composting) {
    made.add(part(lump(), PALETTE.soil, [0, 0.62, 0], [0.5, 0.18, 0.5]))
    made.add(part(lump(), PALETTE.leafDark, [0.1, 0.68, -0.05], [0.12, 0.08, 0.12]))
    for (const [fx, fy, fz] of [[0.12, 0.95, 0.05], [-0.1, 1.05, -0.08], [0.02, 1.15, 0.12]]) made.add(part(ball(), 0x1c1a16, [fx, fy, fz], [0.035, 0.035, 0.035]))
  }
  return made
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
    part(box(), PALETTE.bagLight, [0, 0.12, -0.2], [0.46, 0.04, 0.1]),
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

// The player: a caveman in a fur tunic, with shaggy hair and a beard, facing +x. Its arms are named, to swing.
export function caveman(): THREE.Group {
  const made = group(
    part(box(), PALETTE.skin, [0, 0.16, -0.08], [0.1, 0.32, 0.1]),
    part(box(), PALETTE.skin, [0, 0.16, 0.08], [0.1, 0.32, 0.1]),
    part(cylinder(7), PALETTE.fur, [0, 0.46, 0], [0.38, 0.36, 0.34]),
    part(box(), PALETTE.furLight, [0.12, 0.5, 0.02], [0.08, 0.1, 0.12]),
    part(ball(), PALETTE.skin, [0, 0.78, 0], [0.26, 0.28, 0.26]),
    part(blob(), PALETTE.hair, [-0.04, 0.86, 0], [0.32, 0.22, 0.32]),
    part(blob(), PALETTE.hair, [0.1, 0.71, 0], [0.12, 0.14, 0.18]),
    part(ball(), 0x1c1a16, [0.12, 0.8, -0.06], [0.04, 0.04, 0.04]),
    part(ball(), 0x1c1a16, [0.12, 0.8, 0.06], [0.04, 0.04, 0.04]),
  )
  // Each arm: a shoulder that turns about the upright (`arm-left`, `arm-right`), and in it a joint that swings the arm
  // up and down (`...-pitch`: 0 hangs down, π/2 points straight ahead, π straight up), with the hand at its end
  // (`hand-left`, `hand-right`), where what is held goes. The right arm is on the +z side (the model faces +x).
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'left' : 'right'
    const shoulder = new THREE.Group()
    shoulder.position.set(0, 0.6, side * 0.22)
    shoulder.name = `arm-${name}`
    const pitch = new THREE.Group()
    pitch.name = `arm-${name}-pitch`
    pitch.add(part(box(), PALETTE.skin, [0, -0.13, 0], [0.09, 0.28, 0.09]))
    // Where body armour's sleeve goes (see `wear`), so it swings with the arm.
    const sleeve = new THREE.Group()
    sleeve.name = `armor-sleeve-${name}`
    pitch.add(sleeve)
    const hand = new THREE.Group()
    hand.position.set(0, -0.27, 0)
    hand.name = `hand-${name}`
    pitch.add(hand)
    shoulder.add(pitch)
    made.add(shoulder)
  }
  // Where armour goes, filled in by `wear`.
  for (const slot of ['head', 'body', 'feet']) {
    const worn = new THREE.Group()
    worn.name = `armor-${slot}`
    made.add(worn)
  }
  return made
}

// Dresses a caveman (see `caveman`) in a piece of armour, by its item key and colour, in its slot; or takes off what
// is there (no key). Pieces without a model of their own are drawn in their item's colour.
export function wear(person: THREE.Object3D, slot: 'head' | 'body' | 'feet', key: string | undefined, color = 0x8a5a3a): void {
  const worn = person.getObjectByName(`armor-${slot}`)
  if (!worn) return
  worn.clear()
  const sleeves = slot === 'body' ? ['left', 'right'].map((side) => person.getObjectByName(`armor-sleeve-${side}`)) : []
  for (const sleeve of sleeves) sleeve?.clear()
  if (!key) return
  if (slot === 'head') {
    if (key === 'wolf-helmet') {
      // A wolf's head worn as a hood: grey fur over the scalp, pricked ears, the muzzle over the brow.
      worn.add(part(blob(), PALETTE.wolf, [-0.03, 0.87, 0], [0.36, 0.26, 0.36]))
      worn.add(part(box(), PALETTE.wolfPale, [0.14, 0.9, 0], [0.12, 0.08, 0.14]))
      worn.add(part(box(), PALETTE.nose, [0.21, 0.9, 0], [0.03, 0.04, 0.05]))
      worn.add(part(cone(4), PALETTE.wolfBlack, [-0.02, 1.03, -0.09], [0.06, 0.12, 0.04]))
      worn.add(part(cone(4), PALETTE.wolfBlack, [-0.02, 1.03, 0.09], [0.06, 0.12, 0.04]))
      worn.add(part(box(), PALETTE.wolf, [-0.17, 0.72, 0], [0.08, 0.26, 0.3]))
    } else worn.add(part(blob(), color, [-0.02, 0.88, 0], [0.32, 0.2, 0.32]))
    return
  }
  if (slot === 'body') {
    // A leather tunic: over the whole body from the shoulders to the hips, its front a lighter panel, with shoulder
    // pads, sleeves down the upper arms, a belt, and a skirt of flaps over the tops of the legs.
    const dark = new THREE.Color(color).multiplyScalar(0.62).getHex()
    const light = new THREE.Color(color).lerp(new THREE.Color(0xd9a070), 0.25).getHex()
    worn.add(part(cylinder(8), color, [0, 0.47, 0], [0.44, 0.36, 0.4]))
    worn.add(part(box(), light, [0.19, 0.48, 0], [0.04, 0.28, 0.2]))
    // The collar, round the neck.
    worn.add(part(cylinder(8), dark, [0, 0.655, 0], [0.3, 0.04, 0.28]))
    // Shoulder pads, over the tops of the arms.
    for (const z of [-0.2, 0.2]) worn.add(part(blob(), dark, [0, 0.63, z], [0.18, 0.09, 0.15]))
    // The belt, with its buckle.
    worn.add(part(cylinder(8), PALETTE.barkDark, [0, 0.31, 0], [0.45, 0.05, 0.41]))
    worn.add(part(box(), PALETTE.brass, [0.225, 0.31, 0], [0.02, 0.05, 0.06]))
    // The skirt: flaps hanging from the belt all round, over the tops of the legs, a little splayed.
    for (let i = 0; i < 8; i++) {
      const turn = (i / 8) * Math.PI * 2
      const flap = part(box(), i % 2 === 0 ? color : dark, [Math.cos(turn) * 0.17, 0.21, Math.sin(turn) * 0.15], [0.03, 0.17, 0.13])
      flap.rotation.set(0, -turn, -0.18)
      worn.add(flap)
    }
    // A sleeve on each upper arm, with a dark cuff.
    for (const sleeve of sleeves) {
      sleeve?.add(part(box(), color, [0, -0.07, 0], [0.13, 0.17, 0.13]))
      sleeve?.add(part(box(), dark, [0, -0.155, 0], [0.135, 0.03, 0.135]))
    }
    return
  }
  for (const z of [-0.08, 0.08]) worn.add(part(box(), color, [0.01, 0.06, z], [0.15, 0.13, 0.13]))
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
      // A cord out to the side of the hand with the pouch on its end (the hand turns it round when it is whirled).
      return group(
        part(box(), PALETTE.rope, [0.2, -0.02, 0], [0.4, 0.02, 0.02]),
        part(ball(), PALETTE.hide, [0.42, -0.02, 0], [0.08, 0.06, 0.08]),
      )
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

// A skeleton: bones, a skull with dark eyes, and a rusty blade held out in front.
export function skeleton(): THREE.Group {
  const made = group(
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
    // The arms, one held out with a blade.
    part(box(), PALETTE.bone, [0.02, 0.6, -0.19], [0.05, 0.3, 0.05], [0.15, 0, 0]),
    part(box(), PALETTE.bone, [0.16, 0.7, 0.18], [0.3, 0.05, 0.05]),
    part(box(), PALETTE.rust, [0.42, 0.72, 0.18], [0.36, 0.04, 0.07]),
    part(box(), PALETTE.barkDark, [0.27, 0.7, 0.18], [0.06, 0.1, 0.12]),
  )
  for (const lz of [-0.07, 0.07]) made.add(part(box(), PALETTE.bone, [0, 0.19, lz], [0.06, 0.4, 0.06]))
  return made
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
    // Bony hands, and the staff.
    part(box(), PALETTE.bone, [0.24, 0.72, -0.26], [0.06, 0.24, 0.06], [0.4, 0, 0.3]),
    part(cylinder(6), PALETTE.barkDark, [0.3, 0.72, 0.3], [0.05, 1.5, 0.05]),
    part(box(), PALETTE.bone, [0.3, 0.8, 0.3], [0.08, 0.08, 0.08]),
    part(blob(), PALETTE.iceDeep, [0.3, 1.52, 0.3], [0.2, 0.26, 0.2]),
    part(blob(), PALETTE.ice, [0.3, 1.55, 0.3], [0.12, 0.16, 0.12]),
  )
  return made
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

// ---- what flies

// An arrow, a spear (longer), or a sling stone, pointing along +x.
export function projectile(kind: 'arrow' | 'spear' | 'stone' | 'shard' | 'icicle'): THREE.Group {
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
  const length = kind === 'spear' ? 1.3 : 0.6
  return group(
    part(cylinder(5), PALETTE.wood, [0, 0, 0], [0.04, length, 0.04], [0, 0, Math.PI / 2]),
    part(cone(4), PALETTE.stoneDark, [length / 2 + 0.06, 0, 0], [0.08, 0.14, 0.08], [0, 0, -Math.PI / 2]),
    ...(kind === 'arrow' ? [part(box(), 0xf2efe6, [-length / 2 + 0.06, 0, 0], [0.12, 0.08, 0.01])] : []),
  )
}

export const WATER_COLOR = PALETTE.water
