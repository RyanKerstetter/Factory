import {
  DEFAULT_WORLD_SIZE,
  GAME_TITLE,
  WORLD_SIZE_KEYS,
  WORLD_SIZES,
  type GameInfo,
  type SavedWorldInfo,
  type TerrainSettings,
  type WorldSize,
} from '../../../../packages/shared/src/index.ts'
import { button, element } from './dom.ts'

export type MenuTab = 'create' | 'load' | 'join'

export type MenuHandlers = {
  // A new world on the server, by name (and seed: empty for a random one), of a size and coastline.
  onCreate: (name: string, worldName: string, seed: string, terrain: TerrainSettings) => void
  // Start a saved world running, and play in it.
  onLoad: (name: string, code: string) => void
  // Join a running world.
  onJoin: (name: string, code: string) => void
  // Download a world as a file; add a world from a file to the saved worlds.
  onExport: (code: string) => void
  // Delete a saved world for good (after asking).
  onDelete: (code: string, name: string) => void
  onImport: (file: File) => void
  // Singleplayer: a world run in this browser (not saved yet).
  onSingleplayer: (name: string, seed: string, terrain: TerrainSettings) => void
  // The lists for the Load and Join tabs, fetched each time a tab is shown.
  listSaved: () => Promise<SavedWorldInfo[] | string>
  listRunning: () => Promise<GameInfo[] | string>
}

export type MenuView = {
  setBusy(busy: boolean): void
  setMessage(text: string, isError?: boolean): void
  show(tab: MenuTab): void
}

// The main menu: the player's name, and three tabs. Create game: a new world, by name, on the server (or one run in
// this browser). Load game: the saved worlds that are not running, to start again (or export, or import one from a
// file). Join game: the worlds running now, by name and who is in them, or one by its code.
export function createMenuView(
  container: HTMLElement,
  initial: { name: string; code: string; message?: string; isError?: boolean },
  handlers: MenuHandlers,
): MenuView {
  const input = (id: string, placeholder: string, maxLength: number): HTMLInputElement => {
    const made = element('input', 'field-input')
    made.id = id
    made.maxLength = maxLength
    made.placeholder = placeholder
    made.autocomplete = 'off'
    return made
  }
  const label = (text: string, target: HTMLElement): HTMLLabelElement => {
    const made = element('label', 'field-label', text)
    made.htmlFor = target.id
    return made
  }
  const onEnter = (field: HTMLInputElement, target: HTMLButtonElement): void =>
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') target.click()
    })

  const nameInput = input('menu-name', 'Cave dweller', 24)
  nameInput.setAttribute('autocomplete', 'nickname')
  nameInput.value = initial.name
  const playerName = (): string => nameInput.value

  // ---- create
  const worldInput = input('menu-world', 'My world', 40)
  const seedInput = input('menu-seed', 'Random', 40)
  // How the land is laid out (both for a hosted world and an offline one): the size preset and how ragged the coasts are.
  const sizeSelect = element('select', 'field-input')
  sizeSelect.id = 'menu-size'
  for (const size of WORLD_SIZE_KEYS) {
    const option = element('option', '', WORLD_SIZES[size].label)
    option.value = size
    sizeSelect.append(option)
  }
  sizeSelect.value = DEFAULT_WORLD_SIZE
  const terrain = (): TerrainSettings => ({ radius: WORLD_SIZES[sizeSelect.value as WorldSize].radius })
  const sizeLabel = label('World size', sizeSelect)
  const createButton = button('btn btn-primary', 'Create game', () => handlers.onCreate(playerName(), worldInput.value, seedInput.value, terrain()))
  onEnter(worldInput, createButton)
  onEnter(seedInput, createButton)
  const soloSeedInput = input('menu-solo-seed', 'Random', 40)
  const soloButton = button('btn', 'Play offline', () => handlers.onSingleplayer(playerName(), soloSeedInput.value, terrain()))
  onEnter(soloSeedInput, soloButton)
  const createPane = element(
    'div',
    'menu-pane',
    label('World name', worldInput),
    worldInput,
    element('div', 'field-row terrain-row', element('div', 'field-stack', sizeLabel, sizeSelect)),
    label('World seed', seedInput),
    element('div', 'field-row', seedInput, createButton),
    element('p', 'menu-note', 'The world is kept on the server, saved every minute: load it again any time from Load game.'),
    element('h3', 'menu-subtitle', 'Or play offline'),
    element('p', 'menu-note', 'A world run in this browser, on this computer: no server, nobody else can join, and not saved yet.'),
    label('World seed', soloSeedInput),
    element('div', 'field-row', soloSeedInput, soloButton),
  )

  // ---- load
  const savedList = element('div', 'world-list')
  const fileInput = element('input', '')
  fileInput.type = 'file'
  fileInput.accept = '.gz,.json,application/gzip,application/json'
  fileInput.hidden = true
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) handlers.onImport(file)
    fileInput.value = ''
  })
  const importButton = button('btn', 'Import from file…', () => fileInput.click())
  const loadPane = element(
    'div',
    'menu-pane',
    element('p', 'menu-note', 'Saved worlds that are not running. Loading one starts it again where it was left; you come back where you were, with what you had, by your name.'),
    savedList,
    element('div', 'field-row', importButton, button('btn', 'Refresh', () => void refresh('load')), fileInput),
  )

  // ---- join
  const runningList = element('div', 'world-list')
  const codeInput = input('menu-code', 'ABC123', 6)
  codeInput.classList.add('code-input')
  codeInput.value = initial.code
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  })
  const joinButton = button('btn', 'Join', () => handlers.onJoin(playerName(), codeInput.value))
  onEnter(codeInput, joinButton)
  const joinPane = element(
    'div',
    'menu-pane',
    element('p', 'menu-note', 'Worlds running now.'),
    runningList,
    element('div', 'field-row', button('btn', 'Refresh', () => void refresh('join'))),
    label('Or join by its code', codeInput),
    element('div', 'field-row', codeInput, joinButton),
  )

  // ---- the lists
  const date = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const row = (title: string, details: string, ...actions: HTMLButtonElement[]): HTMLElement =>
    element('div', 'world-row', element('div', 'world-text', element('span', 'world-name', title), element('span', 'world-details', details)), ...actions)
  const empty = (text: string): HTMLElement => element('p', 'menu-note world-empty', text)

  // A list of worlds asked of the server: "Looking…" while it is, then a row for each (or why there are none). How many
  // times each list has been asked for is kept, so an answer that comes after a newer ask is not shown over it.
  const asks = new Map<HTMLElement, number>()
  const fillList = async <T>(list: HTMLElement, ask: () => Promise<T[] | string>, none: string, toRow: (world: T) => HTMLElement): Promise<void> => {
    const asked = (asks.get(list) ?? 0) + 1
    asks.set(list, asked)
    list.replaceChildren(empty('Looking…'))
    const found = await ask()
    if (asks.get(list) !== asked) return
    if (typeof found === 'string') list.replaceChildren(empty(found))
    else list.replaceChildren(...(found.length === 0 ? [empty(none)] : found.map(toRow)))
  }
  const refresh = async (tab: MenuTab): Promise<void> => {
    if (tab === 'load') {
      await fillList(savedList, handlers.listSaved, 'No saved worlds that are not running. Create one, or import one from a file.', (world) =>
        row(
          world.name,
          `Saved ${date(world.savedAt)}${world.players.length ? ` · ${world.players.join(', ')}` : ''}`,
          button('btn btn-small btn-primary', 'Load', () => handlers.onLoad(playerName(), world.code)),
          button('btn btn-small', 'Export', () => handlers.onExport(world.code)),
          button('btn btn-small btn-danger', 'Delete', () => handlers.onDelete(world.code, world.name)),
        ),
      )
    } else if (tab === 'join') {
      await fillList(runningList, handlers.listRunning, 'Nobody is playing right now. Create a world, or load one.', (world) =>
        row(
          world.name,
          `${world.code} · ${world.players === 0 ? 'nobody in it' : world.playerNames.join(', ')}`,
          button('btn btn-small btn-primary', 'Join', () => handlers.onJoin(playerName(), world.code)),
          button('btn btn-small', 'Export', () => handlers.onExport(world.code)),
        ),
      )
    }
  }

  // ---- the tabs
  const panes: Record<MenuTab, HTMLElement> = { create: createPane, load: loadPane, join: joinPane }
  const tabButtons = {} as Record<MenuTab, HTMLButtonElement>
  const tabs = element('div', 'menu-tabs')
  for (const [tab, text] of [
    ['create', 'Create game'],
    ['load', 'Load game'],
    ['join', 'Join game'],
  ] as const) {
    tabButtons[tab] = button('menu-tab', text, () => view.show(tab))
    tabs.append(tabButtons[tab])
  }

  const status = element('p', 'menu-status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  const card = element(
    'div',
    'menu-card',
    element('header', 'menu-header', element('h1', 'menu-title', GAME_TITLE), element('div', 'stripe')),
    element('section', 'menu-section', element('h2', 'section-title', element('span', '', 'Your tribe member')), label('Name', nameInput), nameInput),
    tabs,
    createPane,
    loadPane,
    joinPane,
    status,
  )
  container.replaceChildren(element('div', 'menu-screen', element('div', 'menu-layout', card)))

  const buttons = [createButton, soloButton, joinButton, importButton]
  const view: MenuView = {
    setBusy(busy) {
      for (const made of buttons) made.disabled = busy
      for (const made of card.querySelectorAll<HTMLButtonElement>('.world-row button')) made.disabled = busy
    },
    setMessage(text, isError = false) {
      status.textContent = text
      status.classList.toggle('is-error', isError)
    },
    show(tab) {
      for (const key of Object.keys(panes) as MenuTab[]) {
        panes[key].hidden = key !== tab
        tabButtons[key].classList.toggle('is-active', key === tab)
      }
      void refresh(tab)
    },
  }
  // An invite link opens the Join tab with its code filled in.
  view.show(initial.code ? 'join' : 'create')
  ;(initial.code ? codeInput : nameInput.value ? worldInput : nameInput).focus()
  if (initial.message) view.setMessage(initial.message, initial.isError)
  return view
}
