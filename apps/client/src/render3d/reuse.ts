import type * as THREE from 'three'

// What the 3D view keeps from frame to frame, rather than making it all again each frame.

// The models of what a frame shows, kept by ID in a group of the scene: each made when it first shows (and made again
// when what its model depends on, its `key`, changes), and taken away once it no longer shows.
export class KeptById<K extends { object: THREE.Object3D }> {
  private readonly kept = new Map<number, { key: string; made: K }>()
  private readonly seen = new Set<number>()

  // `forget` frees anything else that goes with one taken away (the name over a player, say).
  constructor(
    private readonly group: THREE.Object3D,
    private readonly forget: (made: K) => void = () => {},
  ) {}

  // The one for `id` on this frame: as kept, or made by `make` if it is new or its key has changed.
  keep(id: number, key: string, make: () => K): K {
    this.seen.add(id)
    const kept = this.kept.get(id)
    if (kept && kept.key === key) return kept.made
    if (kept) this.drop(kept.made)
    const made = make()
    this.kept.set(id, { key, made })
    this.group.add(made.object)
    return made
  }

  // Takes away each one not kept since the last sweep: call it once a frame, after keeping each one that shows.
  sweep(): void {
    for (const [id, kept] of this.kept) {
      if (this.seen.has(id)) continue
      this.drop(kept.made)
      this.kept.delete(id)
    }
    this.seen.clear()
  }

  *values(): Generator<K> {
    for (const kept of this.kept.values()) yield kept.made
  }

  private drop(made: K): void {
    this.group.remove(made.object)
    this.forget(made)
  }
}

// Things drawn again and again (sparks, damage numbers, health bars...), made only as more are needed and reused from
// frame to frame: a frame takes them in turn, as many as it shows, and `finish` hides the rest.
export class Pool<T> {
  private readonly made: T[] = []
  private used = 0

  constructor(
    private readonly make: () => T,
    private readonly show: (item: T, shown: boolean) => void,
  ) {}

  // The next one for this frame, shown.
  next(): T {
    let item = this.made[this.used]
    if (item === undefined) {
      item = this.make()
      this.made.push(item)
    }
    this.used++
    this.show(item, true)
    return item
  }

  // Hides the ones this frame did not use, and starts again from the first for the next.
  finish(): void {
    for (let i = this.used; i < this.made.length; i++) this.show(this.made[i], false)
    this.used = 0
  }

  // Each one made so far (to free them).
  all(): readonly T[] {
    return this.made
  }
}

// Shows or hides a pooled object (for a Pool of single objects).
export function showObject(object: THREE.Object3D, shown: boolean): void {
  object.visible = shown
}
