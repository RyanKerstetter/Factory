import './style.css'
import { GAME_TITLE, seedFromText, type GameInfo, type SavedWorldInfo, type TerrainSettings } from '../../../packages/shared/src/index.ts'
import { startGame } from './game.ts'
import { createMenuView } from './ui/menu-view.ts'

// The page: the main menu, and a game once one is started or joined. The address says which game the page is in
// (?game=ABC123), so it is the invite link, and opening it fills in the code to join.

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('The page is missing its #app element.')
const app = root
const NAME_KEY = 'factory.name'
document.title = GAME_TITLE

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim())
  } catch {
    // A browser that keeps nothing asks for the name again next time.
  }
}

function setGameInAddress(code: string | undefined): void {
  const url = new URL(window.location.href)
  if (code) url.searchParams.set('game', code)
  else url.searchParams.delete('game')
  window.history.replaceState(null, '', url)
}

// A request to the game server's API: what it answered, or why not (in words to show). A body of text is JSON; anything
// else (a world's file) goes as it is.
async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const json = typeof init?.body === 'string'
    const response = await fetch(path, { ...init, ...(json ? { headers: { 'Content-Type': 'application/json' } } : {}) })
    const body = (await response.json().catch(() => ({}))) as T & { error?: string }
    return response.ok ? { ok: true, data: body } : { ok: false, error: body.error ?? `The server said ${response.status}.` }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

function showMenu(message?: string, isError = false): void {
  const code = new URLSearchParams(window.location.search).get('game')?.toUpperCase() ?? ''
  const failed = (error: string): void => {
    menu.setBusy(false)
    menu.setMessage(error, true)
  }
  // Asks the server for a game (made, loaded from its save, or found running), saying so while it waits, and goes into
  // it as `name`.
  const enterFromServer = async (name: string, waiting: string, path: string, init?: RequestInit): Promise<void> => {
    saveName(name)
    menu.setBusy(true)
    menu.setMessage(waiting)
    const result = await api<GameInfo>(path, init)
    if (!result.ok) return failed(result.error)
    void enter(result.data.code, name)
  }
  const menu = createMenuView(app, { name: readName(), code, ...(message ? { message, isError } : {}) }, {
    onCreate: async (name, worldName, seed, terrain) => {
      if (!worldName.trim()) return menu.setMessage('Give the world a name.', true)
      const body = { name: worldName.trim(), ...(seed.trim() ? { seed: seed.trim() } : {}), size: terrain.size }
      await enterFromServer(name, 'Making a world…', '/api/games', { method: 'POST', body: JSON.stringify(body) })
    },
    onLoad: (name, worldCode) => enterFromServer(name, 'Loading the world…', `/api/saves/${encodeURIComponent(worldCode)}/load`, { method: 'POST' }),
    onJoin: async (name, gameCode) => {
      if (!gameCode.trim()) return menu.setMessage('Type the code of the game to join.', true)
      await enterFromServer(name, 'Looking for the game…', `/api/games/${encodeURIComponent(gameCode.trim())}`)
    },
    // A world as a file: the server sends it as a download.
    onExport: (worldCode) => {
      const link = document.createElement('a')
      link.href = `/api/worlds/${encodeURIComponent(worldCode)}/export`
      link.download = ''
      document.body.append(link)
      link.click()
      link.remove()
    },
    onDelete: async (worldCode, worldName) => {
      if (!window.confirm(`Delete “${worldName}” for good? This cannot be undone. (Export it first to keep a copy.)`)) return
      menu.setBusy(true)
      const result = await api<{ ok: boolean }>(`/api/saves/${encodeURIComponent(worldCode)}`, { method: 'DELETE' })
      menu.setBusy(false)
      if (!result.ok) return failed(result.error)
      menu.setMessage(`Deleted “${worldName}”.`)
      menu.show('load')
    },
    onImport: async (file) => {
      menu.setBusy(true)
      menu.setMessage(`Importing ${file.name}…`)
      // The file as it is: a gzipped save as exported, or its JSON unzipped; the server reads either.
      const result = await api<SavedWorldInfo>('/api/worlds/import', { method: 'POST', body: file })
      menu.setBusy(false)
      if (!result.ok) return failed(result.error)
      menu.setMessage(`Imported “${result.data.name}”: it is in the list to load.`)
      menu.show('load')
    },
    listSaved: async () => {
      const result = await api<SavedWorldInfo[]>('/api/saves')
      return result.ok ? result.data : result.error
    },
    listRunning: async () => {
      const result = await api<GameInfo[]>('/api/games')
      return result.ok ? result.data : result.error
    },
    onSingleplayer: (name, seed, terrain) => {
      saveName(name)
      menu.setBusy(true)
      // A random seed, or the one typed (as a hosted game makes it).
      const typed = seed.trim()
      void enter('SOLO', name, { seed: typed ? seedFromText(typed) : 1 + Math.floor(Math.random() * 999_999_999), terrain })
    },
  })
}

async function enter(code: string, name: string, local?: { seed: number; terrain: TerrainSettings }): Promise<void> {
  // A singleplayer world has no code to share, so the address does not get one.
  setGameInAddress(local ? undefined : code)
  let left = false
  const leave = (message?: string, isError = false): void => {
    if (left) return
    left = true
    setGameInAddress(undefined)
    showMenu(message, isError)
  }
  try {
    await startGame({ container: app, code, name, onLeave: leave, ...(local ? { local } : {}) })
  } catch (error) {
    console.error(error)
    leave('The game could not start in this browser.', true)
  }
}

showMenu()
