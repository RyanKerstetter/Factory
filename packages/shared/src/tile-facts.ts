import { CHUNK_SIZE } from './constants.ts'
import { chunkId } from './geometry.ts'

// A fact about every tile of a world that never changes once the world is made (which island a tile is on, whether it
// is water), asked about all the time (every step anything takes looks at the tiles round it, the ground is painted
// from them), and slow to work out from the noise each time. It is worked out a whole chunk at a time, the first time
// any tile of the chunk is asked about, and kept as a byte a tile (a kilobyte a chunk) for as long as the world (`of`,
// the key: its Terrain) is. Only chunks something has asked about are kept.
export class TileFacts<Of extends object> {
  private readonly worlds = new WeakMap<Of, Map<number, Uint8Array>>()

  // `workOut` gives the fact for one tile, 0 to 255.
  constructor(private readonly workOut: (of: Of, x: number, y: number) => number) {}

  at(of: Of, x: number, y: number): number {
    const cx = Math.floor(x / CHUNK_SIZE)
    const cy = Math.floor(y / CHUNK_SIZE)
    let chunks = this.worlds.get(of)
    if (!chunks) this.worlds.set(of, (chunks = new Map()))
    const key = chunkId(cx, cy)
    let tiles = chunks.get(key)
    if (!tiles) {
      tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)
      for (let ty = 0; ty < CHUNK_SIZE; ty++) {
        for (let tx = 0; tx < CHUNK_SIZE; tx++) tiles[ty * CHUNK_SIZE + tx] = this.workOut(of, cx * CHUNK_SIZE + tx, cy * CHUNK_SIZE + ty)
      }
      chunks.set(key, tiles)
    }
    return tiles[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)]
  }
}
