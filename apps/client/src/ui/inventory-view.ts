import { AMMO_SLOT, ARMOR_SLOT, ARMOR_SLOTS, CHEST_NAME_LENGTH, FOOD_SLOT, getItem, HOTBAR_SLOTS, isFilled, NO_ITEM, STACK_SIZE, stackLimit, TRASH_SLOT, type BuildingKind, type ItemId, type Slot } from '../../../../packages/shared/src/index.ts'
import type { LiquidTone } from '../liquids.ts'
import { iconUrl, showIcon } from './icons.ts'
import { itemTip } from './item-tip.ts'
import { button, element, pixelImage } from './dom.ts'
import { createItemSpawner } from './item-spawner.ts'
import { createRecipeBook, type BookEntry, type RecipeBook } from './recipe-book.ts'

// What goes in each of the inventory's special slots, drawn faintly in it while it is empty (outlines on a 24 by 24
// grid): a helmet, a tunic, a boot, an arrow, an apple.
type SlotMark = 'head' | 'body' | 'feet' | 'ammo' | 'food'
const SLOT_MARKS: Readonly<Record<SlotMark, string>> = {
  head: '<path d="M5 16a7 7 0 0 1 14 0z"/><path d="M3 16h18v2.5H3z"/><path d="M12 9v4"/>',
  body: '<path d="M8.5 3.5 3 6.5l2 5 3-1.2V20.5h8V10.3l3 1.2 2-5-5.5-3c-.7 1.8-2 2.8-3.5 2.8s-2.8-1-3.5-2.8z"/>',
  feet: '<path d="M7.5 3h6v9.5l5.5 2.6c1.2.6 2 1.6 2 2.9v2H5.5v-3.5L7.5 15z"/><path d="M5.5 17.5h15.5"/>',
  ammo: '<path d="M5 19 18 6"/><path d="M12.5 5H19v6.5"/><path d="M4 15.5 6 18l2.5 2"/><path d="M3 18.5 5.5 21"/>',
  food: '<path d="M12 7.5c-2.5-2-8-1.3-8 4.8 0 4.7 3 8.7 5 8.7 1.2 0 2-.8 3-.8s1.8.8 3 .8c2 0 5-4 5-8.7 0-6.1-5.5-6.8-8-4.8z"/><path d="M12 7.5c0-2 .8-3.6 2.8-4.5"/>',
}
function slotMark(mark: SlotMark): HTMLElement {
  const made = element('span', 'slot-mark')
  made.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${SLOT_MARKS[mark]}</svg>`
  return made
}

export type BuildingPanelView = {
  id: number
  kind: BuildingKind
  title: string
  slots: readonly Slot[]
  // A miner: what it digs. How far through the next one it is goes to `setProgress`, every frame.
  mining?: { item: ItemId }
  // A machine (the stump, the workbench, a campfire, a barrel, a drying rack): see MachineView. How far through what it
  // is doing it is goes to `setProgress` too.
  machine?: MachineView
  acceptsDeposits: boolean
  inReach: boolean
  // Nothing can be taken out or put in (a sealed barrel, a guarded chest).
  locked?: boolean
  // A dungeon's chest, shut while its skeletons stand.
  guarded?: boolean
  // A chest's name, if it has one.
  name?: string
}

// A machine's panel: its slots (what goes in on the left, what comes out on the right, an arrow that fills as it works
// between them), gauges (heat, liquid), its buttons, and the recipes it can make, at the side (`action` is the label of
// the button under the one picked, or '' for none). A station's tool slot is marked as one (`tool`).
export type MachineView = {
  inputs: ReadonlyArray<{ index: number; tool?: boolean }>
  outputs: ReadonlyArray<{ index: number }>
  // A campfire: how much is left of what it is burning, 0 to 1, as a flame between its first input and the rest.
  flame?: number
  gauges: ReadonlyArray<{ label: string; fraction: number; text: string; tone: 'heat' | 'plain' | LiquidTone }>
  buttons: ReadonlyArray<{ id: string; label: string; disabled: boolean; primary?: boolean }>
  // What it is doing now, in a few words at the foot of its panel ("Crafting planks"); nothing while it is idle.
  status?: string
  // What it makes, at the side.
  recipes?: { title: string; action: string; entries: readonly BookEntry[] }
}

// The player's whole inventory (its first HOTBAR_SLOTS slots are the hotbar, shown as a row of their own), which
// hotbar slot is picked, and the building that is open, if any; with no building open, the recipes to craft.
// `crafting`: what is being made by hand (with no building open), how far along (0 to 1), and how many are waiting.
// `spawning`: the host has item spawning on, so every item can be taken out of nothing (a panel at the left).
export type PanelsView = {
  player: readonly Slot[]
  selected: number
  building?: BuildingPanelView
  recipes?: readonly BookEntry[]
  crafting?: { name: string; fraction: number; queued: number }
  spawning?: boolean
}

export type PanelHandlers = {
  take: (id: number, item: ItemId, max: number) => void
  // `slot`: the player's slot clicked, which it comes out of first (else only their ordinary slots: see transferItems).
  put: (id: number, item: ItemId, max: number, slot?: number) => void
  // Move up to `count` from one slot to another (`id` 0 is the player's inventory, else the building's ID): onto an empty
  // slot or a stack of its kind, or swapping two stacks.
  slot: (from: { id: number; i: number }, to: { id: number; i: number }, count: number) => void
  // Drop up to `count` from a slot on the ground, towards the point on the screen it was let go over.
  drop: (from: { id: number; i: number }, count: number, screen: { x: number; y: number }) => void
  // Pick a hotbar slot (clicked in the hotbar row, with no building open).
  select: (slot: number) => void
  // Make a recipe from the player's inventory, `times` times (Infinity: as many as can be made).
  craft: (recipe: number, times: number) => void
  // A machine's button (by its id), and the button under one of its recipes (`times` as for `craft`).
  press: (id: number, button: string) => void
  recipe: (id: number, recipe: number, times: number) => void
  // A chest: sort it, top up its stacks from the inventory, or name it.
  chest: (id: number, action: 'sort' | 'stash') => void
  rename: (id: number, name: string) => void
  // Take `count` of an item out of nothing (item spawning on).
  give: (item: ItemId, count: number) => void
  close: () => void
}

export type InventoryPanels = {
  show(view: PanelsView | undefined): void
  // The slot under the mouse, if the panels are open and it is over one.
  hovered(): { side: 'player' | 'building'; index: number } | undefined
  // How far the open miner or station is through its next item, 0 to 1. Called every frame, not only when `show` is,
  // so the bar fills smoothly.
  setProgress(fraction: number): void
  // How far along what is being made by hand is (0 to 1), every frame, so its bar fills smoothly.
  setHandProgress(fraction: number): void
  dispose(): void
}

const EVERYTHING = 100_000

// How far the mouse has to move with the button down before a click becomes a drag, in pixels.
const DRAG_THRESHOLD = 5
// Holding the middle button still on a stack: after HOLD_DELAY ms (so it is not a drag), one moves across every
// HOLD_FIRST ms, sooner each time (HOLD_SPEEDUP) down to one every HOLD_FASTEST ms.
const HOLD_DELAY = 350
const HOLD_FIRST = 260
const HOLD_SPEEDUP = 0.82
const HOLD_FASTEST = 35

type Side = 'player' | 'building'
type Cell = { button: HTMLButtonElement; icon: HTMLImageElement; count: HTMLSpanElement; shown: string }
// A grid shows `cells.length` slots of an inventory from slot `offset` on; `slots` is the whole inventory.
type Grid = { side: Side; offset: number; root: HTMLElement; cells: Cell[]; slots: readonly Slot[] }

// Dragging a stack: the slot it came from and where the mouse went down, whether it carries half the stack (dragged with
// the right button), and,
// once it has moved far enough to be a drag, the picture of the stack that follows the mouse and the slot it is over.
type Drag = { side: Side; index: number; startX: number; startY: number; half: boolean; ghost?: HTMLElement; over?: HTMLElement }

// The middle button down on a stack: where it went down, and how to move one of it across (as a middle click does) and
// whether there is any left; then either held still (`timer`, and once it is `repeating`, moving one at a time) or
// dragged (`dragging`), leaving one on each slot it passes over (`visited`).
type Middle = {
  side: Side
  index: number
  startX: number
  startY: number
  moveOne: () => void
  left: () => boolean
  timer?: ReturnType<typeof setTimeout>
  repeating: boolean
  dragging: boolean
  visited: Set<HTMLElement>
}

// A grid of slots, made once and filled in place each time what is in it changes, so a click is never lost to the
// grid being made again under the mouse while items arrive. Its cells are slots `offset` to `offset + size - 1`, and
// every index handed on is the slot's index in the whole inventory. `onMove` is given that and how many to move;
// `onPress` is told when the left or right button goes down on a stack, which may become a drag, and `wasDrag` says
// whether the click that follows ends one (and should do nothing more); `onMiddle` when the middle button does.
function createGrid(
  side: Side,
  offset: number,
  size: number,
  onMove: (index: number, max: number) => void,
  onPress: (side: Side, index: number, event: PointerEvent) => void,
  wasDrag: () => boolean,
  onMiddle: (side: Side, index: number, event: PointerEvent, moveOne: () => void, left: () => boolean) => void,
): Grid {
  const grid: Grid = { side, offset, root: element('div', 'slot-grid'), cells: [], slots: [] }
  for (let index = offset; index < offset + size; index++) {
    const icon = pixelImage('slot-icon')
    const count = element('span', 'slot-count')
    const cell = element('button', 'slot', icon, count)
    cell.type = 'button'
    cell.dataset.side = side
    cell.dataset.index = String(index)
    cell.addEventListener('pointerdown', (event) => {
      if (event.button === 0 && isFilled(grid.slots[index])) onPress(side, index, event)
    })
    cell.addEventListener('click', (event) => {
      if (wasDrag()) return
      const slot = grid.slots[index]
      if (isFilled(slot)) onMove(index, event.shiftKey ? EVERYTHING : slot.count)
    })
    // A right click moves half the stack, but only one that started on the panels: the right click that opened a chest
    // is let go over the panel it opened, and must not move anything.
    cell.addEventListener('pointerdown', (event) => {
      if (event.button !== 2) return
      rightDownOn = cell
      // The right button drags half the stack.
      if (isFilled(grid.slots[index])) onPress(side, index, event)
    })
    cell.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      const started = rightDownOn === cell
      rightDownOn = undefined
      if (wasDrag()) return
      const slot = grid.slots[index]
      if (started && isFilled(slot)) onMove(index, Math.ceil(slot.count / 2))
    })
    // The middle button: a click moves one; held still, one after another, faster and faster; dragged, one onto each
    // slot it passes over. (Not the browser's own scrolling.)
    cell.addEventListener('pointerdown', (event) => {
      if (event.button !== 1) return
      event.preventDefault()
      if (isFilled(grid.slots[index])) onMiddle(side, index, event, () => onMove(index, 1), () => isFilled(grid.slots[index]))
    })
    cell.addEventListener('auxclick', (event) => event.preventDefault())
    cell.addEventListener('pointerenter', () => (hoveredCell = { side, index }))
    cell.addEventListener('pointerleave', () => {
      if (hoveredCell?.side === side && hoveredCell.index === index) hoveredCell = undefined
    })
    // Nothing has been shown yet, so the first fill sets every cell, empty or not.
    grid.cells.push({ button: cell, icon, count, shown: 'unset' })
    grid.root.append(cell)
  }
  return grid
}

// The slot under the mouse, if any (for the number keys: see InventoryPanels.hovered).
let hoveredCell: { side: Side; index: number } | undefined

// The slot the right mouse button last went down on (see the right click in `createGrid`).
let rightDownOn: HTMLElement | undefined

// `movable`: a click moves the stack across. `draggable`: it can be dragged.
function fillGrid(grid: Grid, slots: readonly Slot[], movable: boolean, draggable: boolean): void {
  grid.slots = slots
  grid.cells.forEach((cell, at) => {
    const slot = slots[grid.offset + at]
    const filled = isFilled(slot)
    const key = filled ? `${slot.item}:${slot.count}:${movable}:${draggable}` : ''
    if (key === cell.shown) return
    cell.shown = key
    cell.icon.hidden = !filled
    cell.count.textContent = filled ? String(slot.count) : ''
    cell.button.classList.toggle('is-movable', filled && movable)
    cell.button.classList.toggle('is-draggable', filled && draggable)
    // Not `disabled`: an empty slot still has to be found under the mouse, as somewhere to drop a stack.
    cell.button.classList.toggle('is-empty', !filled)
    cell.button.setAttribute('aria-disabled', String(!filled))
    if (filled) {
      showIcon(cell.icon, slot.item)
      cell.button.dataset.tip = itemTip(slot.item)
    } else delete cell.button.dataset.tip
  })
}

// The player's inventory, and with it the building that is open: a chest or miner beside it; a work station above it,
// with the station's recipes at the side; or, with nothing open, the crafting book beside it. Clicking a slot moves its
// stack across (into the player's inventory from the building, or into the building from the player's, if it takes
// items); a right click moves half of it, and a middle click one (held, one after another, faster and faster); holding
// Shift moves every one of that kind. A stack can also be dragged: to another slot of either inventory (onto a stack of
// its kind as far as it fits, or swapping places), half of it with the right button, or off the panels to drop it on
// the ground; dragged with the middle button, it leaves one on each slot it passes over. The trash slot holds one
// stack, thrown away when another kind is put there.
export function createInventoryPanels(container: HTMLElement, handlers: PanelHandlers): InventoryPanels {
  const root = element('div', 'panels')
  root.hidden = true
  container.append(root)

  let current: PanelsView | undefined
  let layout = ''
  let playerGrid: Grid | undefined
  let hotbarGrid: Grid | undefined
  let ammoGrid: Grid | undefined
  let foodGrid: Grid | undefined
  let trashGrid: Grid | undefined
  let armourGrid: Grid | undefined
  let buildingGrids: Grid[] = []
  let progressFill: HTMLElement | undefined
  let flameFill: HTMLElement | undefined
  // The bar under the crafting book for what is being made by hand.
  let handGauge: HTMLElement | undefined
  let handFill: HTMLElement | undefined
  let handText: HTMLElement | undefined
  // The line at the foot of a machine's panel saying what it is doing.
  let statusLine: HTMLElement | undefined
  let miningNote: HTMLElement | undefined
  let guardNote: HTMLElement | undefined
  let machineButtons = new Map<string, HTMLButtonElement>()
  let gaugeBars: Array<{ fill: HTMLElement; text: HTMLElement }> = []
  let book: RecipeBook | undefined

  // A click on a button for the building that is open (if one still is), as its ID.
  const forBuilding =
    (act: (id: number) => void) =>
    (): void => {
      if (current?.building) act(current.building.id)
    }

  const take = (index: number, max: number): void => {
    const building = current?.building
    const slot = building?.slots[index]
    if (building && slot && !building.locked) handlers.take(building.id, slot.item, max)
  }
  // A click on one of the player's stacks: into the open building, if it takes items; with nothing open, a click on
  // armour puts it on (or, worn, takes it off), and any other stack moves between the hotbar and the rest: out of the
  // hotbar as high up the inventory as it goes, or into the hotbar if there is room.
  const put = (index: number, max: number): void => {
    const building = current?.building
    const slot = current?.player[index]
    if (building?.acceptsDeposits && slot) handlers.put(building.id, slot.item, max, index)
    else if (!building && slot && wear(index, slot)) return
    else if (!building && isFilled(slot)) quickMove(index, slot, max)
  }
  // Moves a stack from the hotbar to the inventory, or from the inventory to the hotbar, all of it (up to `max`) that
  // there is room for: onto the stacks of its kind with room (from the top), and the rest into the first empty slot.
  const quickMove = (index: number, slot: Slot, max: number): void => {
    const player = current?.player ?? []
    const toHotbar = index >= HOTBAR_SLOTS
    const first = toHotbar ? 0 : HOTBAR_SLOTS
    const last = toHotbar ? HOTBAR_SLOTS : AMMO_SLOT
    const limit = stackLimit(slot.item, STACK_SIZE)
    let left = Math.min(max, slot.count)
    for (let i = first; i < last && left > 0; i++) {
      const other = player[i]
      if (!other || other.count === 0 || other.item !== slot.item || other.count >= limit) continue
      const moved = Math.min(left, limit - other.count)
      handlers.slot({ id: 0, i: index }, { id: 0, i }, moved)
      left -= moved
    }
    for (let i = first; i < last && left > 0; i++) {
      if ((player[i]?.count ?? 0) !== 0) continue
      handlers.slot({ id: 0, i: index }, { id: 0, i }, left)
      left = 0
    }
  }
  // Puts on the armour in a slot (swapping out what was worn there), or takes off what is worn there into the first
  // empty slot. Gives whether it was armour.
  const wear = (index: number, slot: Slot): boolean => {
    const part = slot.count > 0 ? getItem(slot.item).armor?.slot : undefined
    if (!part) return false
    if (index >= ARMOR_SLOT) {
      const free = current?.player.findIndex((other, i) => i < AMMO_SLOT && other.count === 0) ?? -1
      if (free >= 0) handlers.slot({ id: 0, i: index }, { id: 0, i: free }, 1)
    } else handlers.slot({ id: 0, i: index }, { id: 0, i: ARMOR_SLOT + ARMOR_SLOTS.indexOf(part) }, 1)
    return true
  }

  // ---- dragging

  let drag: Drag | undefined
  // Set when a drag ends, so the click the browser sends after it does not move the stack as well.
  let justDragged = false

  const slotOf = (side: Side, index: number): Slot | undefined =>
    side === 'player' ? current?.player[index] : current?.building?.slots[index]
  const cellOf = (side: Side, index: number): Cell | undefined => {
    if (side === 'building') {
      const grid = buildingGrids.find((candidate) => index >= candidate.offset && index < candidate.offset + candidate.cells.length)
      return grid?.cells[index - grid.offset]
    }
    if (index === AMMO_SLOT) return ammoGrid?.cells[0]
    if (index === FOOD_SLOT) return foodGrid?.cells[0]
    if (index === TRASH_SLOT) return trashGrid?.cells[0]
    if (index >= ARMOR_SLOT) return armourGrid?.cells[index - ARMOR_SLOT]
    return index < HOTBAR_SLOTS ? hotbarGrid?.cells[index] : playerGrid?.cells[index - HOTBAR_SLOTS]
  }

  const press = (side: Side, index: number, event: PointerEvent): void => {
    if (side === 'building' && (!current?.building?.inReach || current.building.locked)) return
    justDragged = false
    drag = { side, index, startX: event.clientX, startY: event.clientY, half: event.button === 2 }
  }
  const wasDrag = (): boolean => {
    const was = justDragged
    justDragged = false
    return was
  }

  // A slot of either inventory as a command names it, if it can be moved from or to now (the building's, while it is
  // in reach and open).
  const slotRef = (of: Side, i: number): { id: number; i: number } | undefined => {
    if (of === 'player') return { id: 0, i }
    const building = current?.building
    return building && building.inReach && !building.locked ? { id: building.id, i } : undefined
  }

  // ---- the middle button (see Middle)

  let middle: Middle | undefined

  const middleDown = (side: Side, index: number, event: PointerEvent, moveOne: () => void, left: () => boolean): void => {
    if (side === 'building' && (!current?.building?.inReach || current.building.locked)) return
    endMiddle(false)
    const held: Middle = { side, index, startX: event.clientX, startY: event.clientY, moveOne, left, repeating: false, dragging: false, visited: new Set() }
    middle = held
    // Still held, and not dragged: one at a time, faster and faster, while there are any left.
    const step = (wait: number): void => {
      if (middle !== held || !held.left()) return
      held.moveOne()
      held.timer = setTimeout(() => step(Math.max(HOLD_FASTEST, wait * HOLD_SPEEDUP)), wait)
    }
    held.timer = setTimeout(() => {
      if (middle !== held || held.dragging) return
      held.repeating = true
      step(HOLD_FIRST)
    }, HOLD_DELAY)
  }

  // Let go (`click`: as a click, moving one if it was neither held long enough to repeat nor dragged), or given up.
  const endMiddle = (click: boolean): void => {
    const was = middle
    if (!was) return
    middle = undefined
    clearTimeout(was.timer)
    for (const cell of was.visited) cell.classList.remove('is-drop-target')
    cellOf(was.side, was.index)?.button.classList.remove('is-drag-source')
    if (click && !was.repeating && !was.dragging && was.left()) was.moveOne()
  }

  // Dragging with the middle button: one of the stack onto each slot passed over that is empty or holds its kind.
  const middleMove = (event: PointerEvent): void => {
    const held = middle
    if (!held || held.repeating) return
    if (!held.dragging) {
      if (Math.hypot(event.clientX - held.startX, event.clientY - held.startY) < DRAG_THRESHOLD) return
      held.dragging = true
      clearTimeout(held.timer)
      cellOf(held.side, held.index)?.button.classList.add('is-drag-source')
    }
    const over = slotAt(event.clientX, event.clientY)
    if (!over || held.visited.has(over)) return
    const toSide = over.dataset.side as Side
    const toIndex = Number(over.dataset.index)
    if (toSide === held.side && toIndex === held.index) return
    const source = slotOf(held.side, held.index)
    const target = slotOf(toSide, toIndex)
    if (!isFilled(source) || !target || (isFilled(target) && target.item !== source.item)) return
    const from = slotRef(held.side, held.index)
    const to = slotRef(toSide, toIndex)
    if (!from || !to) return
    held.visited.add(over)
    over.classList.add('is-drop-target')
    handlers.slot(from, to, 1)
  }

  const slotAt = (x: number, y: number): HTMLElement | undefined => {
    const found = document.elementFromPoint(x, y)?.closest<HTMLElement>('.slot')
    return found && root.contains(found) ? found : undefined
  }

  const onPointerMove = (event: PointerEvent): void => {
    middleMove(event)
    if (!drag) return
    if (!drag.ghost) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return
      const slot = slotOf(drag.side, drag.index)
      if (!isFilled(slot)) {
        drag = undefined
        return
      }
      const icon = pixelImage('slot-icon', iconUrl(slot.item))
      drag.ghost = element('div', 'drag-ghost', icon, element('span', 'slot-count', String(drag.half ? Math.ceil(slot.count / 2) : slot.count)))
      document.body.append(drag.ghost)
      cellOf(drag.side, drag.index)?.button.classList.add('is-drag-source')
    }
    drag.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`
    const over = slotAt(event.clientX, event.clientY)
    if (over !== drag.over) {
      drag.over?.classList.remove('is-drop-target')
      drag.over = over
      over?.classList.add('is-drop-target')
    }
  }

  const endDrag = (): void => {
    if (!drag) return
    drag.ghost?.remove()
    drag.over?.classList.remove('is-drop-target')
    cellOf(drag.side, drag.index)?.button.classList.remove('is-drag-source')
    drag = undefined
  }

  // Let go: onto a slot of either inventory (onto its kind as far as it fits, the rest staying where it came from; onto
  // another kind, swapping them), or off the panels altogether, dropping it on the ground there.
  const onPointerUp = (event: PointerEvent): void => {
    if (event.button === 1) endMiddle(true)
    if (!drag) return
    const { side, index, ghost, half } = drag
    const over = ghost ? slotAt(event.clientX, event.clientY) : undefined
    if (ghost) justDragged = true
    endDrag()
    const slot = slotOf(side, index)
    if (!ghost || !isFilled(slot)) return
    const count = half ? Math.ceil(slot.count / 2) : slot.count
    const from = slotRef(side, index)
    if (!from) return
    if (!over) {
      const under = document.elementFromPoint(event.clientX, event.clientY)
      if (!under || !root.contains(under)) handlers.drop(from, count, { x: event.clientX, y: event.clientY })
      return
    }
    const to = slotRef(over.dataset.side as Side, Number(over.dataset.index))
    if (to && (to.id !== from.id || to.i !== from.i)) handlers.slot(from, to, count)
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('blur', endDrag)
  const cancelMiddle = (): void => endMiddle(false)
  window.addEventListener('blur', cancelMiddle)

  // ---- making the panels

  const panel = (title: string, ...body: Node[]): HTMLElement =>
    element('section', 'panel', element('header', 'panel-header', element('h2', 'panel-title', title)), ...body)

  const inventoryPanel = (view: PanelsView): HTMLElement => {
    playerGrid = createGrid('player', HOTBAR_SLOTS, Math.max(0, Math.min(AMMO_SLOT, view.player.length) - HOTBAR_SLOTS), put, press, wasDrag, middleDown)
    // The special slots: each with a faint picture of what goes in it while it is empty, and a tip saying so.
    const marked = (grid: Grid, marks: readonly SlotMark[], tips: readonly string[]): HTMLElement => {
      grid.cells.forEach((cell, i) => {
        cell.button.classList.add('marked-slot')
        cell.button.append(slotMark(marks[i]))
      })
      const boxed = element('div', 'gear-box', grid.root)
      boxed.dataset.tip = tips.join(' · ')
      return boxed
    }
    ammoGrid = createGrid('player', AMMO_SLOT, view.player.length > AMMO_SLOT ? 1 : 0, put, press, wasDrag, middleDown)
    ammoGrid.root.classList.add('is-ammo')
    foodGrid = createGrid('player', FOOD_SLOT, view.player.length > FOOD_SLOT ? 1 : 0, put, press, wasDrag, middleDown)
    foodGrid.root.classList.add('is-ammo')
    // The trash: whatever is put there stays until something else is, and then it is gone for good.
    trashGrid = createGrid('player', TRASH_SLOT, view.player.length > TRASH_SLOT ? 1 : 0, put, press, wasDrag, middleDown)
    trashGrid.root.classList.add('is-ammo', 'is-trash')
    trashGrid.cells.forEach((cell) => {
      cell.button.classList.add('trash-slot')
      cell.button.append(element('span', 'trash-mark'))
    })
    const trashBox = element('div', 'gear-box', trashGrid.root)
    trashBox.dataset.tip = 'Trash: what is here is thrown away for good when something else is put here (or more of it than fits)'
    hotbarGrid = createGrid('player', 0, Math.min(HOTBAR_SLOTS, view.player.length), put, press, wasDrag, middleDown)
    hotbarGrid.root.classList.add('is-hotbar')
    // What the player wears: head, body and feet, each keeping them warmer and taking some damage off each hit.
    armourGrid = createGrid('player', ARMOR_SLOT, view.player.length > ARMOR_SLOT ? ARMOR_SLOTS.length : 0, put, press, wasDrag, middleDown)
    armourGrid.root.classList.add('armour-row')
    const armour = marked(armourGrid, ['head', 'body', 'feet'], ['Armour: head, body and feet'])
    return element(
      'section',
      'panel',
      element('header', 'panel-header', element('h2', 'panel-title', 'Inventory'), button('panel-close', '×', () => handlers.close())),
      element(
        'div',
        'gear-row',
        armour,
        element(
          'div',
          'gear-side',
          marked(ammoGrid, ['ammo'], ['Ammo: arrows for a bow, stones for a sling']),
          marked(foodGrid, ['food'], ['Food: F eats from here']),
          trashBox,
        ),
      ),
      playerGrid.root,
      element('h3', 'grid-label', 'Hotbar'),
      hotbarGrid.root,
    )
  }

  const takeAll = (): HTMLButtonElement => button('btn btn-small', 'Take all', forBuilding((id) => handlers.take(id, NO_ITEM, EVERYTHING)))

  // A machine: what goes in (each slot labelled), an arrow that fills as it works, what comes out; its gauges, a line
  // on what it is doing, and its buttons.
  const machinePanel = (building: BuildingPanelView, machine: MachineView): HTMLElement => {
    // What goes in: with a tool slot (a station), the tool slot on the left of the slots it works from; else a column
    // (a campfire's with its flame between what cooks and the fuel).
    const stationInputs = (): HTMLElement => {
      const tool = machine.inputs.find((slot) => slot.tool)
      if (!tool) {
        const boxes = machine.inputs.map((slot) => slotBox(slot.index, false))
        if (machine.flame !== undefined) {
          flameFill = element('div', 'station-flame-fill')
          boxes.splice(1, 0, element('div', 'station-flame', flameFill))
        }
        return element('div', 'station-inputs', ...boxes)
      }
      const rest = machine.inputs.filter((slot) => !slot.tool)
      return element(
        'div',
        'station-inputs station-inputs-tooled',
        slotBox(tool.index, false, true),
        element('div', rest.length === 4 ? 'station-input-square' : 'station-input-column', ...rest.map((slot) => slotBox(slot.index, false))),
      )
    }
    const slotBox = (index: number, output: boolean, tool = false): HTMLElement => {
      const grid = createGrid('building', index, 1, take, press, wasDrag, middleDown)
      buildingGrids.push(grid)
      const box = element('div', `station-slot${output ? ' station-slot-output' : ''}${tool ? ' station-slot-tool' : ''}`, grid.root)
      // Shown while it is empty (what is in it has its own tip).
      if (tool) box.dataset.tip = 'Tool: the tool a recipe needs goes here, and is not used up'
      return box
    }
    progressFill = element('div', 'progress-fill')
    const arrow = element('div', 'station-arrow', progressFill)
    const row = element(
      'div',
      'station-row',
      stationInputs(),
      arrow,
      element('div', 'station-outputs', ...machine.outputs.map((slot) => slotBox(slot.index, true))),
    )
    gaugeBars = machine.gauges.map((gauge) => ({ fill: element('div', `gauge-fill is-${gauge.tone}`), text: element('span', 'gauge-text') }))
    const gauges = element(
      'div',
      'gauges',
      ...machine.gauges.map((gauge, i) =>
        element('div', 'gauge', element('span', 'gauge-label', gauge.label), element('div', 'gauge-bar', gaugeBars[i].fill), gaugeBars[i].text),
      ),
    )
    machineButtons = new Map()
    const actions = element('div', 'panel-actions')
    for (const spec of machine.buttons) {
      const made = button(`btn btn-small${spec.primary ? ' btn-primary' : ''}`, spec.label, forBuilding((id) => handlers.press(id, spec.id)))
      machineButtons.set(spec.id, made)
      actions.append(made)
    }
    actions.append(takeAll())
    const body: Node[] = [row]
    if (machine.gauges.length > 0) body.push(gauges)
    statusLine = element('p', 'machine-status')
    statusLine.hidden = true
    body.push(actions, statusLine)
    return panel(building.title, ...body)
  }

  const build = (view: PanelsView): void => {
    const building = view.building
    progressFill = miningNote = guardNote = flameFill = statusLine = undefined
    machineButtons = new Map()
    gaugeBars = []
    buildingGrids = []
    book = undefined
    handGauge = undefined
    // Item spawning on: every item, at the left.
    const spawner = view.spawning ? [createItemSpawner((item, count) => handlers.give(item, count)).root] : []
    if (building?.machine) {
      const machine = building.machine
      const column = element('div', 'panel-column', machinePanel(building, machine), inventoryPanel(view))
      if (machine.recipes) {
        book = createRecipeBook(machine.recipes.title, machine.recipes.action, (recipe, times) => {
          if (current?.building) handlers.recipe(current.building.id, recipe, times)
        })
        root.replaceChildren(...spawner, column, book.root)
      } else root.replaceChildren(...spawner, column)
      return
    }
    const panels: HTMLElement[] = [...spawner]
    if (building) {
      const body: Node[] = []
      if (building.mining) {
        progressFill = element('div', 'progress-fill')
        miningNote = element('p', 'panel-note')
        body.push(miningNote, element('div', 'progress', progressFill))
      }
      guardNote = element('p', 'panel-note is-warning', 'The skeletons guard this chest: defeat them all to open it.')
      body.push(guardNote)
      const grid = createGrid('building', 0, building.slots.length, take, press, wasDrag, middleDown)
      buildingGrids.push(grid)
      body.push(grid.root)
      const actions = element('div', 'panel-actions', takeAll())
      if (building.acceptsDeposits) actions.append(button('btn btn-small', 'Store all', forBuilding((id) => handlers.put(id, NO_ITEM, EVERYTHING))))
      if (building.kind === 'chest') {
        actions.append(
          button('btn btn-small', 'Top up', forBuilding((id) => handlers.chest(id, 'stash'))),
          button('btn btn-small', 'Sort', forBuilding((id) => handlers.chest(id, 'sort'))),
        )
        // Its name: typed in, and kept when the box is left (or Enter is pressed).
        const name = element('input', 'field-input chest-name')
        name.placeholder = 'Name this chest'
        name.maxLength = CHEST_NAME_LENGTH
        name.value = building.name ?? ''
        const save = (): void => {
          if (current?.building && name.value.trim() !== (current.building.name ?? '')) handlers.rename(current.building.id, name.value)
        }
        name.addEventListener('change', save)
        name.addEventListener('keydown', (event) => {
          event.stopPropagation()
          if (event.key === 'Enter') name.blur()
        })
        body.unshift(name)
      }
      body.push(actions)
      panels.push(panel(building.name || building.title, ...body))
    }
    panels.push(inventoryPanel(view))
    if (!building && view.recipes && view.recipes.length > 0) {
      book = createRecipeBook('Crafting', 'Craft', (recipe, times) => handlers.craft(recipe, times))
      // What is being made by hand: a bar filling as it is made, and what it is.
      handFill = element('div', 'gauge-fill is-plain')
      handText = element('span', 'gauge-text')
      handGauge = element('div', 'gauge hand-craft', element('span', 'gauge-label', 'Making'), element('div', 'gauge-bar', handFill), handText)
      handGauge.hidden = true
      book.root.append(handGauge)
      panels.push(book.root)
    }
    root.replaceChildren(...panels)
  }

  return {
    hovered() {
      return current && hoveredCell && root.contains(cellOf(hoveredCell.side, hoveredCell.index)?.button ?? null) ? { ...hoveredCell } : undefined
    },
    show(view) {
      current = view
      root.hidden = !view
      if (!view) {
        endDrag()
        endMiddle(false)
        layout = ''
        return
      }
      const building = view.building
      const machine = building?.machine
      const machineKey = machine
        ? JSON.stringify([machine.inputs, machine.outputs, machine.gauges.map((gauge) => gauge.label), machine.buttons.map((spec) => spec.id), machine.recipes?.title])
        : ''
      const key = `${building?.id}|${building?.name}|${building?.kind}|${building?.slots.length}|${building?.acceptsDeposits}|${machineKey}|${view.player.length}|${!!view.recipes}|${!!view.spawning}`
      if (key !== layout) {
        layout = key
        endDrag()
        endMiddle(false)
        build(view)
      }
      const depositing = building?.acceptsDeposits === true && building.inReach && !building.locked
      fillGrid(playerGrid!, view.player, depositing, true)
      fillGrid(ammoGrid!, view.player, depositing, true)
      fillGrid(foodGrid!, view.player, depositing, true)
      fillGrid(trashGrid!, view.player, depositing || !building, true)
      fillGrid(armourGrid!, view.player, true, true)
      fillGrid(hotbarGrid!, view.player, depositing || !building, true)
      hotbarGrid!.cells.forEach((cell, index) => cell.button.classList.toggle('is-selected', index === view.selected))
      const usable = building !== undefined && building.inReach && !building.locked
      if (building) for (const grid of buildingGrids) fillGrid(grid, building.slots, usable, usable)
      if (guardNote) guardNote.hidden = building?.guarded !== true
      book?.update(machine?.recipes?.entries ?? view.recipes ?? [])
      if (handGauge && handFill && handText) {
        const crafting = building ? undefined : view.crafting
        handGauge.hidden = !crafting
        if (crafting) {
          const text = crafting.queued > 1 ? `${crafting.name} (${crafting.queued - 1} more)` : crafting.name
          if (handText.textContent !== text) handText.textContent = text
        }
      }
      if (machine) {
        for (const spec of machine.buttons) {
          const made = machineButtons.get(spec.id)
          const disabled = spec.disabled || !building!.inReach
          if (made && made.disabled !== disabled) made.disabled = disabled
          if (made && made.textContent !== spec.label) made.textContent = spec.label
        }
        if (statusLine) {
          statusLine.hidden = !machine.status
          if (statusLine.textContent !== (machine.status ?? '')) statusLine.textContent = machine.status ?? ''
        }
        if (flameFill) flameFill.style.setProperty('--burn', `${Math.min(1, Math.max(0, machine.flame ?? 0))}`)
        machine.gauges.forEach((gauge, i) => {
          const bar = gaugeBars[i]
          if (!bar) return
          bar.fill.style.transform = `scaleX(${Math.min(1, Math.max(0, gauge.fraction))})`
          if (bar.text.textContent !== gauge.text) bar.text.textContent = gauge.text
          // Its colour too (the water in a barrel turning to tannin, as it is watched).
          const tone = `gauge-fill is-${gauge.tone}`
          if (bar.fill.className !== tone) bar.fill.className = tone
        })
      }
      if (building?.mining && miningNote) {
        const text = `Digging ${getItem(building.mining.item).name}`
        if (miningNote.textContent !== text) miningNote.textContent = text
      }
    },
    setHandProgress(fraction) {
      if (handFill) handFill.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`
    },
    setProgress(fraction) {
      if (progressFill) progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`
    },
    dispose() {
      endDrag()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('blur', endDrag)
      window.removeEventListener('blur', cancelMiddle)
      endMiddle(false)
    },
  }
}
