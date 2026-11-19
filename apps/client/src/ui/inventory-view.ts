import { AMMO_SLOT, getItem, HOTBAR_SLOTS, NO_ITEM, type BuildingKind, type ItemId, type Slot } from '../../../../packages/shared/src/index.ts'
import { artUrl } from '../render/art.ts'
import { itemArt } from '../render/art-catalog.ts'
import { button, element } from './dom.ts'
import { createRecipeBook, type BookEntry, type RecipeBook } from './recipe-book.ts'

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
  // Nothing can be taken out or put in (a sealed barrel).
  locked?: boolean
}

// A machine's panel: its slots (what goes in on the left, what comes out on the right, an arrow that fills as it works
// between them), gauges (heat, liquid), its buttons, and the recipes it can make, at the side (`action` is the label of
// the button under the one picked, or '' for none).
export type MachineView = {
  inputs: ReadonlyArray<{ index: number; label: string }>
  outputs: ReadonlyArray<{ index: number; label: string }>
  gauges: ReadonlyArray<{ label: string; fraction: number; text: string; tone: 'heat' | 'water' | 'tannin' | 'milk' | 'plain' }>
  buttons: ReadonlyArray<{ id: string; label: string; disabled: boolean; primary?: boolean }>
  recipes?: { title: string; action: string; entries: readonly BookEntry[] }
}

// The player's whole inventory (its first HOTBAR_SLOTS slots are the hotbar, shown as a row of their own), which
// hotbar slot is picked, and the building that is open, if any; with no building open, the recipes to craft.
export type PanelsView = { player: readonly Slot[]; selected: number; building?: BuildingPanelView; recipes?: readonly BookEntry[] }

export type PanelHandlers = {
  take: (id: number, item: ItemId, max: number) => void
  put: (id: number, item: ItemId, max: number) => void
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
  close: () => void
}

export type InventoryPanels = {
  show(view: PanelsView | undefined): void
  // How far the open miner or station is through its next item, 0 to 1. Called every frame, not only when `show` is,
  // so the bar fills smoothly.
  setProgress(fraction: number): void
  dispose(): void
}

const EVERYTHING = 100_000

// How far the mouse has to move with the button down before a click becomes a drag, in pixels.
const DRAG_THRESHOLD = 5

type Side = 'player' | 'building'
type Cell = { button: HTMLButtonElement; icon: HTMLImageElement; count: HTMLSpanElement; shown: string }
// A grid shows `cells.length` slots of an inventory from slot `offset` on; `slots` is the whole inventory.
type Grid = { side: Side; offset: number; root: HTMLElement; cells: Cell[]; slots: readonly Slot[] }

// Dragging a stack: the slot it came from and where the mouse went down, whether it carries half the stack (Ctrl), and,
// once it has moved far enough to be a drag, the picture of the stack that follows the mouse and the slot it is over.
type Drag = { side: Side; index: number; startX: number; startY: number; half: boolean; ghost?: HTMLElement; over?: HTMLElement }

// A grid of slots, made once and filled in place each time what is in it changes, so a click is never lost to the
// grid being made again under the mouse while items arrive. Its cells are slots `offset` to `offset + size - 1`, and
// every index handed on is the slot's index in the whole inventory. `onMove` is given that and how many to move;
// `onPress` is told when the left button goes down on a stack, which may become a drag, and `wasDrag` says whether
// the click that follows ends one (and should do nothing more).
function createGrid(
  side: Side,
  offset: number,
  size: number,
  onMove: (index: number, max: number) => void,
  onPress: (side: Side, index: number, event: PointerEvent) => void,
  wasDrag: () => boolean,
): Grid {
  const grid: Grid = { side, offset, root: element('div', 'slot-grid'), cells: [], slots: [] }
  for (let index = offset; index < offset + size; index++) {
    const icon = element('img', 'pixel slot-icon')
    icon.draggable = false
    icon.alt = ''
    const count = element('span', 'slot-count')
    const cell = element('button', 'slot', icon, count)
    cell.type = 'button'
    cell.dataset.side = side
    cell.dataset.index = String(index)
    cell.addEventListener('pointerdown', (event) => {
      if (event.button === 0 && (grid.slots[index]?.count ?? 0) > 0) onPress(side, index, event)
    })
    cell.addEventListener('click', (event) => {
      if (wasDrag()) return
      const slot = grid.slots[index]
      if (slot && slot.count > 0) onMove(index, event.shiftKey ? EVERYTHING : slot.count)
    })
    // A right click moves one, but only one that started on the panels: the right click that opened a chest is let go
    // over the panel it opened, and must not move anything.
    cell.addEventListener('pointerdown', (event) => {
      if (event.button === 2) rightDownOn = cell
    })
    cell.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      const started = rightDownOn === cell
      rightDownOn = undefined
      if (started && (grid.slots[index]?.count ?? 0) > 0) onMove(index, 1)
    })
    // Nothing has been shown yet, so the first fill sets every cell, empty or not.
    grid.cells.push({ button: cell, icon, count, shown: 'unset' })
    grid.root.append(cell)
  }
  return grid
}

// The slot the right mouse button last went down on (see the right click in `createGrid`).
let rightDownOn: HTMLElement | undefined

// `movable`: a click moves the stack across. `draggable`: it can be dragged.
function fillGrid(grid: Grid, slots: readonly Slot[], movable: boolean, draggable: boolean): void {
  grid.slots = slots
  grid.cells.forEach((cell, at) => {
    const slot = slots[grid.offset + at]
    const filled = slot !== undefined && slot.count > 0 && slot.item !== NO_ITEM
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
      const url = artUrl(itemArt(slot.item))
      if (cell.icon.src !== url) cell.icon.src = url
      cell.button.dataset.tip = getItem(slot.item).name
    } else delete cell.button.dataset.tip
  })
}

// The player's inventory, and with it the building that is open: a chest or miner beside it; a work station above it,
// with the station's recipes at the side; or, with nothing open, the crafting book beside it. Clicking a slot moves its
// stack across (into the player's inventory from the building, or into the building from the player's, if it takes
// items); a right click moves one; holding Shift moves every one of that kind. A stack can also be dragged: to another
// slot of either inventory (onto a stack of its kind as far as it fits, or swapping places), half of it with Ctrl held,
// or off the panels to drop it on the ground.
export function createInventoryPanels(container: HTMLElement, handlers: PanelHandlers): InventoryPanels {
  const root = element('div', 'panels')
  root.hidden = true
  container.append(root)

  let current: PanelsView | undefined
  let layout = ''
  let playerGrid: Grid | undefined
  let hotbarGrid: Grid | undefined
  let ammoGrid: Grid | undefined
  let buildingGrids: Grid[] = []
  let progressFill: HTMLElement | undefined
  let miningNote: HTMLElement | undefined
  let reachNote: HTMLElement | undefined
  let machineButtons = new Map<string, HTMLButtonElement>()
  let gaugeBars: Array<{ fill: HTMLElement; text: HTMLElement }> = []
  let book: RecipeBook | undefined

  const take = (index: number, max: number): void => {
    const building = current?.building
    const slot = building?.slots[index]
    if (building && slot && !building.locked) handlers.take(building.id, slot.item, max)
  }
  // A click on one of the player's stacks: into the open building, if it takes items; with nothing open, a click in
  // the hotbar row picks that slot.
  const put = (index: number, max: number): void => {
    const building = current?.building
    const slot = current?.player[index]
    if (building?.acceptsDeposits && slot) handlers.put(building.id, slot.item, max)
    else if (!building && index < HOTBAR_SLOTS) handlers.select(index)
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
    return index < HOTBAR_SLOTS ? hotbarGrid?.cells[index] : playerGrid?.cells[index - HOTBAR_SLOTS]
  }

  const press = (side: Side, index: number, event: PointerEvent): void => {
    if (side === 'building' && (!current?.building?.inReach || current.building.locked)) return
    justDragged = false
    drag = { side, index, startX: event.clientX, startY: event.clientY, half: event.ctrlKey || event.metaKey }
  }
  const wasDrag = (): boolean => {
    const was = justDragged
    justDragged = false
    return was
  }

  const slotAt = (x: number, y: number): HTMLElement | undefined => {
    const found = document.elementFromPoint(x, y)?.closest<HTMLElement>('.slot')
    return found && root.contains(found) ? found : undefined
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag) return
    if (!drag.ghost) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return
      const slot = slotOf(drag.side, drag.index)
      if (!slot || slot.count === 0) {
        drag = undefined
        return
      }
      const icon = element('img', 'pixel slot-icon')
      icon.src = artUrl(itemArt(slot.item))
      icon.alt = ''
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
    if (!drag) return
    const { side, index, ghost, half } = drag
    const over = ghost ? slotAt(event.clientX, event.clientY) : undefined
    if (ghost) justDragged = true
    endDrag()
    const slot = slotOf(side, index)
    const building = current?.building
    if (!ghost || !slot || slot.count === 0) return
    const count = half ? Math.ceil(slot.count / 2) : slot.count
    const ref = (of: Side, i: number): { id: number; i: number } | undefined => {
      if (of === 'player') return { id: 0, i }
      return building && building.inReach && !building.locked ? { id: building.id, i } : undefined
    }
    const from = ref(side, index)
    if (!from) return
    if (!over) {
      const under = document.elementFromPoint(event.clientX, event.clientY)
      if (!under || !root.contains(under)) handlers.drop(from, count, { x: event.clientX, y: event.clientY })
      return
    }
    const to = ref(over.dataset.side as Side, Number(over.dataset.index))
    if (to && (to.id !== from.id || to.i !== from.i)) handlers.slot(from, to, count)
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('blur', endDrag)

  // ---- making the panels

  const panel = (title: string, ...body: Node[]): HTMLElement =>
    element('section', 'panel', element('header', 'panel-header', element('h2', 'panel-title', title)), ...body)

  const inventoryPanel = (view: PanelsView): HTMLElement => {
    playerGrid = createGrid('player', HOTBAR_SLOTS, Math.max(0, Math.min(AMMO_SLOT, view.player.length) - HOTBAR_SLOTS), put, press, wasDrag)
    ammoGrid = createGrid('player', AMMO_SLOT, view.player.length > AMMO_SLOT ? 1 : 0, put, press, wasDrag)
    ammoGrid.root.classList.add('is-ammo')
    hotbarGrid = createGrid('player', 0, Math.min(HOTBAR_SLOTS, view.player.length), put, press, wasDrag)
    hotbarGrid.root.classList.add('is-hotbar')
    // Where armour will go: not worn yet (it will take a flat amount off each hit).
    const armour = element(
      'div',
      'armour-row',
      ...['Helmet', 'Chest', 'Boots'].map((label) => {
        const box = element('div', 'slot armour-slot', element('span', 'armour-label', label))
        box.dataset.tip = `${label} armour (coming later)`
        return box
      }),
    )
    return element(
      'section',
      'panel',
      element('header', 'panel-header', element('h2', 'panel-title', 'Inventory'), button('panel-close', '×', () => handlers.close())),
      element('div', 'gear-row', element('div', '', element('h3', 'grid-label', 'Armour (coming later)'), armour), element('div', '', element('h3', 'grid-label', 'Ammo'), ammoGrid.root)),
      playerGrid.root,
      element('h3', 'grid-label', 'Hotbar'),
      hotbarGrid.root,
    )
  }

  const takeAll = (): HTMLButtonElement =>
    button('btn btn-small', 'Take all', () => {
      if (current?.building) handlers.take(current.building.id, NO_ITEM, EVERYTHING)
    })

  // A machine: what goes in (each slot labelled), an arrow that fills as it works, what comes out; its gauges, a line
  // on what it is doing, and its buttons.
  const machinePanel = (building: BuildingPanelView, machine: MachineView): HTMLElement => {
    const slotBox = (label: string, index: number, output: boolean): HTMLElement => {
      const grid = createGrid('building', index, 1, take, press, wasDrag)
      buildingGrids.push(grid)
      return element('div', `station-slot${output ? ' station-slot-output' : ''}`, element('span', 'station-label', label), grid.root)
    }
    progressFill = element('div', 'progress-fill')
    const arrow = element('div', 'station-arrow', element('span', 'station-arrow-head', '→'), element('div', 'progress', progressFill))
    const row = element(
      'div',
      'station-row',
      element('div', 'station-inputs', ...machine.inputs.map((slot) => slotBox(slot.label, slot.index, false))),
      arrow,
      element('div', 'station-outputs', ...machine.outputs.map((slot) => slotBox(slot.label, slot.index, true))),
    )
    gaugeBars = machine.gauges.map((gauge) => ({ fill: element('div', `gauge-fill is-${gauge.tone}`), text: element('span', 'gauge-text') }))
    const gauges = element(
      'div',
      'gauges',
      ...machine.gauges.map((gauge, i) =>
        element('div', 'gauge', element('span', 'gauge-label', gauge.label), element('div', 'gauge-bar', gaugeBars[i].fill), gaugeBars[i].text),
      ),
    )
    reachNote = element('p', 'panel-note is-warning', 'Too far away to use it.')
    machineButtons = new Map()
    const actions = element('div', 'panel-actions')
    for (const spec of machine.buttons) {
      const made = button(`btn btn-small${spec.primary ? ' btn-primary' : ''}`, spec.label, () => {
        if (current?.building) handlers.press(current.building.id, spec.id)
      })
      machineButtons.set(spec.id, made)
      actions.append(made)
    }
    actions.append(takeAll())
    const body: Node[] = [reachNote, row]
    if (machine.gauges.length > 0) body.push(gauges)
    body.push(actions)
    return panel(building.title, ...body)
  }

  const build = (view: PanelsView): void => {
    const building = view.building
    progressFill = miningNote = reachNote = undefined
    machineButtons = new Map()
    gaugeBars = []
    buildingGrids = []
    book = undefined
    if (building?.machine) {
      const machine = building.machine
      const column = element('div', 'panel-column', machinePanel(building, machine), inventoryPanel(view))
      if (machine.recipes) {
        book = createRecipeBook(machine.recipes.title, machine.recipes.action, (recipe, times) => {
          if (current?.building) handlers.recipe(current.building.id, recipe, times)
        })
        root.replaceChildren(book.root, column)
      } else root.replaceChildren(column)
      return
    }
    const panels: HTMLElement[] = []
    if (building) {
      const body: Node[] = []
      if (building.mining) {
        progressFill = element('div', 'progress-fill')
        miningNote = element('p', 'panel-note')
        body.push(miningNote, element('div', 'progress', progressFill))
      }
      reachNote = element('p', 'panel-note is-warning', 'Too far away to take or store items.')
      const grid = createGrid('building', 0, building.slots.length, take, press, wasDrag)
      buildingGrids.push(grid)
      body.push(reachNote, grid.root)
      const actions = element('div', 'panel-actions', takeAll())
      if (building.acceptsDeposits) {
        actions.append(
          button('btn btn-small', 'Store all', () => {
            if (current?.building) handlers.put(current.building.id, NO_ITEM, EVERYTHING)
          }),
        )
      }
      body.push(actions)
      panels.push(panel(building.title, ...body))
    }
    panels.push(inventoryPanel(view))
    if (!building && view.recipes && view.recipes.length > 0) {
      book = createRecipeBook('Crafting', 'Craft', (recipe, times) => handlers.craft(recipe, times))
      panels.push(book.root)
    }
    root.replaceChildren(...panels)
  }

  return {
    show(view) {
      current = view
      root.hidden = !view
      if (!view) {
        endDrag()
        layout = ''
        return
      }
      const building = view.building
      const machine = building?.machine
      const machineKey = machine
        ? JSON.stringify([machine.inputs, machine.outputs, machine.gauges.map((gauge) => gauge.label), machine.buttons.map((spec) => spec.id), machine.recipes?.title])
        : ''
      const key = `${building?.id}|${building?.kind}|${building?.slots.length}|${building?.acceptsDeposits}|${machineKey}|${view.player.length}|${!!view.recipes}`
      if (key !== layout) {
        layout = key
        endDrag()
        build(view)
      }
      const depositing = building?.acceptsDeposits === true && building.inReach && !building.locked
      fillGrid(playerGrid!, view.player, depositing, true)
      fillGrid(ammoGrid!, view.player, depositing, true)
      fillGrid(hotbarGrid!, view.player, depositing || !building, true)
      hotbarGrid!.cells.forEach((cell, index) => cell.button.classList.toggle('is-selected', index === view.selected))
      const usable = building !== undefined && building.inReach && !building.locked
      if (building) for (const grid of buildingGrids) fillGrid(grid, building.slots, usable, usable)
      if (reachNote) reachNote.hidden = building?.inReach !== false
      book?.update(machine?.recipes?.entries ?? view.recipes ?? [])
      if (machine) {
        for (const spec of machine.buttons) {
          const made = machineButtons.get(spec.id)
          const disabled = spec.disabled || !building!.inReach
          if (made && made.disabled !== disabled) made.disabled = disabled
          if (made && made.textContent !== spec.label) made.textContent = spec.label
        }
        machine.gauges.forEach((gauge, i) => {
          const bar = gaugeBars[i]
          if (!bar) return
          bar.fill.style.transform = `scaleX(${Math.min(1, Math.max(0, gauge.fraction))})`
          if (bar.text.textContent !== gauge.text) bar.text.textContent = gauge.text
        })
      }
      if (building?.mining && miningNote) {
        const text = `Digging ${getItem(building.mining.item).name}`
        if (miningNote.textContent !== text) miningNote.textContent = text
      }
    },
    setProgress(fraction) {
      if (progressFill) progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`
    },
    dispose() {
      endDrag()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('blur', endDrag)
    },
  }
}
