import * as THREE from 'three'

type Point = { x: number; y: number }

// How high over the ground paint is laid, so it does not flicker against it.
const LIFT = 0.025
// How many triangles' worth of room the buffers start with (they grow when more is painted).
const START_TRIANGLES = 2048

// Flat shapes painted on the ground, rebuilt every frame into one mesh: attack indicators (filled faintly and outlined
// more strongly, as the example game draws them), tile frames, crosses. Each shape has its own colour and opacity. It
// is drawn after the world, over everything on the ground (farmland, fences), so an indicator is never hidden.
export class GroundPaint {
  readonly mesh: THREE.Mesh
  private positions = new Float32Array(START_TRIANGLES * 9)
  private colors = new Float32Array(START_TRIANGLES * 12)
  private used = 0
  private readonly geometry = new THREE.BufferGeometry()
  private readonly color = new THREE.Color()

  constructor() {
    this.attach()
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide })
    this.mesh = new THREE.Mesh(this.geometry, material)
    this.mesh.renderOrder = 5
    this.mesh.frustumCulled = false
  }

  clear(): void {
    this.used = 0
  }

  // A filled polygon (points in tiles, x east and y south), any shape that does not cross itself.
  fill(polygon: readonly Point[], color: number, alpha: number): void {
    if (alpha <= 0 || polygon.length < 3) return
    const contour = polygon.map((point) => new THREE.Vector2(point.x, point.y))
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) this.triangle(polygon[a], polygon[b], polygon[c], color, alpha)
  }

  // A polygon's outline, `width` tiles wide, closed unless `open`.
  stroke(polygon: readonly Point[], color: number, alpha: number, width: number, open = false): void {
    if (alpha <= 0) return
    const count = open ? polygon.length - 1 : polygon.length
    for (let i = 0; i < count; i++) this.line(polygon[i], polygon[(i + 1) % polygon.length], color, alpha, width)
  }

  line(from: Point, to: Point, color: number, alpha: number, width: number): void {
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length === 0) return
    // Out to each side by half the width, and on past each end by as much, so corners meet.
    const sx = (-(to.y - from.y) / length) * (width / 2)
    const sy = ((to.x - from.x) / length) * (width / 2)
    const ex = ((to.x - from.x) / length) * (width / 2)
    const ey = ((to.y - from.y) / length) * (width / 2)
    const a = { x: from.x - ex + sx, y: from.y - ey + sy }
    const b = { x: to.x + ex + sx, y: to.y + ey + sy }
    const c = { x: to.x + ex - sx, y: to.y + ey - sy }
    const d = { x: from.x - ex - sx, y: from.y - ey - sy }
    this.triangle(a, b, c, color, alpha)
    this.triangle(a, c, d, color, alpha)
  }

  // A tile's frame.
  tile(x: number, y: number, color: number, alpha: number, width: number, inset = 0): void {
    this.stroke(
      [
        { x: x + inset, y: y + inset },
        { x: x + 1 - inset, y: y + inset },
        { x: x + 1 - inset, y: y + 1 - inset },
        { x: x + inset, y: y + 1 - inset },
      ],
      color,
      alpha,
      width,
    )
  }

  // Hands what was painted to the mesh.
  finish(): void {
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const color = this.geometry.getAttribute('color') as THREE.BufferAttribute
    position.needsUpdate = true
    color.needsUpdate = true
    this.geometry.setDrawRange(0, this.used * 3)
  }

  private triangle(a: Point, b: Point, c: Point, color: number, alpha: number): void {
    if (this.used * 9 >= this.positions.length) this.grow()
    this.color.setHex(color)
    let p = this.used * 9
    let q = this.used * 12
    for (const point of [a, b, c]) {
      this.positions[p++] = point.x
      this.positions[p++] = LIFT
      this.positions[p++] = point.y
      this.colors[q++] = this.color.r
      this.colors[q++] = this.color.g
      this.colors[q++] = this.color.b
      this.colors[q++] = alpha
    }
    this.used++
  }

  private grow(): void {
    const positions = new Float32Array(this.positions.length * 2)
    positions.set(this.positions)
    const colors = new Float32Array(this.colors.length * 2)
    colors.set(this.colors)
    this.positions = positions
    this.colors = colors
    this.attach()
  }

  private attach(): void {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4))
  }
}

// ---- words over the world

export type TextStyle = { color: string; size: number; bold?: boolean }

const textures = new Map<string, { texture: THREE.CanvasTexture; width: number; height: number }>()

// A picture of some words (outlined dark, to read over anything), made once for each text and style and kept.
function textTexture(text: string, style: TextStyle): { texture: THREE.CanvasTexture; width: number; height: number } {
  const key = `${style.color}|${style.size}|${style.bold ? 'b' : ''}|${text}`
  let made = textures.get(key)
  if (made) return made
  // Drawn at twice the size it is shown, so it stays sharp on fine screens.
  const scale = 2
  const font = `${style.bold ? 'bold ' : ''}${style.size * scale}px "Trebuchet MS", "Segoe UI", sans-serif`
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  context.font = font
  const pad = 4 * scale
  canvas.width = Math.ceil(context.measureText(text).width) + pad * 2
  canvas.height = Math.ceil(style.size * 1.4 * scale) + pad
  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineWidth = 3 * scale
  context.strokeStyle = '#1f1308'
  context.strokeText(text, canvas.width / 2, canvas.height / 2)
  context.fillStyle = style.color
  context.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  made = { texture, width: canvas.width / scale, height: canvas.height / scale }
  if (textures.size > 400) {
    for (const old of textures.values()) old.texture.dispose()
    textures.clear()
  }
  textures.set(key, made)
  return made
}

// A sprite showing words, always facing the screen and the same size on it whatever the zoom: set `pxPerTile` (how
// many screen pixels a tile is) each frame with `fit`.
export class Label {
  readonly sprite: THREE.Sprite
  private text = ''
  private width = 0
  private height = 0

  constructor(private readonly style: TextStyle) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }))
    this.sprite.renderOrder = 20
  }

  set(text: string, color = this.style.color): void {
    const key = `${color}|${text}`
    if (key === this.text) return
    this.text = key
    const made = textTexture(text, { ...this.style, color })
    this.sprite.material.map = made.texture
    this.sprite.material.needsUpdate = true
    this.width = made.width
    this.height = made.height
  }

  fit(pxPerTile: number): void {
    this.sprite.scale.set(this.width / pxPerTile, this.height / pxPerTile, 1)
  }

  dispose(): void {
    this.sprite.material.dispose()
  }
}
