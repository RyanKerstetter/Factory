import { getItem, type ItemId } from '../../../../packages/shared/src/index.ts'
import { artUrl } from '../render/art.ts'
import { itemArt } from '../render/art-catalog.ts'
import { itemTip } from './item-tip.ts'
import { button, element } from './dom.ts'

// One recipe in a book: what it makes, what it takes (and how much of each the player has), the tool it needs (for a
// work station's), how long it takes, and whether it can be made now.
export type BookEntry = {
  id: number
  category: string
  output: ItemId
  count: number
  inputs: ReadonlyArray<{ item: ItemId; need: number; have: number }>
  tool?: { name: string; have: boolean }
  seconds?: number
  ready: boolean
}

export type RecipeBook = { readonly root: HTMLElement; update(entries: readonly BookEntry[]): void }

// How many times a click on a Craft button asks for: one, five with Shift, all that can be made with Ctrl (or Cmd).
export function timesFor(event: MouseEvent): number {
  if (event.ctrlKey || event.metaKey) return Number.POSITIVE_INFINITY
  return event.shiftKey ? 5 : 1
}

export function itemIcon(item: ItemId, className = 'pixel slot-icon'): HTMLImageElement {
  const icon = element('img', className)
  icon.src = artUrl(itemArt(item))
  icon.alt = ''
  icon.draggable = false
  icon.dataset.tip = itemTip(item)
  return icon
}

// A panel of recipes: a list that scrolls, grouped by category, the ones that cannot be made now greyed out; and under
// it the one picked, with what it takes (green where the player has enough, red where not) and a button to make it (none
// if `actionLabel` is empty: a list to read). The button says how many to make: one, five with Shift, and as many as
// can be made with Ctrl (Infinity).
// The list is made again only when which recipes it shows changes, and otherwise brought up to date in place, so a
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
  const rows = new Map<number, HTMLButtonElement>()
  let current: readonly BookEntry[] = []

  const select = (id: number): void => {
    selected = id
    for (const [rowId, row] of rows) row.classList.toggle('is-selected', rowId === id)
    showDetail()
  }

  const showDetail = (): void => {
    const entry = current.find((candidate) => candidate.id === selected)
    detail.hidden = !entry
    if (!entry) return
    const key = JSON.stringify(entry)
    if (key === shownDetail) return
    shownDetail = key
    const output = getItem(entry.output)
    detailIcon.replaceChildren(itemIcon(entry.output, 'pixel recipe-detail-img'))
    detailName.textContent = entry.count > 1 ? `${output.name} × ${entry.count}` : output.name
    const needs: HTMLElement[] = []
    if (entry.tool) {
      needs.push(element('li', `recipe-need ${entry.tool.have ? 'is-enough' : 'is-short'}`, element('span', 'recipe-need-name', `Tool: ${entry.tool.name}`)))
    }
    for (const input of entry.inputs) {
      needs.push(
        element(
          'li',
          `recipe-need ${input.have >= input.need ? 'is-enough' : 'is-short'}`,
          itemIcon(input.item),
          element('span', 'recipe-need-name', getItem(input.item).name),
          element('span', 'recipe-need-count', `${input.have}/${input.need}`),
        ),
      )
    }
    detailNeeds.replaceChildren(...needs)
    detailNote.hidden = entry.seconds === undefined
    detailNote.textContent = entry.seconds !== undefined ? `Takes ${entry.seconds} s each` : ''
    action.disabled = !entry.ready
    action.hidden = actionLabel === ''
  }

  const buildList = (entries: readonly BookEntry[]): void => {
    rows.clear()
    const nodes: HTMLElement[] = []
    let category = ''
    for (const entry of entries) {
      if (entry.category !== category) {
        category = entry.category
        nodes.push(element('h3', 'recipe-category', category))
      }
      const output = getItem(entry.output)
      const row = button('recipe-row', '', () => select(entry.id))
      row.append(itemIcon(entry.output), element('span', 'recipe-row-name', entry.count > 1 ? `${output.name} × ${entry.count}` : output.name))
      rows.set(entry.id, row)
      nodes.push(row)
    }
    list.replaceChildren(...nodes)
  }

  return {
    root,
    update(entries) {
      current = entries
      const key = entries.map((entry) => `${entry.category}:${entry.id}`).join(',')
      if (key !== shownList) {
        shownList = key
        buildList(entries)
        if (selected === undefined || !entries.some((entry) => entry.id === selected)) selected = entries[0]?.id
        shownDetail = ''
      }
      for (const entry of entries) {
        const row = rows.get(entry.id)
        row?.classList.toggle('is-locked', !entry.ready)
        row?.classList.toggle('is-selected', entry.id === selected)
      }
      showDetail()
    },
  }
}
