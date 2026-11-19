import { Graphics } from 'pixi.js'
import { CHUNK_SIZE, chunkCoords } from '../../../../packages/shared/src/index.ts'
import { TILE_PX } from '../camera.ts'
import type { DebugView } from './world-renderer.ts'

const CHUNK_SPAN = CHUNK_SIZE * TILE_PX

// The debug view (F3): the edges of the chunks this page simulates (red over one whose copy is waiting to be sent
// again), and the links in view: green where this page works the link out itself, blue where it takes the server's
// word because it simulates only one end, red where the link is blocked.
export class DebugLayer {
  readonly view = new Graphics()

  update(debug: DebugView | undefined, zoom: number): void {
    const g = this.view.clear()
    if (!debug) return
    const line = 1.5 / zoom
    for (const chunk of debug.chunks) {
      const { cx, cy } = chunkCoords(chunk)
      g.rect(cx * CHUNK_SPAN, cy * CHUNK_SPAN, CHUNK_SPAN, CHUNK_SPAN)
      if (debug.desynced.includes(chunk)) g.fill({ color: 0xe5533d, alpha: 0.18 })
      g.stroke({ width: line * 2, color: 0x58b4c8, alpha: 0.7 })
    }
    for (const link of debug.links) {
      const color = link.blocked ? 0xe5533d : link.remote ? 0x58b4c8 : 0x8bc34a
      const fx = (link.from.x + 0.5) * TILE_PX
      const fy = (link.from.y + 0.5) * TILE_PX
      const tx = (link.to.x + 0.5) * TILE_PX
      const ty = (link.to.y + 0.5) * TILE_PX
      g.moveTo(fx, fy).lineTo(tx, ty).stroke({ width: line * 2, color, alpha: 0.9 })
      g.circle(tx, ty, 4 / zoom).fill({ color })
    }
  }
}
