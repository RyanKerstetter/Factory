import * as THREE from 'three'
import type { PuffView } from './frame.ts'

// Soft puffs (mist, poison, blown snow, snowflakes): every one a frame lists (see PuffView), each drawn as a round
// point facing the screen, its colour fading out to nothing at its edge, so a cloud of them has no hard edge. All in one
// draw, over the world (as sparks are), not hiding anything behind it. Their buffers grow as more are needed.

const VERTEX = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float scale;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vAlpha = alpha;
  vTint = tint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale;
}
`

const FRAGMENT = `
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d >= 1.0) discard;
  float soft = 1.0 - d;
  gl_FragColor = vec4(vTint, vAlpha * soft * soft);
}
`

export class Puffs {
  readonly points: THREE.Points
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.ShaderMaterial
  private capacity = 0
  private position = new Float32Array(0)
  private tint = new Float32Array(0)
  private size = new Float32Array(0)
  private alpha = new Float32Array(0)

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { scale: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.grow(512)
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 16
    // A puff's size is in tiles: as many pixels across as a tile is on the screen, worked out as it is drawn.
    const drawing = new THREE.Vector2()
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      if (!(camera instanceof THREE.OrthographicCamera)) return
      renderer.getDrawingBufferSize(drawing)
      this.material.uniforms.scale.value = (drawing.y * camera.zoom) / (camera.top - camera.bottom)
    }
  }

  update(puffs: readonly PuffView[]): void {
    if (puffs.length > this.capacity) this.grow(Math.max(puffs.length, this.capacity * 2))
    puffs.forEach((puff, i) => {
      this.position[i * 3] = puff.x
      this.position[i * 3 + 1] = puff.height
      this.position[i * 3 + 2] = puff.y
      // (Its colour as it is written, not made linear: the shader writes it straight out, so it shows as given.)
      this.tint[i * 3] = ((puff.color >> 16) & 255) / 255
      this.tint[i * 3 + 1] = ((puff.color >> 8) & 255) / 255
      this.tint[i * 3 + 2] = (puff.color & 255) / 255
      this.size[i] = puff.size
      this.alpha[i] = Math.max(0, Math.min(1, puff.alpha))
    })
    for (const name of ['position', 'tint', 'size', 'alpha']) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true
    this.geometry.setDrawRange(0, puffs.length)
    this.points.visible = puffs.length > 0
  }

  private grow(capacity: number): void {
    this.capacity = capacity
    this.position = new Float32Array(capacity * 3)
    this.tint = new Float32Array(capacity * 3)
    this.size = new Float32Array(capacity)
    this.alpha = new Float32Array(capacity)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
  }
}
