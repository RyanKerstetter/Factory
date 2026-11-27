import { ITEMS, STACK_SIZE, stackLimit, type ItemCategory, type ItemId } from '../../../../packages/shared/src/index.ts'
import { element, pixelImage } from './dom.ts'
import { showIcon } from './icons.ts'
import { itemTip } from './item-tip.ts'

// Item spawning (for testing; the host turns it on in the settings): a panel beside the inventory with every item in the
// game, by kind, to take out of nothing (but what only flies: a projectile is never had). A click takes as many as the amount box says (1 to start with); with Shift, a
// whole stack. The search box narrows the list to the items whose names have what is typed in them.
export type ItemSpawner = { root: HTMLElement }

const MOST = 10_000
// The kinds in the order they are listed, and what each is called.
const KINDS: ReadonlyArray<[ItemCategory, string]> = [
  ['weapon', 'Weapons'],
  ['armor', 'Armour'],
  ['tool', 'Tools'],
  ['structure', 'Buildings'],
  ['food', 'Food'],
  ['plant', 'Plants'],
  ['animal', 'Animal'],
  ['mineral', 'Minerals'],
  ['material', 'Materials'],
]

export function createItemSpawner(give: (item: ItemId, count: number) => void): ItemSpawner {
  const search = element('input', 'field-input item-spawner-search')
  search.placeholder = 'Search items'
  const amount = element('input', 'field-input item-spawner-amount')
  amount.type = 'number'
  amount.min = '1'
  amount.max = String(MOST)
  amount.value = '1'
  amount.dataset.tip = 'How many a click takes (Shift + click: a whole stack)'
  // Typing here is not playing: the keys are kept from the game.
  for (const input of [search, amount]) input.addEventListener('keydown', (event) => event.stopPropagation())
  const list = element('div', 'recipe-list item-spawner-list')
  const tiles: Array<{ tile: HTMLButtonElement; name: string }> = []
  const groups: Array<{ heading: HTMLElement; grid: HTMLElement; items: number[] }> = []
  for (const [category, title] of KINDS) {
    const items = ITEMS.filter((item) => item.category === category)
    if (items.length === 0) continue
    const grid = element('div', 'recipe-grid')
    const heading = element('h3', 'recipe-category', title)
    const group = { heading, grid, items: [] as number[] }
    for (const item of items) {
      const icon = pixelImage('slot-icon')
      showIcon(icon, item.id)
      const tile = element('button', 'recipe-tile', icon)
      tile.type = 'button'
      tile.dataset.tip = itemTip(item.id)
      tile.addEventListener('click', (event) => {
        const typed = Math.floor(Number(amount.value))
        const count = event.shiftKey ? stackLimit(item.id, STACK_SIZE) : Math.max(1, Math.min(MOST, Number.isFinite(typed) ? typed : 1))
        give(item.id, count)
      })
      grid.append(tile)
      group.items.push(tiles.length)
      tiles.push({ tile, name: item.name.toLowerCase() })
    }
    groups.push(group)
    list.append(heading, grid)
  }
  search.addEventListener('input', () => {
    const wanted = search.value.trim().toLowerCase()
    for (const { tile, name } of tiles) tile.hidden = wanted !== '' && !name.includes(wanted)
    for (const group of groups) group.heading.hidden = group.grid.hidden = group.items.every((i) => tiles[i].tile.hidden)
  })
  const root = element(
    'section',
    'panel recipe-book item-spawner',
    element('header', 'panel-header', element('h2', 'panel-title', 'Spawn items')),
    element('div', 'item-spawner-controls', search, amount),
    list,
  )
  return { root }
}
