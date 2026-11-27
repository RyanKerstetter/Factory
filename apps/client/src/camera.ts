import { ZOOM_MAX, ZOOM_MIN, ZOOM_PER_NOTCH, ZOOM_SMOOTHING_MS } from '../../../packages/shared/src/index.ts'
export { DEFAULT_ZOOM } from '../../../packages/shared/src/index.ts'

// ---- camera tuning: change these to taste (the page reloads with them)
//
// The zoom levels are in packages/shared/src/constants.ts (ZOOM_MIN, ZOOM_MAX, DEFAULT_ZOOM, ZOOM_PER_NOTCH,
// ZOOM_SMOOTHING_MS).
// The camera's angle above the ground, in degrees (90 is straight down), zoomed all the way out and all the way in: it
// levels off as you zoom in.
const PITCH_ZOOMED_OUT = 60
const PITCH_ZOOMED_IN = 35
// How the angle goes between the two as you zoom: 1 evenly, above 1 staying steep longer and levelling off near the
// end, below 1 levelling off sooner.
const PITCH_CURVE = 1.5

// How many pixels a tile is drawn at zoom 1, on a window VIEW_HEIGHT pixels tall (a taller or shorter window shows the
// same ground, bigger or smaller).
export const PX_PER_TILE = 56
export const VIEW_HEIGHT = 1440

// How much ground a screen of an aspect (width over height) shows round the player, at a zoom: tiles each way across
// (`x`), and each way north and south (`y`: the camera is tilted, so the screen's height covers more ground than it
// would looking straight down). The camera looks squarely, without perspective, so this is the same whatever the
// window's size.
export function groundSpan(aspect: number, zoom: number): { x: number; y: number } {
  const halfHeight = VIEW_HEIGHT / 2 / (PX_PER_TILE * zoom)
  return { x: halfHeight * aspect, y: halfHeight / Math.sin(cameraPitch(zoom)) }
}

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

// The tiles a view shows (see GameView.visible).
export type TileBounds = { left: number; top: number; right: number; bottom: number }
