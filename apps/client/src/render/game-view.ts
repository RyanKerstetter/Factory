import type { TileBounds } from '../camera.ts'
import type { WorldFrame } from './world-renderer.ts'

// How the world is shown on the page: the 2D view (render/, Pixi, flat from straight above) or the 3D one (render3d/,
// three.js, isometric). game.ts works out what to draw (a WorldFrame) and talks to whichever it was given only
// through this, so either can be picked in the settings.
export interface GameView {
  readonly canvas: HTMLCanvasElement
  // Whether the screen is turned 45° from the world's grid, so the movement keys are turned to
  // go up, down, left and right on the screen.
  readonly turned: boolean
  // Points the camera at `focus` (in tiles) at `zoom` (see camera.ts's camera tuning) for this frame. `pick` and
  // `visible` answer for where it last looked.
  look(focus: { x: number; y: number }, zoom: number): void
  // The point on the ground, in tiles, under a point on the canvas (in CSS pixels from its top left).
  pick(point: { x: number; y: number }): { x: number; y: number }
  // The point on the ground itself under a point on the canvas, whatever stands there (for aiming an attack: `pick`
  // takes a tree or a building under the mouse to be at the middle of its tile).
  aim(point: { x: number; y: number }): { x: number; y: number }
  // The tiles in view, with a margin all round.
  visible(): TileBounds
  draw(frame: WorldFrame): void
  // Calls `frame` before drawing, every frame, from now on.
  start(frame: () => void): void
  // A line about the view for the debug overlay.
  describe(): string
  destroy(): void
}
