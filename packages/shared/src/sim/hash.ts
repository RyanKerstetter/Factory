// A running 32-bit hash of whole numbers (FNV-1a with an extra mix), for checking that two copies of a chunk are the
// same. Integer arithmetic only, so it is the same on every machine.
export class Hasher {
  private h = 0x811c9dc5

  int(value: number): this {
    this.h = Math.imul(this.h ^ (value | 0), 0x01000193)
    this.h ^= this.h >>> 13
    return this
  }

  get value(): number {
    let h = this.h
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
    h ^= h >>> 13
    return h >>> 0
  }
}
