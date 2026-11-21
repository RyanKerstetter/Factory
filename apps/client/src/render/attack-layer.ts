import { Container, Graphics, Sprite, Text } from 'pixi.js'
import { TILE_PX } from '../camera.ts'
import type { Art } from './art.ts'
import { itemArt } from './art-catalog.ts'
import type { AttackView } from './world-renderer.ts'

// The player's attacks (see AttackView): the shapes on the ground (filled faintly, outlined more strongly, as the
// example game draws its indicators), what is in flight (each its item's picture, turned the way it flies), sparks
// where something was hit, and damage numbers rising off animals.
export class AttackLayer {
  readonly view = new Container()
  private readonly marks = new Graphics()
  private readonly shots = new Container()
  private readonly effects = new Graphics()
  private readonly labels = new Container()
  private readonly sprites = new Map<number, Sprite>()
  private readonly texts: Text[] = []

  constructor(private readonly art: Art) {
    this.view.addChild(this.marks, this.shots, this.effects, this.labels)
  }

  update(attacks: AttackView, zoom: number): void {
    const g = this.marks.clear()
    const width = Math.max(1.5, 2 / zoom)
    for (const mark of attacks.marks) {
      for (const polygon of mark.polygons) {
        const points = polygon.flatMap((point) => [point.x * TILE_PX, point.y * TILE_PX])
        if (mark.fill > 0) g.poly(points).fill({ color: mark.color, alpha: mark.fill })
        if (mark.stroke > 0) g.poly(points).stroke({ color: mark.color, alpha: mark.stroke, width })
      }
    }

    // The swishes behind swinging weapons, tracing what each attack covers (see Swish).
    for (const swish of attacks.swishes) {
      const fade = Math.max(0, 1 - swish.progress)
      const px = (x: number, y: number): number[] => [x * TILE_PX, y * TILE_PX]
      if (swish.shape === 'arc') {
        const sweep = Math.min(1, swish.progress / 0.75)
        const eased = sweep * sweep * (3 - 2 * sweep)
        const start = swish.angle + swish.arc / 2
        const edge = start - swish.arc * eased
        const points: number[] = []
        for (let i = 0; i <= 12; i++) {
          const a = start + (edge - start) * (i / 12)
          points.push(...px(swish.x + Math.cos(a) * swish.outer, swish.y + Math.sin(a) * swish.outer))
        }
        for (let i = 12; i >= 0; i--) {
          const a = start + (edge - start) * (i / 12)
          points.push(...px(swish.x + Math.cos(a) * swish.inner, swish.y + Math.sin(a) * swish.inner))
        }
        g.poly(points).fill({ color: 0xffffff, alpha: 0.4 * fade })
      } else if (swish.shape === 'band') {
        const reach = swish.outer * Math.min(1, swish.progress / 0.5)
        const side = swish.angle + Math.PI / 2
        const half = Math.max(0.08, swish.width / 2)
        const at = (along: number, across: number): number[] =>
          px(swish.x + Math.cos(swish.angle) * along + Math.cos(side) * across, swish.y + Math.sin(swish.angle) * along + Math.sin(side) * across)
        g.poly([...at(0, -half), ...at(reach, -half), ...at(reach, half), ...at(0, half)]).fill({ color: 0xffffff, alpha: 0.45 * fade })
      } else {
        const mx = swish.x + Math.cos(swish.angle) * swish.distance
        const my = swish.y + Math.sin(swish.angle) * swish.distance
        const r = swish.outer * (0.4 + 0.6 * Math.min(1, swish.progress / 0.6))
        g.circle(mx * TILE_PX, my * TILE_PX, r * TILE_PX).stroke({ color: 0xffffff, alpha: 0.6 * fade, width: r * TILE_PX * 0.35 })
      }
    }

    const fx = this.effects.clear()
    for (const spark of attacks.sparks) {
      const radius = TILE_PX * (0.12 + 0.3 * spark.age)
      fx.circle(spark.x * TILE_PX, spark.y * TILE_PX, radius).stroke({ color: spark.color, alpha: 1 - spark.age, width: width * 1.5 })
    }

    attacks.numbers.forEach((number, i) => {
      let text = this.texts[i]
      if (!text) {
        text = new Text({ text: '', style: { fill: '#ffd27a', fontSize: 18, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: '#2a1a10', width: 3 } } })
        text.anchor.set(0.5)
        this.texts.push(text)
        this.labels.addChild(text)
      }
      text.visible = true
      if (text.text !== number.text) text.text = number.text
      text.alpha = 1 - number.age
      text.scale.set(1 / zoom)
      text.position.set(number.x * TILE_PX, (number.y - 0.6 - number.age * 0.8) * TILE_PX)
    })
    for (let i = attacks.numbers.length; i < this.texts.length; i++) this.texts[i].visible = false

    const seen = new Set<number>()
    for (const shot of attacks.shots) {
      seen.add(shot.id)
      let sprite = this.sprites.get(shot.id)
      if (!sprite) {
        sprite = new Sprite()
        sprite.anchor.set(0.5)
        this.sprites.set(shot.id, sprite)
        this.shots.addChild(sprite)
      }
      const texture = this.art.texture(itemArt(shot.item))
      if (sprite.texture !== texture) sprite.texture = texture
      sprite.setSize(TILE_PX * 0.45, TILE_PX * 0.45)
      sprite.position.set(shot.x * TILE_PX, shot.y * TILE_PX)
      // Item pictures point up and to the right; turn them to fly the way they go.
      sprite.rotation = shot.angle + Math.PI / 4
    }
    for (const [id, sprite] of this.sprites) {
      if (seen.has(id)) continue
      sprite.destroy()
      this.sprites.delete(id)
    }
  }
}
