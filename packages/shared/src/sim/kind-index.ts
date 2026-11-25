import type { Entity, EntityOf } from './entity.ts'

// The buildings of each kind in a world, so whatever wants every waystone, altar or hive finds them without going
// through every building there is (nearly all of a world is trees and rocks). FactoryWorld keeps it as buildings come,
// go and change (a sapling grown into a tree is a new kind on the same ID). A kind's list is in ID order, and is made
// again only when something of that kind has come or gone since it was last asked for.
export class KindIndex {
  private readonly byKind = new Map<Entity['kind'], Map<number, Entity>>()
  private readonly lists = new Map<Entity['kind'], readonly Entity[]>()
  private readonly changed = new Map<Entity['kind'], number>()

  add(entity: Entity): void {
    let ofKind = this.byKind.get(entity.kind)
    if (!ofKind) {
      ofKind = new Map()
      this.byKind.set(entity.kind, ofKind)
    }
    ofKind.set(entity.id, entity)
    this.touch(entity.kind)
  }

  remove(entity: Entity): void {
    if (this.byKind.get(entity.kind)?.delete(entity.id)) this.touch(entity.kind)
  }

  // A building's new state in place of its old one (the same ID; the kind may be another).
  replace(old: Entity, entity: Entity): void {
    this.remove(old)
    this.add(entity)
  }

  // Every building of a kind, in ID order. The list is shared until that kind changes: do not keep it past a tick.
  of<K extends Entity['kind']>(kind: K): readonly EntityOf<K>[] {
    let list = this.lists.get(kind)
    if (!list) {
      list = [...(this.byKind.get(kind)?.values() ?? [])].sort((a, b) => a.id - b.id)
      this.lists.set(kind, list)
    }
    return list as readonly EntityOf<K>[]
  }

  count(kind: Entity['kind']): number {
    return this.byKind.get(kind)?.size ?? 0
  }

  // A number that goes up whenever a building of a kind comes, goes or is replaced (a new state put in by a `set`
  // event), and never otherwise: something worked out from a kind's buildings keeps it, and works it out again when it
  // differs.
  changes(kind: Entity['kind']): number {
    return this.changed.get(kind) ?? 0
  }

  private touch(kind: Entity['kind']): void {
    this.lists.delete(kind)
    this.changed.set(kind, this.changes(kind) + 1)
  }
}
