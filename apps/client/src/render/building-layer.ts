import { Container, Sprite } from 'pixi.js'
import { SAPLING_STAGES, SPROUT_STAGES } from '../../../../packages/shared/src/index.ts'
import { TILE_PX } from '../camera.ts'
import type { Art } from './art.ts'
import { buildingArt, itemArt } from './art-catalog.ts'
import type { BuildingView } from './world-renderer.ts'

// How far a punched plant sways, in pixels at normal zoom, and how fast.
const SHAKE_PX = 4
const SHAKE_SPEED = 0.06

// A sprite for each building and plant in view, kept from frame to frame by its ID. They are drawn in order of their
// rows, so a tree's canopy covers what is behind it (above it on the screen) and not what is in front.
export class BuildingLayer {
  readonly view = new Container()
  private readonly sprites = new Map<number, Sprite>()
  // The crop growing in each garden plot that has one.
  private readonly crops = new Map<number, Sprite>()
  private seen = new Set<number>()

  private readonly cropShown = new Set<number>()
  // The tool stuck in each stump that has one: its item's picture, over the stump.
  private readonly tools = new Map<number, Sprite>()
  private readonly toolShown = new Set<number>()

  constructor(private readonly art: Art) {
    this.view.sortableChildren = true
  }

  // A crop stands in its plot, a tile wide and as tall as its picture is for that width, its foot near the plot's
  // bottom edge.
  private placeCrop(building: BuildingView): void {
    if (!building.cropArt) return
    this.cropShown.add(building.id)
    let sprite = this.crops.get(building.id)
    if (!sprite) {
      sprite = new Sprite()
      sprite.anchor.set(0.5, 1)
      this.crops.set(building.id, sprite)
      this.view.addChild(sprite)
    }
    const texture = this.art.texture(building.cropArt)
    if (sprite.texture !== texture) sprite.texture = texture
    const width = TILE_PX * 0.85
    sprite.scale.set(width / texture.width, width / texture.width)
    sprite.position.set((building.x + 0.5) * TILE_PX, (building.y + 0.9) * TILE_PX)
    sprite.zIndex = building.y + 0.5
  }

  private placeTool(building: BuildingView): void {
    if (building.tool === undefined) return
    this.toolShown.add(building.id)
    let sprite = this.tools.get(building.id)
    if (!sprite) {
      sprite = new Sprite()
      sprite.anchor.set(0.5)
      this.tools.set(building.id, sprite)
      this.view.addChild(sprite)
    }
    const texture = this.art.texture(itemArt(building.tool))
    if (sprite.texture !== texture) sprite.texture = texture
    sprite.setSize(TILE_PX * 0.6, TILE_PX * 0.6)
    sprite.position.set((building.x + 0.55) * TILE_PX, (building.y + 0.4) * TILE_PX)
    sprite.rotation = -0.5
    sprite.zIndex = building.y + 0.5
  }

  // `shaking` is how hard each plant that was just punched still sways, 1 at the punch down to 0.
  update(buildings: readonly BuildingView[], removing: ReadonlySet<number>, shaking: ReadonlyMap<number, number>, now: number): void {
    const seen = new Set<number>()
    for (const building of buildings) {
      seen.add(building.id)
      let sprite = this.sprites.get(building.id)
      if (!sprite) {
        sprite = new Sprite()
        this.sprites.set(building.id, sprite)
        this.view.addChild(sprite)
      }
      placeBuilding(sprite, this.art, building)
      const shake = shaking.get(building.id) ?? 0
      if (shake > 0) {
        const sway = Math.sin(now * SHAKE_SPEED) * shake
        sprite.x += sway * SHAKE_PX
        sprite.rotation = sway * 0.06
      }
      sprite.zIndex = building.y
      sprite.alpha = removing.has(building.id) ? 0.4 : 1
      this.placeCrop(building)
      this.placeTool(building)
    }
    for (const id of this.seen) {
      if (seen.has(id)) continue
      this.sprites.get(id)?.destroy()
      this.sprites.delete(id)
    }
    for (const [id, crop] of this.crops) {
      if (seen.has(id) && this.cropShown.has(id)) continue
      crop.destroy()
      this.crops.delete(id)
    }
    this.cropShown.clear()
    for (const [id, tool] of this.tools) {
      if (seen.has(id) && this.toolShown.has(id)) continue
      tool.destroy()
      this.tools.delete(id)
    }
    this.toolShown.clear()
    this.seen = seen
  }
}

// How big a plant is drawn, in tiles, and how far up from the middle of its tile (so a tree's trunk stands on it).
function plantSize(building: Pick<BuildingView, 'kind' | 'stage'>): { size: number; lift: number } | undefined {
  switch (building.kind) {
    case 'tree':
      return { size: 1.6, lift: 0.3 }
    case 'bush':
      return { size: 1.05, lift: 0.05 }
    case 'grass':
      return { size: 0.8, lift: 0.05 }
    case 'loose':
      return { size: 0.45, lift: 0 }
    case 'rock':
      return { size: 1, lift: 0.05 }
    case 'sapling':
      return { size: 0.45 + (0.4 * Math.min(building.stage ?? 0, SAPLING_STAGES)) / SAPLING_STAGES, lift: 0.1 }
    case 'sprout':
      return { size: 0.4 + (0.5 * Math.min(building.stage ?? 0, SPROUT_STAGES)) / SPROUT_STAGES, lift: 0.03 }
    default:
      return undefined
  }
}

// Sets a sprite to draw a building or plant: its picture, a building turned to face its way (and a corner belt's
// picture flipped when it turns the other way), a plant at its size.
export function placeBuilding(
  sprite: Sprite,
  art: Art,
  building: Pick<BuildingView, 'kind' | 'x' | 'y' | 'dir' | 'shape' | 'stage' | 'connect' | 'open' | 'lit' | 'item'>,
): void {
  const shape = building.shape ?? 'straight'
  const texture = art.texture(buildingArt(building))
  if (sprite.texture !== texture) sprite.texture = texture
  sprite.anchor.set(0.5)
  const plant = plantSize(building)
  if (plant) {
    sprite.position.set((building.x + 0.5) * TILE_PX, (building.y + 0.5 - plant.lift) * TILE_PX)
    sprite.rotation = 0
    sprite.scale.set((plant.size * TILE_PX) / texture.width, (plant.size * TILE_PX) / texture.height)
    return
  }
  sprite.position.set((building.x + 0.5) * TILE_PX, (building.y + 0.5) * TILE_PX)
  sprite.rotation = (building.dir * Math.PI) / 2
  sprite.scale.set(TILE_PX / texture.width, ((shape === 'right' ? -1 : 1) * TILE_PX) / texture.height)
}
