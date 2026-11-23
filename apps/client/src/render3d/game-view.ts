import type { TileBounds } from '../camera.ts'
import type { WorldFrame } from './frame.ts'

// How the world is shown on the page (three-view.ts: three.js, from above at a slant). game.ts works out what to draw
// (a WorldFrame) and talks to the view only through this.
export interface GameView {
  readonly canvas: HTMLCanvasElement
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
