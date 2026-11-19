import * as THREE from 'three'
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
  made.add(...children)
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
      part(lump(), 0x3e3f46, [0, 0.06, 0], [0.22, 0.16, 0.16], [0.3, turn, 0.2]),
      part(cone(4), 0x55565e, [0.08, 0.08, 0.04], [0.09, 0.2, 0.07], [0.2, turn, -0.4]),
      part(lump(), 0x2c2d33, [-0.07, 0.04, -0.05], [0.12, 0.08, 0.1], [0, turn * 2, 0]),
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
export function crop(stage: 'sprout' | 'mid' | 'full'): THREE.Group {
  const made = new THREE.Group()
  const tall = stage === 'sprout' ? 0.18 : stage === 'mid' ? 0.4 : 0.6
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const at: [number, number, number] = [(col - 1) * 0.25, 0.08 + tall / 2, (row - 1) * 0.25]
      made.add(part(cylinder(4), PALETTE.sprout, at, [0.035, tall, 0.035]))
      if (stage === 'full') made.add(part(cylinder(5), PALETTE.wheat, [at[0], 0.08 + tall + 0.08, at[2]], [0.07, 0.18, 0.07]))
    }
  }
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
    part(cylinder(10), PALETTE.bark, [0, 0.18, 0], [0.75, 0.36, 0.75]),
    part(cylinder(10), PALETTE.woodLight, [0, 0.365, 0], [0.68, 0.02, 0.68]),
    part(box(), PALETTE.barkDark, [0.32, 0.06, 0.18], [0.3, 0.1, 0.12], [0, 0.6, 0]),
  )
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

export function workbench(): THREE.Group {
  const made = group(part(box(), PALETTE.wood, [0, 0.52, 0], [0.95, 0.12, 0.7]))
  for (const [lx, lz] of [[-0.38, -0.26], [0.38, -0.26], [-0.38, 0.26], [0.38, 0.26]]) made.add(part(box(), PALETTE.bark, [lx, 0.24, lz], [0.1, 0.48, 0.1]))
  made.add(part(lump(), PALETTE.stone, [0.25, 0.65, 0.1], [0.22, 0.14, 0.2]))
  made.add(part(cylinder(5), PALETTE.woodLight, [-0.2, 0.61, -0.1], [0.06, 0.4, 0.06], [0, 0, Math.PI / 2]))
  return made
}

// A ring of stones round crossed logs; lit, a flame (its two parts named, so they can flicker).
export function campfire(lit: boolean): THREE.Group {
  const made = new THREE.Group()
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    made.add(part(lump(), i % 2 ? PALETTE.stone : PALETTE.stoneDark, [Math.cos(angle) * 0.35, 0.07, Math.sin(angle) * 0.35], [0.18, 0.14, 0.18]))
  }
  for (const angle of [0.3, 1.4, 2.5]) made.add(part(cylinder(5), PALETTE.bark, [0, 0.1, 0], [0.09, 0.55, 0.09], [Math.PI / 2, angle, 0]))
  if (lit) {
    const outer = new THREE.Mesh(cone(6), new THREE.MeshBasicMaterial({ color: PALETTE.flame }))
    outer.position.set(0, 0.32, 0)
    outer.scale.set(0.38, 0.5, 0.38)
    outer.name = 'flame'
    const inner = new THREE.Mesh(cone(6), new THREE.MeshBasicMaterial({ color: PALETTE.flameCore }))
    inner.position.set(0, 0.27, 0)
    inner.scale.set(0.2, 0.32, 0.2)
    inner.name = 'flame'
    made.add(outer, inner)
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
  const made = group(
    part(cylinder(5), PALETTE.bark, [-0.38, 0.45, 0], [0.07, 0.9, 0.07]),
    part(cylinder(5), PALETTE.bark, [0.38, 0.45, 0], [0.07, 0.9, 0.07]),
    part(cylinder(5), PALETTE.bark, [0, 0.86, 0], [0.06, 0.82, 0.06], [0, 0, Math.PI / 2]),
  )
  if (state === 'drying') {
    made.add(part(box(), 0x8a4a35, [0, 0.55, 0.02], [0.64, 0.58, 0.035], [0.22, 0, 0]))
    made.add(part(box(), 0x6e3a2a, [0, 0.3, 0.07], [0.5, 0.1, 0.03], [0.4, 0, 0]))
    made.add(part(cylinder(4), PALETTE.rope, [0, 0.83, 0], [0.02, 0.64, 0.02], [0, 0, Math.PI / 2]))
  } else if (state === 'done') {
    made.add(part(box(), 0xd9b98a, [0, 0.55, 0], [0.66, 0.6, 0.025]))
    made.add(part(cylinder(4), PALETTE.rope, [0, 0.83, 0], [0.02, 0.66, 0.02], [0, 0, Math.PI / 2]))
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

export function chest(): THREE.Group {
  return group(
    part(box(), PALETTE.wood, [0, 0.22, 0], [0.75, 0.44, 0.55]),
    part(box(), PALETTE.bark, [0, 0.47, 0], [0.78, 0.08, 0.58]),
    part(box(), PALETTE.rope, [0, 0.27, 0], [0.77, 0.06, 0.57]),
  )
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
  for (const side of [-1, 1]) {
    const arm = part(box(), PALETTE.skin, [0, -0.13, 0], [0.09, 0.28, 0.09])
    const shoulder = new THREE.Group()
    shoulder.position.set(0, 0.6, side * 0.22)
    shoulder.add(arm)
    shoulder.name = side < 0 ? 'arm-left' : 'arm-right'
    made.add(shoulder)
  }
  return made
}

export function cow(): THREE.Group {
  const made = group(
    part(box(), PALETTE.cowWhite, [0, 0.55, 0], [0.9, 0.42, 0.45]),
    part(box(), PALETTE.cowPatch, [-0.1, 0.62, 0.226], [0.3, 0.22, 0.01]),
    part(box(), PALETTE.cowPatch, [0.2, 0.52, -0.226], [0.26, 0.2, 0.01]),
    part(box(), PALETTE.cowWhite, [0.52, 0.68, 0], [0.3, 0.3, 0.32]),
    part(box(), PALETTE.pink, [0.68, 0.62, 0], [0.06, 0.16, 0.22]),
    part(cone(4), PALETTE.horn, [0.52, 0.88, -0.12], [0.06, 0.16, 0.06], [0, 0, -0.3]),
    part(cone(4), PALETTE.horn, [0.52, 0.88, 0.12], [0.06, 0.16, 0.06], [0, 0, -0.3]),
    part(box(), PALETTE.pink, [-0.1, 0.32, 0], [0.18, 0.06, 0.16]),
    part(box(), PALETTE.cowWhite, [-0.48, 0.55, 0], [0.04, 0.32, 0.04], [0, 0, 0.3]),
  )
  for (const [lx, lz] of [[-0.32, -0.15], [-0.32, 0.15], [0.32, -0.15], [0.32, 0.15]]) made.add(part(box(), PALETTE.cowWhite, [lx, 0.17, lz], [0.11, 0.34, 0.11]))
  return made
}

export function chicken(): THREE.Group {
  return group(
    part(ball(), PALETTE.chicken, [0, 0.3, 0], [0.42, 0.32, 0.3]),
    part(ball(), PALETTE.chicken, [0.18, 0.48, 0], [0.2, 0.22, 0.2]),
    part(box(), PALETTE.comb, [0.18, 0.62, 0], [0.12, 0.08, 0.03]),
    part(cone(4), PALETTE.beak, [0.31, 0.47, 0], [0.06, 0.12, 0.06], [0, 0, -Math.PI / 2]),
    part(box(), PALETTE.comb, [0.27, 0.4, 0], [0.04, 0.07, 0.03]),
    part(box(), PALETTE.chicken, [-0.22, 0.38, 0], [0.12, 0.18, 0.18], [0, 0, 0.5]),
    part(cylinder(4), PALETTE.beak, [0, 0.08, -0.07], [0.03, 0.16, 0.03]),
    part(cylinder(4), PALETTE.beak, [0, 0.08, 0.07], [0.03, 0.16, 0.03]),
  )
}

// ---- what flies

// An arrow, a spear (longer), or a sling stone, pointing along +x.
export function projectile(kind: 'arrow' | 'spear' | 'stone'): THREE.Group {
  if (kind === 'stone') return group(part(lump(), PALETTE.stoneDark, [0, 0, 0], [0.14, 0.12, 0.14]))
  const length = kind === 'spear' ? 1.3 : 0.6
  return group(
    part(cylinder(5), PALETTE.wood, [0, 0, 0], [0.04, length, 0.04], [0, 0, Math.PI / 2]),
    part(cone(4), PALETTE.stoneDark, [length / 2 + 0.06, 0, 0], [0.08, 0.14, 0.08], [0, 0, -Math.PI / 2]),
    ...(kind === 'arrow' ? [part(box(), 0xf2efe6, [-length / 2 + 0.06, 0, 0], [0.12, 0.08, 0.01])] : []),
  )
}

export const WATER_COLOR = PALETTE.water
