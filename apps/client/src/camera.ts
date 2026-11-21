import { SUB, ZOOM_MAX, ZOOM_MIN, ZOOM_PER_NOTCH, ZOOM_SMOOTHING_MS } from '../../../packages/shared/src/index.ts'
export { DEFAULT_ZOOM, ZOOM_MAX, ZOOM_MIN, ZOOM_PER_NOTCH, ZOOM_SMOOTHING_MS } from '../../../packages/shared/src/index.ts'

// The world is drawn TILE_PX pixels to a tile at a zoom of 1. Positions in the simulation are in units (SUB to a tile);
// positions on the screen are in pixels.
export const TILE_PX = 64

// ---- camera tuning: change these to taste (the page reloads with them)
//
// The zoom levels are in packages/shared/src/constants.ts (ZOOM_MIN, ZOOM_MAX, DEFAULT_ZOOM, ZOOM_PER_NOTCH,
// ZOOM_SMOOTHING_MS).
// In 3D, the camera's angle above the ground, in degrees (90 is straight down), zoomed all the way out and all the way
// in: it levels off as you zoom in.
export const PITCH_ZOOMED_OUT = 60
export const PITCH_ZOOMED_IN = 35
// How the angle goes between the two as you zoom: 1 evenly, above 1 staying steep longer and levelling off near the
// end, below 1 levelling off sooner.
export const PITCH_CURVE = 1.5

// How far zoomed in, 0 (ZOOM_MIN) to 1 (ZOOM_MAX), evenly for each notch of the wheel.
function zoomShare(zoom: number): number {
  return Math.min(1, Math.max(0, Math.log(zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)))
}

// The 3D camera's angle above the ground at a zoom, in radians (see PITCH_ZOOMED_OUT).
export function cameraPitch(zoom: number): number {
  const share = zoomShare(zoom) ** PITCH_CURVE
  return ((PITCH_ZOOMED_OUT + (PITCH_ZOOMED_IN - PITCH_ZOOMED_OUT) * share) * Math.PI) / 180
}

// The zoom to head for after a turn of the wheel (`deltaY` in pixels; a notch is about 100), kept within its limits.
export function zoomAfterWheel(zoom: number, deltaY: number): number {
  const notches = -deltaY / 100
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * ZOOM_PER_NOTCH ** notches))
}

// The zoom drawn this frame, `ms` since the last, easing towards `target` (see ZOOM_SMOOTHING_MS).
export function easeZoom(zoom: number, target: number, ms: number): number {
  if (ZOOM_SMOOTHING_MS <= 0) return target
  const step = 1 - Math.exp(-ms / ZOOM_SMOOTHING_MS)
  const next = zoom * (target / zoom) ** step
  return Math.abs(next - target) < 0.0005 ? target : next
}

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

