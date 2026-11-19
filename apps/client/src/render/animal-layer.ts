import { Container, Graphics, Sprite } from 'pixi.js'
import { TILE_PX } from '../camera.ts'
import type { Art } from './art.ts'
import { animalArt, ANIMAL_ART_FACES_LEFT } from './art-catalog.ts'
import type { AnimalView } from './world-renderer.ts'

const ROPE = 0x8a6a3c
const HOVER = 0xf0b429
// A baby is drawn this much the size of a grown one.
const BABY_SCALE = 0.6

// The animals: each its picture over a shadow, turned the way it last walked, smaller while it is a baby, with the rope
// from whoever leads it and a ring round the one under the mouse. Sprites are kept from frame to frame by ID.
export class AnimalLayer {
  readonly view = new Container()
  private readonly under = new Graphics()
  private readonly sprites = new Container()
  private readonly over = new Graphics()
  private readonly byId = new Map<number, Sprite>()

  constructor(private readonly art: Art) {
    this.sprites.sortableChildren = true
    this.view.addChild(this.under, this.sprites, this.over)
  }

  update(animals: readonly AnimalView[], zoom: number): void {
    const under = this.under.clear()
    const over = this.over.clear()
    const seen = new Set<number>()
    for (const animal of animals) {
      seen.add(animal.id)
      let sprite = this.byId.get(animal.id)
      if (!sprite) {
        sprite = new Sprite()
        sprite.anchor.set(0.5, 0.6)
        this.byId.set(animal.id, sprite)
        this.sprites.addChild(sprite)
      }
      const texture = this.art.texture(animalArt(animal.kind))
      if (sprite.texture !== texture) sprite.texture = texture
      const size = animal.size * (animal.baby ? BABY_SCALE : 1) * TILE_PX
      const flip = animal.facingLeft === ANIMAL_ART_FACES_LEFT ? 1 : -1
      sprite.scale.set((flip * size) / texture.width, size / texture.height)
      sprite.position.set(animal.x * TILE_PX, animal.y * TILE_PX)
      sprite.zIndex = animal.y
      sprite.tint = animal.hurt ? 0xff8080 : 0xffffff
      under.ellipse(animal.x * TILE_PX, (animal.y + animal.size * 0.25) * TILE_PX, size * 0.38, size * 0.14).fill({ color: 0x000000, alpha: 0.25 })
      if (animal.leader) {
        over
          .moveTo(animal.leader.x * TILE_PX, animal.leader.y * TILE_PX)
          .lineTo(animal.x * TILE_PX, animal.y * TILE_PX)
          .stroke({ width: Math.max(1.5, 2.5 / zoom), color: ROPE })
      }
      if (animal.hovered) over.circle(animal.x * TILE_PX, animal.y * TILE_PX, size * 0.6).stroke({ width: 2 / zoom, color: HOVER })
    }
    for (const [id, sprite] of this.byId) {
      if (seen.has(id)) continue
      sprite.destroy()
      this.byId.delete(id)
    }
  }
}
