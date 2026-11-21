import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js'
import {
  campSites,
  CHUNK_SIZE,
  chunkCoords,
  chunkId,
  chunkOfTile,
  DUNGEON_LAYOUT,
  DUNGEON_SLOTS,
  dungeonEntrance,
  dungeonTile,
  floorDiv,
  type Terrain,
} from '../../../../packages/shared/src/index.ts'
import { TILE_PX, type TileBounds } from '../camera.ts'
import type { Art } from './art.ts'
import { groundChunk, PIXELS_PER_TILE_2D } from './ground-colors.ts'

// The ground: bare ground (the forest's) repeated over the screen, and over it each chunk's picture (see
// ground-colors.ts: the sea, shelf and deep ocean, the forest's grass and beaches, the mountains' rock and snow, ponds,
// and the ice crypt), worked out from the world's terrain a chunk at a time as it comes into view and let go of again
// when it is well out of it; and the landmarks (the skeletons' camps, the way into the dungeon and the stairs out).
export class GroundLayer {
  readonly view = new Container()
  private readonly floor: TilingSprite
  private readonly chunks = new Map<number, Container>()
  private readonly chunkView = new Container()
  // The terrain the chunks were worked out from: they are worked out again if it changes (the world's arrives late).
  private terrain: Terrain | undefined

  constructor(art: Art) {
    const texture = art.texture('tile/ground')
    this.floor = new TilingSprite({ texture, width: TILE_PX, height: TILE_PX })
    this.floor.tileScale.set(TILE_PX / texture.width, TILE_PX / texture.height)
    this.view.addChild(this.floor, this.chunkView)
  }

  update(terrain: Terrain | undefined, bounds: TileBounds): void {
    if (terrain !== this.terrain) {
      this.terrain = terrain
      for (const view of this.chunks.values()) view.destroy({ children: true, texture: true, textureSource: true })
      this.chunks.clear()
    }
    this.floor.position.set(bounds.left * TILE_PX, bounds.top * TILE_PX)
    this.floor.width = (bounds.right - bounds.left + 1) * TILE_PX
    this.floor.height = (bounds.bottom - bounds.top + 1) * TILE_PX
    if (!terrain) return

    const left = floorDiv(bounds.left, CHUNK_SIZE)
    const right = floorDiv(bounds.right, CHUNK_SIZE)
    const top = floorDiv(bounds.top, CHUNK_SIZE)
    const bottom = floorDiv(bounds.bottom, CHUNK_SIZE)
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        const id = chunkId(cx, cy)
        if (!this.chunks.has(id)) this.chunks.set(id, this.buildChunk(terrain, cx, cy))
      }
    }
    for (const [id, view] of this.chunks) {
      const { cx, cy } = chunkCoords(id)
      if (cx < left - 1 || cx > right + 1 || cy < top - 1 || cy > bottom + 1) {
        view.destroy({ children: true, texture: true, textureSource: true })
        this.chunks.delete(id)
      }
    }
  }

  private buildChunk(terrain: Terrain, cx: number, cy: number): Container {
    const view = new Container()
    // The chunk's picture (see ground-colors.ts), smoothly blended, stretched over its tiles.
    const ground = groundChunk(terrain, cx, cy, PIXELS_PER_TILE_2D)
    const canvas = document.createElement('canvas')
    canvas.width = ground.size
    canvas.height = ground.size
    canvas.getContext('2d')?.putImageData(new ImageData(ground.pixels, ground.size, ground.size), 0, 0)
    const texture = Texture.from(canvas)
    texture.source.scaleMode = 'nearest'
    const picture = new Sprite(texture)
    picture.position.set(cx * CHUNK_SIZE * TILE_PX, cy * CHUNK_SIZE * TILE_PX)
    picture.setSize(CHUNK_SIZE * TILE_PX, CHUNK_SIZE * TILE_PX)
    view.addChild(picture)
    // The landmarks in this chunk: the skeletons' camps, the way into the dungeon, and the stairs out of it.
    const marks = new Graphics()
    const here = chunkId(cx, cy)
    const px = (tile: number): number => (tile + 0.5) * TILE_PX
    for (const camp of campSites(terrain)) {
      if (chunkOfTile(camp.x, camp.y) !== here) continue
      marks.circle(px(camp.x), px(camp.y), TILE_PX * 1.4).fill({ color: 0x3a3632, alpha: 0.55 })
      marks.circle(px(camp.x), px(camp.y), TILE_PX * 0.45).fill(0x1e1b18)
      marks.poly([px(camp.x - 2.6), px(camp.y - 1), px(camp.x - 1.9), px(camp.y - 2.6), px(camp.x - 1.2), px(camp.y - 1)]).fill(0xa87a4f)
    }
    const entrance = dungeonEntrance(terrain)
    if (entrance && chunkOfTile(entrance.x, entrance.y) === here) {
      marks.rect(entrance.x * TILE_PX, entrance.y * TILE_PX, TILE_PX, TILE_PX).fill(0x0b0a09)
      marks.rect((entrance.x - 0.6) * TILE_PX, (entrance.y - 0.3) * TILE_PX, TILE_PX * 0.5, TILE_PX * 1.3).fill(0x6c6f75)
      marks.rect((entrance.x + 1.1) * TILE_PX, (entrance.y - 0.3) * TILE_PX, TILE_PX * 0.5, TILE_PX * 1.3).fill(0x6c6f75)
      marks.rect((entrance.x - 0.6) * TILE_PX, (entrance.y - 0.5) * TILE_PX, TILE_PX * 2.2, TILE_PX * 0.3).fill(0x8d8f94)
    }
    for (let slot = 0; slot < DUNGEON_SLOTS; slot++) {
      const exit = dungeonTile(slot, DUNGEON_LAYOUT.exit)
      if (chunkOfTile(exit.x, exit.y) !== here) continue
      for (let i = 0; i < 4; i++) marks.rect(exit.x * TILE_PX, (exit.y + i / 4) * TILE_PX, TILE_PX, TILE_PX / 4 - 1).fill(i % 2 ? 0x8d8f94 : 0xb8bbc0)
    }
    view.addChild(marks)
    this.chunkView.addChild(view)
    return view
  }
}
