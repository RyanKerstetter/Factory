import * as THREE from 'three'
import type { ItemId } from '../../../../packages/shared/src/index.ts'
import { iconUrl } from '../ui/icons.ts'

// Items drawn in the world by their icons: lying on the ground and held (a sprite, always facing the camera), or
// floating over a pedestal or an altar and spinning (a flat picture, seen from both sides, that turns).

const loader = new THREE.TextureLoader()
const textures = new Map<number, THREE.Texture>()
function itemTexture(item: number): THREE.Texture {
  let made = textures.get(item)
  if (!made) {
    made = loader.load(iconUrl(item as ItemId))
    made.colorSpace = THREE.SRGBColorSpace
    made.magFilter = THREE.NearestFilter
    textures.set(item, made)
  }
  return made
}

const spriteMaterials = new Map<number, THREE.SpriteMaterial>()
// An item's picture as a sprite's (its icon under res/, or its stand-in).
export function itemMaterial(item: number): THREE.SpriteMaterial {
  let made = spriteMaterials.get(item)
  if (!made) {
    made = new THREE.SpriteMaterial({ map: itemTexture(item), transparent: true, alphaTest: 0.1 })
    spriteMaterials.set(item, made)
  }
  return made
}

const planeMaterials = new Map<number, THREE.MeshBasicMaterial>()
const plane = new THREE.PlaneGeometry(1, 1)
// How big an item floating over a pedestal or an altar is (tiles across).
export const FLOATING_SIZE = 0.38

// An item's picture as a flat square (seen from both sides), to spin.
export function itemPlane(item: number, size = FLOATING_SIZE): THREE.Mesh {
  const mesh = new THREE.Mesh(plane, itemPlaneMaterial(item))
  mesh.scale.set(size, size, 1)
  return mesh
}

export function itemPlaneMaterial(item: number): THREE.MeshBasicMaterial {
  let made = planeMaterials.get(item)
  if (!made) {
    made = new THREE.MeshBasicMaterial({ map: itemTexture(item), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
    planeMaterials.set(item, made)
  }
  return made
}

// The bob and spin of something floating, `now` in milliseconds, `salt` to set each one going at its own time: how far
// up (tiles) and how far round (radians).
export function floatingAt(now: number, salt: number): { lift: number; turn: number } {
  return { lift: Math.sin(now * 0.0028 + salt) * 0.05, turn: now * 0.0022 + salt }
}
