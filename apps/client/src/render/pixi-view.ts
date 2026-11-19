import { screenToWorld, TILE_PX, visibleTiles, type Camera, type TileBounds } from '../camera.ts'
import { Art } from './art.ts'
import type { GameView } from './game-view.ts'
import { createPixiApp } from './pixi-app.ts'
import { WorldRenderer, type WorldFrame } from './world-renderer.ts'

// The 2D view: the world flat from straight above, drawn with Pixi from the pictures under res/ (see art-catalog.ts).
export async function createPixiView(stage: HTMLElement): Promise<GameView> {
  const art = await Art.load()
  const app = await createPixiApp(stage)
  const renderer = new WorldRenderer(art)
  app.stage.addChild(renderer.scene)
  let camera: Camera = { centerX: 0, centerY: 0, zoom: 1, width: app.screen.width, height: app.screen.height }
  return {
    canvas: app.canvas,
    turned: false,
    look(focus, zoom) {
      camera = { centerX: focus.x * TILE_PX, centerY: focus.y * TILE_PX, zoom, width: app.screen.width, height: app.screen.height }
    },
    pick(point) {
      const world = screenToWorld(camera, point)
      return { x: world.x / TILE_PX, y: world.y / TILE_PX }
    },
    visible(): TileBounds {
      return visibleTiles(camera)
    },
    draw(frame: WorldFrame) {
      renderer.update(frame, camera)
    },
    start(frame) {
      app.ticker.add(frame)
    },
    describe() {
      return `2D, ${TILE_PX * camera.zoom} px a tile`
    },
    destroy() {
      app.destroy(true, { children: true })
    },
  }
}
