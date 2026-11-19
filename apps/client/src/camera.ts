import { SUB } from '../../../packages/shared/src/index.ts'

// The world is drawn TILE_PX pixels to a tile at a zoom of 1. Positions in the simulation are in units (SUB to a tile);
// positions on the screen are in pixels.
export const TILE_PX = 64
export const ZOOM_LEVELS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]
export const DEFAULT_ZOOM = 1

export function unitsToPx(units: number): number {
  return (units / SUB) * TILE_PX
}

// What the screen shows: the world point in its middle (in world pixels), the zoom, and its size in screen pixels.
export type Camera = { centerX: number; centerY: number; zoom: number; width: number; height: number }

// Where the world's container goes and how big it is drawn, so the camera's centre is the middle of the screen.
// Rounded to whole screen pixels so pixel art does not shimmer as the camera moves.
export function cameraTransform(camera: Camera): { x: number; y: number; scale: number } {
  return {
    x: Math.round(camera.width / 2 - camera.centerX * camera.zoom),
    y: Math.round(camera.height / 2 - camera.centerY * camera.zoom),
    scale: camera.zoom,
  }
}

export function screenToWorld(camera: Camera, point: { x: number; y: number }): { x: number; y: number } {
  const { x, y, scale } = cameraTransform(camera)
  return { x: (point.x - x) / scale, y: (point.y - y) / scale }
}

export function screenToTile(camera: Camera, point: { x: number; y: number }): { x: number; y: number } {
  const world = screenToWorld(camera, point)
  return { x: Math.floor(world.x / TILE_PX), y: Math.floor(world.y / TILE_PX) }
}

export type TileBounds = { left: number; top: number; right: number; bottom: number }

// The tiles on screen, with one more all round.
export function visibleTiles(camera: Camera): TileBounds {
  const topLeft = screenToWorld(camera, { x: 0, y: 0 })
  const bottomRight = screenToWorld(camera, { x: camera.width, y: camera.height })
  return {
    left: Math.floor(topLeft.x / TILE_PX) - 1,
    top: Math.floor(topLeft.y / TILE_PX) - 1,
    right: Math.floor(bottomRight.x / TILE_PX) + 1,
    bottom: Math.floor(bottomRight.y / TILE_PX) + 1,
  }
}

export function nextZoom(zoom: number, steps: number): number {
  let index = ZOOM_LEVELS.findIndex((level) => level >= zoom)
  if (index < 0) index = ZOOM_LEVELS.length - 1
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + steps))]
}
