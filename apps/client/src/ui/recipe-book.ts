import { getItem, type ItemId } from '../../../../packages/shared/src/index.ts'
import type { LiquidTone } from '../liquids.ts'
import { iconUrl } from './icons.ts'
import { itemTip } from './item-tip.ts'
import { button, element, pixelImage } from './dom.ts'

// One recipe in a book: what it makes, what it takes (and how much of each the player has), the tool it needs (for a
// work station's), the heat it needs (and how hot it is now), how long it takes, and whether it can be made now.
// A liquid (water in a barrel, the tannin it makes) shows as itself, not as a bucket of it; an input that can be any
// item of a kind is named for the kind (`label`), its picture going through the items of it (see barrelBook).
export type BookLiquid = { name: string; tone: LiquidTone }
export type BookEntry = {
  id: number
  category: string
  output: ItemId
  outputLiquid?: BookLiquid
  count: number
  inputs: ReadonlyArray<{ item: ItemId; need: number; have: number; liquid?: BookLiquid; label?: string }>
  tool?: { name: string; have: boolean }
  heat?: { need: number; now?: number }
  // A barrel's recipe that wants no liquid in it at all, and whether there is none now.
  dry?: { ok: boolean }
  seconds?: number
  // How it goes, in place of "Takes … s each" (a barrel's: "All every 60 seconds", or "1 every 30 seconds").
  how?: string
  ready: boolean
}

export type RecipeBook = { readonly root: HTMLElement; update(entries: readonly BookEntry[]): void }

// How many times a click on a Craft button asks for: one, five with Shift, all that can be made with Ctrl (or Cmd).
export function timesFor(event: MouseEvent): number {
  if (event.ctrlKey || event.metaKey) return Number.POSITIVE_INFINITY
  return event.shiftKey ? 5 : 1
}

// Seconds to at most two decimals (1.33, not 1.3333333).
const roundSeconds = (seconds: number): number => Math.round(seconds * 100) / 100

// A liquid's name as a title ("Salt water").
const liquidName = (liquid: BookLiquid): string => liquid.name[0].toUpperCase() + liquid.name.slice(1)

// A liquid's picture: a drop of it.
export function liquidIcon(liquid: BookLiquid, className = 'slot-icon'): HTMLElement {
  const drop = element('span', `${className} liquid-drop is-${liquid.tone}`)
  drop.dataset.tip = liquidName(liquid)
  return drop
}

// "No liquid": a drop of water, struck through.
function noLiquidIcon(className = 'slot-icon'): HTMLElement {
  const drop = element('span', `${className} liquid-drop is-water no-liquid`)
  drop.dataset.tip = 'No liquid in the barrel'
  return drop
}

// An item's picture, with its tip.
export function itemIcon(item: ItemId, className = 'slot-icon'): HTMLImageElement {
  const icon = pixelImage(className, iconUrl(item))
  icon.dataset.tip = itemTip(item)
  return icon
}

// What a recipe makes, as its name (and how many), and its picture.
function nameOf(entry: BookEntry): string {
  const name = entry.outputLiquid ? liquidName(entry.outputLiquid) : getItem(entry.output).name
  return entry.count > 1 ? `${name} × ${entry.count}` : name
}
function outputIcon(entry: BookEntry, className?: string): HTMLElement {
  return entry.outputLiquid ? liquidIcon(entry.outputLiquid, className) : itemIcon(entry.output, className)
}

// The groups recipes are shown in, in this order (a recipe's `category`); any other group (a machine's own: cooking,
// a barrel's) comes after, in the order it first appears.
const GROUP_ORDER = ['Materials', 'Weapons', 'Armor', 'Ammo', 'Tools', 'Buildings', 'Food']
function grouped(entries: readonly BookEntry[]): BookEntry[] {
  const seen = [...new Set(entries.map((entry) => entry.category))]
  const rank = (category: string): number => {
    const known = GROUP_ORDER.indexOf(category)
    return known >= 0 ? known : GROUP_ORDER.length + seen.indexOf(category)
  }
  return [...entries].sort((a, b) => rank(a.category) - rank(b.category))
}

// A panel of recipes: a grid of their pictures that scrolls, under a short heading for each group, the ones that cannot
// be made now greyed out (hover one for its name); and under it the one picked, with its name and what it takes (green
// where the player has enough, red where not) and a button to make it (none if `actionLabel` is empty: a list to read).
// The button says how many to make: one, five with Shift, and as many as can be made with Ctrl (Infinity).
// The grid is made again only when which recipes it shows changes, and otherwise brought up to date in place, so a
// click is never lost to it being made again under the mouse.
export function createRecipeBook(title: string, actionLabel: string, onAction: (id: number, times: number) => void): RecipeBook {
  const list = element('div', 'recipe-list')
  const detailIcon = element('div', 'recipe-detail-icon')
  const detailName = element('h3', 'recipe-detail-name')
  const detailNeeds = element('ul', 'recipe-needs')
  const detailNote = element('p', 'panel-hint')
  const action = button('btn btn-small btn-primary recipe-action', actionLabel, (event) => {
    if (selected !== undefined) onAction(selected, timesFor(event))
  })
  action.dataset.tip = 'Click: one more · Shift: five more · Ctrl: all you can'
  const detail = element('div', 'recipe-detail', element('div', 'recipe-detail-head', detailIcon, detailName), detailNeeds, detailNote, action)
  const root = element('section', 'panel recipe-book', element('header', 'panel-header', element('h2', 'panel-title', title)), list, detail)

  let shownList = ''
  let shownDetail = ''
  let selected: number | undefined
  const tiles = new Map<number, HTMLButtonElement>()
  let current: readonly BookEntry[] = []

  const select = (id: number): void => {
    selected = id
    for (const [tileId, tile] of tiles) tile.classList.toggle('is-selected', tileId === id)
    showDetail()
  }

  const showDetail = (): void => {
    const entry = current.find((candidate) => candidate.id === selected)
    detail.hidden = !entry
    if (!entry) return
    const key = JSON.stringify(entry)
    if (key === shownDetail) return
    shownDetail = key
    detailIcon.replaceChildren(outputIcon(entry, 'recipe-detail-img'))
    detailName.textContent = nameOf(entry)
    const needs: HTMLElement[] = []
    if (entry.tool) {
      needs.push(element('li', `recipe-need ${entry.tool.have ? 'is-enough' : 'is-short'}`, element('span', 'recipe-need-name', `Tool: ${entry.tool.name}`)))
    }
    for (const input of entry.inputs) {
      const name = input.label ?? (input.liquid ? liquidName(input.liquid) : getItem(input.item).name)
      needs.push(
        element(
          'li',
          `recipe-need ${input.have >= input.need ? 'is-enough' : 'is-short'}`,
          input.liquid ? liquidIcon(input.liquid) : itemIcon(input.item),
          element('span', 'recipe-need-name', name),
          element('span', 'recipe-need-count', `${input.have}/${input.need}`),
        ),
      )
    }
    // The heat it needs: how hot it must be, and how hot it is.
    if (entry.heat) {
      const enough = entry.heat.now === undefined || entry.heat.now >= entry.heat.need
      needs.push(
        element(
          'li',
          `recipe-need ${enough ? 'is-enough' : 'is-short'}`,
          element('span', 'slot-icon heat-icon'),
          element('span', 'recipe-need-name', 'Heat'),
          element('span', 'recipe-need-count', entry.heat.now === undefined ? `${entry.heat.need}°` : `${entry.heat.now}/${entry.heat.need}°`),
        ),
      )
    }
    // No liquid at all: a drop struck through.
    if (entry.dry) {
      needs.push(element('li', `recipe-need ${entry.dry.ok ? 'is-enough' : 'is-short'}`, noLiquidIcon(), element('span', 'recipe-need-name', 'No liquid')))
    }
    detailNeeds.replaceChildren(...needs)
    const note = entry.how ?? (entry.seconds !== undefined ? `Takes ${roundSeconds(entry.seconds)} s each` : '')
    detailNote.hidden = note === ''
    detailNote.textContent = note
    action.disabled = !entry.ready
    action.hidden = actionLabel === ''
  }

  const buildList = (entries: readonly BookEntry[]): void => {
    tiles.clear()
    const nodes: HTMLElement[] = []
    let category = ''
    let grid: HTMLElement | undefined
    for (const entry of entries) {
      if (entry.category !== category || !grid) {
        category = entry.category
        grid = element('div', 'recipe-grid')
        nodes.push(element('h3', 'recipe-category', category), grid)
      }
      const tile = button('recipe-tile', '', () => select(entry.id))
      tile.append(outputIcon(entry))
      tile.dataset.tip = nameOf(entry)
      if (entry.count > 1) tile.append(element('span', 'recipe-tile-count', `${entry.count}`))
      if (entry.heat) tile.append(element('span', 'recipe-tile-heat', `${entry.heat.need}°`))
      tiles.set(entry.id, tile)
      grid.append(tile)
    }
    list.replaceChildren(...nodes)
  }

  return {
    root,
    update(unsorted) {
      const entries = grouped(unsorted)
      current = entries
      const key = entries.map((entry) => `${entry.category}:${entry.id}`).join(',')
      if (key !== shownList) {
        shownList = key
        buildList(entries)
        if (selected === undefined || !entries.some((entry) => entry.id === selected)) selected = entries[0]?.id
        shownDetail = ''
      }
      for (const entry of entries) {
        const tile = tiles.get(entry.id)
        tile?.classList.toggle('is-locked', !entry.ready)
        tile?.classList.toggle('is-selected', entry.id === selected)
      }
      showDetail()
    },
  }
}
