import type { Settings } from '../settings.ts'
import { button, element } from './dom.ts'
import { createSettingsView, type GameSettings } from './settings-view.ts'

// `onRespawn`: back to the world spawn, or to the sleeping bag last slept in (for a player stuck somewhere).
export type PauseMenuHandlers = { onCopyInvite: () => void; onLeave: () => void; onRespawn: (at: 'spawn' | 'bed') => void }
export type PauseMenu = {
  readonly isOpen: boolean
  open(): void
  close(): void
  // What Escape does while the menu is open: back from the settings (or respawning) to the menu, or out of the menu
  // to the game.
  back(): void
  dispose(): void
}

// The menu Escape opens over the game, and the settings it leads to. The game goes on behind it (it is multiplayer),
// but while it is open the keys and the mouse do not reach the game.
export function createPauseMenu(container: HTMLElement, settings: Settings, handlers: PauseMenuHandlers, game?: GameSettings): PauseMenu {
  let open = false
  const resume = button('btn btn-primary', 'Back to the game', () => menu.close())
  const main = element(
    'div',
    'pause-card',
    element('h2', 'pause-title', 'Menu'),
    element('div', 'stripe'),
    resume,
    button('btn', 'Settings', () => showSettings()),
    button('btn', 'Respawn', () => showRespawn()),
    button('btn', 'Copy invite link', () => handlers.onCopyInvite()),
    button('btn btn-danger', 'Leave game', () => handlers.onLeave()),
  )
  // Respawning: where to, or back to the menu.
  const respawnTo = (at: 'spawn' | 'bed') => (): void => {
    menu.close()
    handlers.onRespawn(at)
  }
  const toSpawn = button('btn btn-primary', 'At the world spawn', respawnTo('spawn'))
  const respawn = element(
    'div',
    'pause-card',
    element('h2', 'pause-title', 'Respawn'),
    element('div', 'stripe'),
    element('p', 'settings-note', 'For when you are stuck somewhere (a raft lost at sea). You keep your health and your things.'),
    toSpawn,
    button('btn', 'At my sleeping bag', respawnTo('bed')),
    button('btn', 'Back', () => showMain()),
  )
  const settingsView = createSettingsView(settings, () => showMain(), game)
  const backdrop = element('div', 'pause', main)
  backdrop.hidden = true
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) menu.close()
  })
  container.append(backdrop)

  const showMain = (): void => {
    backdrop.replaceChildren(main)
    resume.focus()
  }
  const showRespawn = (): void => {
    backdrop.replaceChildren(respawn)
    toSpawn.focus()
  }
  const showSettings = (): void => {
    settingsView.refresh()
    backdrop.replaceChildren(settingsView.root)
  }

  const menu: PauseMenu = {
    get isOpen() {
      return open
    },
    open() {
      open = true
      backdrop.hidden = false
      showMain()
    },
    close() {
      open = false
      backdrop.hidden = true
      backdrop.replaceChildren(main)
    },
    back() {
      if (backdrop.firstChild === settingsView.root || backdrop.firstChild === respawn) showMain()
      else menu.close()
    },
    dispose() {
      settingsView.dispose()
    },
  }
  return menu
}
