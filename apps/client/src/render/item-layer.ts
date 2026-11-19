import { Container, Sprite } from 'pixi.js'
import { TILE_PX } from '../camera.ts'
import type { Art } from './art.ts'
import { itemArt } from './art-catalog.ts'
import { beltPoint } from './belt-path.ts'
import type { BuildingView } from './world-renderer.ts'

// How big an item on a belt is drawn: a quarter of a tile, which is how far apart items on a full belt are.
export const ITEM_PX = TILE_PX / 4

// The items on the belts, moving: each is drawn between where it was on the last tick and where it is now, `alpha` of
// the way, so items glide at any frame rate. Sprites are reused from frame to frame.
export class ItemLayer {
  readonly view = new Container()
  private readonly pool: Sprite[] = []

  constructor(private readonly art: Art) {}

  update(buildings: readonly BuildingView[], alpha: number): void {
    let used = 0
    for (const building of buildings) {
      if (!building.lane || building.lane.length === 0) continue
      const belt = { x: building.x, y: building.y, dir: building.dir, shape: building.shape ?? 'straight' }
      for (const item of building.lane) {
        const sprite = this.sprite(used++)
        const texture = this.art.texture(itemArt(item.item))
        if (sprite.texture !== texture) sprite.texture = texture
        const point = beltPoint(belt, item.prev + (item.pos - item.prev) * alpha)
        sprite.position.set(point.x * TILE_PX, point.y * TILE_PX)
        sprite.setSize(ITEM_PX, ITEM_PX)
        sprite.visible = true
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false
  }

  private sprite(index: number): Sprite {
    let sprite = this.pool[index]
    if (!sprite) {
      sprite = new Sprite()
      sprite.anchor.set(0.5)
      this.pool.push(sprite)
      this.view.addChild(sprite)
    }
    return sprite
  }
}
