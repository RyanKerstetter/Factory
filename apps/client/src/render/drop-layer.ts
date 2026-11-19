import { Container, Graphics, Sprite } from 'pixi.js'
import { TILE_PX } from '../camera.ts'
import type { Art } from './art.ts'
import { itemArt } from './art-catalog.ts'
import type { DropView } from './world-renderer.ts'

// How big an item on the ground is drawn, in tiles.
const DROP_SIZE = 0.38
// An item that has just landed pops out of the ground over this many ticks, in a little hop.
const LANDING_TICKS = 8
const HOP = 0.3
// Items on the ground bob gently, this high (in tiles) and this fast.
const BOB = 0.035
const BOB_SPEED = 0.004

// The items lying on the ground: each its icon over a small shadow, bobbing, and hopping out of the ground when it
// has just been dropped. Sprites are kept from frame to frame by the item's ID.
export class DropLayer {
  readonly view = new Container()
  private readonly shadows = new Graphics()
  private readonly icons = new Container()
  private readonly sprites = new Map<number, Sprite>()

  constructor(private readonly art: Art) {
    this.view.addChild(this.shadows, this.icons)
  }

  update(drops: readonly DropView[], now: number): void {
    const seen = new Set<number>()
    const g = this.shadows.clear()
    for (const drop of drops) {
      seen.add(drop.id)
      let sprite = this.sprites.get(drop.id)
      if (!sprite) {
        sprite = new Sprite()
        sprite.anchor.set(0.5)
        this.sprites.set(drop.id, sprite)
        this.icons.addChild(sprite)
      }
      const texture = this.art.texture(itemArt(drop.item))
      if (sprite.texture !== texture) sprite.texture = texture
      const landing = Math.min(1, Math.max(0, drop.age / LANDING_TICKS))
      const hop = Math.sin(landing * Math.PI) * HOP
      const bob = landing >= 1 ? (Math.sin(now * BOB_SPEED + drop.id) + 1) * BOB : 0
      const size = DROP_SIZE * TILE_PX * (0.5 + landing * 0.5)
      sprite.setSize(size, size)
      sprite.position.set(drop.x * TILE_PX, (drop.y - hop - bob) * TILE_PX)
      g.ellipse(drop.x * TILE_PX, (drop.y + DROP_SIZE * 0.42) * TILE_PX, size * 0.38, size * 0.14).fill({ color: 0x000000, alpha: 0.25 })
    }
    for (const [id, sprite] of this.sprites) {
      if (seen.has(id)) continue
      sprite.destroy()
      this.sprites.delete(id)
    }
  }
}
