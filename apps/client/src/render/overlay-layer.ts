import { Container, Graphics, Sprite, Text } from 'pixi.js'
import { TILE_PX } from '../camera.ts'
import type { Art } from './art.ts'
import { placeBuilding } from './building-layer.ts'
import type { GhostView, OverlayView } from './world-renderer.ts'

const VALID_TINT = 0xffffff
const INVALID_TINT = 0xff5a44
const ACCENT = 0xf0b429
const REMOVE = 0xe5533d
const BAR_BACK = 0x171915
const BAR_FILL = 0x7cc35a

// What the player is doing, drawn over the world: the tile under the mouse, the plant a click would punch, what is
// about to be placed (red where it cannot go), what has been asked for that the server has not confirmed yet (see
// prediction.ts), the buildings being taken away, the building whose inventory is open, and the health of plants
// that have been punched.
export class OverlayLayer {
  readonly view = new Container()
  private readonly ghosts = new Container()
  private readonly marks = new Graphics()
  private readonly pool: Sprite[] = []
  // The name over a hovered chest.
  private readonly label = new Text({ text: '', style: { fill: '#f0e6d2', fontSize: 14, fontFamily: 'Arial', fontWeight: 'bold', stroke: { color: '#171915', width: 3 } }, resolution: 2 })

  constructor(private readonly art: Art) {
    this.label.anchor.set(0.5, 1)
    this.view.addChild(this.ghosts, this.marks, this.label)
  }

  update(overlay: OverlayView, zoom: number): void {
    this.label.visible = overlay.label !== undefined
    if (overlay.label) {
      if (this.label.text !== overlay.label.text) this.label.text = overlay.label.text
      this.label.scale.set(1 / zoom)
      this.label.position.set((overlay.label.x + 0.5) * TILE_PX, overlay.label.y * TILE_PX - 4 / zoom)
    }
    let used = 0
    const ghost = (view: GhostView, alpha: number): void => {
      let sprite = this.pool[used]
      if (!sprite) {
        sprite = new Sprite()
        sprite.anchor.set(0.5)
        this.pool.push(sprite)
        this.ghosts.addChild(sprite)
      }
      used++
      placeBuilding(sprite, this.art, view)
      sprite.alpha = alpha
      sprite.tint = view.valid ? VALID_TINT : INVALID_TINT
      sprite.visible = true
    }
    for (const pending of overlay.pending) ghost(pending, 0.45)
    if (overlay.ghost) ghost(overlay.ghost, 0.5)
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false

    const line = 2 / zoom
    const g = this.marks.clear()
    if (overlay.target) {
      // The plant a left click would punch is framed in amber.
      g.rect(overlay.target.x * TILE_PX, overlay.target.y * TILE_PX, TILE_PX, TILE_PX).stroke({ width: line, color: ACCENT })
    } else if (overlay.ghost) {
      // The building about to be placed is framed, amber where it can go and red where it cannot.
      g.rect(overlay.ghost.x * TILE_PX, overlay.ghost.y * TILE_PX, TILE_PX, TILE_PX).stroke({ width: line, color: overlay.ghost.valid ? ACCENT : INVALID_TINT })
    } else if (overlay.hover) {
      g.rect(overlay.hover.x * TILE_PX, overlay.hover.y * TILE_PX, TILE_PX, TILE_PX).stroke({ width: line, color: 0xece8d9, alpha: 0.6 })
    }
    if (overlay.selected) {
      g.rect(overlay.selected.x * TILE_PX, overlay.selected.y * TILE_PX, TILE_PX, TILE_PX).stroke({ width: line * 1.5, color: ACCENT })
    }
    for (const bar of overlay.bars) {
      const width = TILE_PX * 0.8
      const height = Math.max(4, 6 / zoom)
      const x = (bar.x + 0.1) * TILE_PX
      const y = (bar.y + (bar.tall ? -0.65 : -0.2)) * TILE_PX
      g.rect(x - line / 2, y - line / 2, width + line, height + line).fill({ color: BAR_BACK, alpha: 0.85 })
      g.rect(x, y, width * Math.max(0, Math.min(1, bar.fraction)), height).fill({ color: BAR_FILL })
    }
    for (const tile of overlay.removing) {
      const x = tile.x * TILE_PX
      const y = tile.y * TILE_PX
      const inset = TILE_PX * 0.2
      g.moveTo(x + inset, y + inset).lineTo(x + TILE_PX - inset, y + TILE_PX - inset)
      g.moveTo(x + TILE_PX - inset, y + inset).lineTo(x + inset, y + TILE_PX - inset)
      g.stroke({ width: line * 2, color: REMOVE })
    }
  }
}
