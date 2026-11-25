import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Models are built from many small parts, each a mesh of its own (a tree is a trunk and three blobs of leaves, a tuft of
// grass eleven blades), and every mesh is a draw call, twice over with the sun's shadows: a forest in view would be
// thousands a frame, which is what holds a slow computer back. `bake` puts the parts of a model that never move on
// their own into one mesh (per kind of surface), each part's colour kept on its corners, so a model is one draw call.
//
// Left as they are: anything named, or inside something named (the view finds those by name to move them: flames,
// smoke, what floats over an altar), anything with a picture or see-through, and kinds of surface only one part has.

// The surfaces that can be baked: lit (most things), or glowing as they are (embers).
type Surface = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
// The surface a baked mesh has: the parts' colours on its corners, in place of one colour.
const baked = new Map<string, Surface>()

type Part = { mesh: THREE.Mesh; material: Surface }

export function bake(model: THREE.Object3D): THREE.Object3D {
  model.updateMatrixWorld(true)
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert()
  const bySurface = new Map<string, Part[]>()
  const visit = (object: THREE.Object3D): void => {
    for (const child of object.children) {
      if (child.name !== '') continue
      if (child instanceof THREE.Mesh && child.visible && child.children.length === 0) {
        const key = surfaceKey(child)
        if (key !== undefined) {
          const list = bySurface.get(key)
          const part = { mesh: child, material: child.material as Surface }
          if (list) list.push(part)
          else bySurface.set(key, [part])
        }
      }
      visit(child)
    }
  }
  visit(model)
  for (const [key, parts] of bySurface) {
    if (parts.length < 2) continue
    const pieces = parts.map(({ mesh, material }) => piece(mesh, material, toModel))
    const geometry = mergeGeometries(pieces)
    for (const made of pieces) made.dispose()
    if (!geometry) continue
    geometry.userData.baked = true
    const mesh = new THREE.Mesh(geometry, bakedMaterial(key, parts[0].material))
    mesh.castShadow = parts[0].mesh.castShadow
    mesh.receiveShadow = parts[0].mesh.receiveShadow
    for (const { mesh: part } of parts) part.removeFromParent()
    model.add(mesh)
  }
  return model
}

// Frees what `bake` made for a model (its merged shapes: the parts' own shapes are shared, and stay).
export function unbake(model: THREE.Object3D): void {
  model.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry.userData.baked) object.geometry.dispose()
  })
}

// The surface a part has, as a key for those that can be baked together, or undefined for one that cannot.
function surfaceKey(mesh: THREE.Mesh): string | undefined {
  const material = mesh.material
  if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshBasicMaterial)) return undefined
  if (material.map || material.transparent || material.alphaTest > 0 || material.opacity < 1) return undefined
  if (!mesh.geometry.getAttribute('position')) return undefined
  const shadows = [mesh.castShadow, mesh.receiveShadow, material.side]
  if (material instanceof THREE.MeshBasicMaterial) return ['basic', ...shadows].join('|')
  return [material.roughness, material.metalness, material.flatShading, material.emissive.getHex(), material.emissiveIntensity, ...shadows].join('|')
}

// A part's shape where it is in the model, with its colour on every corner, and only what every baked mesh has.
function piece(mesh: THREE.Mesh, material: Surface, toModel: THREE.Matrix4): THREE.BufferGeometry {
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
  const made = new THREE.BufferGeometry()
  made.setAttribute('position', source.getAttribute('position').clone())
  const normal = source.getAttribute('normal')
  if (normal) made.setAttribute('normal', normal.clone())
  else made.computeVertexNormals()
  const count = made.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  const own = material.vertexColors ? source.getAttribute('color') : undefined
  for (let i = 0; i < count; i++) {
    colors[i * 3] = material.color.r * (own ? own.getX(i) : 1)
    colors[i * 3 + 1] = material.color.g * (own ? own.getY(i) : 1)
    colors[i * 3 + 2] = material.color.b * (own ? own.getZ(i) : 1)
  }
  made.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  if (source !== mesh.geometry) source.dispose()
  const place = new THREE.Matrix4().multiplyMatrices(toModel, mesh.matrixWorld)
  made.applyMatrix4(place)
  // A part turned inside out (scaled by less than nothing one way) has its triangles' corners the other way round, so
  // they still face out once it is no longer drawn turned inside out.
  if (place.determinant() < 0) flipTriangles(made)
  return made
}

function flipTriangles(geometry: THREE.BufferGeometry): void {
  for (const name of ['position', 'normal', 'color']) {
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute
    const size = attribute.itemSize
    const array = attribute.array
    for (let i = 0; i < attribute.count; i += 3) {
      for (let k = 0; k < size; k++) {
        const a = (i + 1) * size + k
        const b = (i + 2) * size + k
        const swap = array[a]
        array[a] = array[b]
        array[b] = swap
      }
    }
  }
}

function bakedMaterial(key: string, like: Surface): Surface {
  let made = baked.get(key)
  if (!made) {
    made =
      like instanceof THREE.MeshBasicMaterial
        ? new THREE.MeshBasicMaterial({ vertexColors: true, side: like.side })
        : new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: like.roughness,
            metalness: like.metalness,
            side: like.side,
            flatShading: like.flatShading,
            emissive: like.emissive,
            emissiveIntensity: like.emissiveIntensity,
          })
    baked.set(key, made)
  }
  return made
}
