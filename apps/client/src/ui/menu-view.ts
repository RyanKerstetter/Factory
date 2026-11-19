import { GAME_TITLE, type GameInfo, type SavedWorldInfo } from '../../../../packages/shared/src/index.ts'
import { button, element } from './dom.ts'

export type MenuTab = 'create' | 'load' | 'join'

export type MenuHandlers = {
  // A new world on the server, by name (and seed: empty for a random one).
  onCreate: (name: string, worldName: string, seed: string) => void
  // Start a saved world running, and play in it.
  onLoad: (name: string, code: string) => void
  // Join a running world.
  onJoin: (name: string, code: string) => void
  // Download a world as a file; add a world from a file to the saved worlds.
  onExport: (code: string) => void
  onImport: (file: File) => void
  // Singleplayer: a world run in this browser (not saved yet).
  onSingleplayer: (name: string, seed: string) => void
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
  const label = (text: string, target: HTMLInputElement): HTMLLabelElement => {
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
  const createButton = button('btn btn-primary', 'Create game', () => handlers.onCreate(playerName(), worldInput.value, seedInput.value))
  onEnter(worldInput, createButton)
  onEnter(seedInput, createButton)
  const soloSeedInput = input('menu-solo-seed', 'Random', 40)
  const soloButton = button('btn', 'Play offline', () => handlers.onSingleplayer(playerName(), soloSeedInput.value))
  onEnter(soloSeedInput, soloButton)
  const createPane = element(
    'div',
    'menu-pane',
    label('World name', worldInput),
    worldInput,
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

  const refresh = async (tab: MenuTab): Promise<void> => {
    if (tab === 'load') {
      savedList.replaceChildren(empty('Looking…'))
      const saved = await handlers.listSaved()
      if (typeof saved === 'string') return void savedList.replaceChildren(empty(saved))
      savedList.replaceChildren(
        ...(saved.length === 0
          ? [empty('No saved worlds that are not running. Create one, or import one from a file.')]
          : saved.map((world) =>
              row(
                world.name,
                `Saved ${date(world.savedAt)}${world.players.length ? ` · ${world.players.join(', ')}` : ''}`,
                button('btn btn-small btn-primary', 'Load', () => handlers.onLoad(playerName(), world.code)),
                button('btn btn-small', 'Export', () => handlers.onExport(world.code)),
              ),
            )),
      )
    } else if (tab === 'join') {
      runningList.replaceChildren(empty('Looking…'))
      const running = await handlers.listRunning()
      if (typeof running === 'string') return void runningList.replaceChildren(empty(running))
      runningList.replaceChildren(
        ...(running.length === 0
          ? [empty('Nobody is playing right now. Create a world, or load one.')]
          : running.map((world) =>
              row(
                world.name,
                `${world.code} · ${world.players === 0 ? 'nobody in it' : world.playerNames.join(', ')}`,
                button('btn btn-small btn-primary', 'Join', () => handlers.onJoin(playerName(), world.code)),
                button('btn btn-small', 'Export', () => handlers.onExport(world.code)),
              ),
            )),
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
