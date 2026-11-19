import { Container, Sprite, TilingSprite } from 'pixi.js'
import { CHUNK_SIZE, chunkCoords, chunkId, floorDiv, NO_ITEM, oreAt, waterAt } from '../../../../packages/shared/src/index.ts'
import { TILE_PX, type TileBounds } from '../camera.ts'
import type { Art } from './art.ts'
import { oreTileArt } from './art-catalog.ts'

// The ground: bare ground repeated over the screen, and ponds and ore deposits, which are worked out from the world's seed
// (see world-gen.ts) a chunk at a time as they come into view and let go of again when they are well out of it.
export class GroundLayer {
  readonly view = new Container()
  private readonly floor: TilingSprite
  private readonly ores = new Map<number, Container>()
  private readonly oreView = new Container()
  // The seed the chunks were worked out from: they are worked out again if it changes (the world's arrives late).
  private seed = Number.NaN

  constructor(private readonly art: Art) {
    const texture = art.texture('tile/ground')
    this.floor = new TilingSprite({ texture, width: TILE_PX, height: TILE_PX })
    this.floor.tileScale.set(TILE_PX / texture.width, TILE_PX / texture.height)
    this.view.addChild(this.floor, this.oreView)
  }

  update(seed: number, bounds: TileBounds): void {
    if (seed !== this.seed) {
      this.seed = seed
      for (const view of this.ores.values()) view.destroy({ children: true })
      this.ores.clear()
    }
    this.floor.position.set(bounds.left * TILE_PX, bounds.top * TILE_PX)
    this.floor.width = (bounds.right - bounds.left + 1) * TILE_PX
    this.floor.height = (bounds.bottom - bounds.top + 1) * TILE_PX

    const left = floorDiv(bounds.left, CHUNK_SIZE)
    const right = floorDiv(bounds.right, CHUNK_SIZE)
    const top = floorDiv(bounds.top, CHUNK_SIZE)
    const bottom = floorDiv(bounds.bottom, CHUNK_SIZE)
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        const id = chunkId(cx, cy)
        if (!this.ores.has(id)) this.ores.set(id, this.buildChunk(seed, cx, cy))
      }
    }
    for (const [id, view] of this.ores) {
      const { cx, cy } = chunkCoords(id)
      if (cx < left - 1 || cx > right + 1 || cy < top - 1 || cy > bottom + 1) {
        view.destroy({ children: true })
        this.ores.delete(id)
      }
    }
  }

  private buildChunk(seed: number, cx: number, cy: number): Container {
    const view = new Container()
    for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y++) {
      for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) {
        const water = waterAt(seed, x, y)
        const ore = water ? NO_ITEM : oreAt(seed, x, y)
        if (!water && ore === NO_ITEM) continue
        const sprite = new Sprite(this.art.texture(water ? 'tile/water' : oreTileArt(ore)))
        sprite.position.set(x * TILE_PX, y * TILE_PX)
        sprite.setSize(TILE_PX, TILE_PX)
        view.addChild(sprite)
      }
    }
    this.oreView.addChild(view)
    return view
  }
}
