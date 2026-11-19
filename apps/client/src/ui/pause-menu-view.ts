import type { Settings } from '../settings.ts'
import { button, element } from './dom.ts'
import { createSettingsView } from './settings-view.ts'

export type PauseMenuHandlers = { onCopyInvite: () => void; onLeave: () => void }
export type PauseMenu = {
  readonly isOpen: boolean
  open(): void
  close(): void
  // What Escape does while the menu is open: back from the settings to the menu, or out of the menu to the game.
  back(): void
  dispose(): void
}

// The menu Escape opens over the game, and the settings it leads to. The game goes on behind it (it is multiplayer),
// but while it is open the keys and the mouse do not reach the game.
export function createPauseMenu(container: HTMLElement, settings: Settings, handlers: PauseMenuHandlers): PauseMenu {
  let open = false
  const resume = button('btn btn-primary', 'Back to the game', () => menu.close())
  const main = element(
    'div',
    'pause-card',
    element('h2', 'pause-title', 'Menu'),
    element('div', 'stripe'),
    resume,
    button('btn', 'Settings', () => showSettings()),
    button('btn', 'Copy invite link', () => handlers.onCopyInvite()),
    button('btn btn-danger', 'Leave game', () => handlers.onLeave()),
  )
  const settingsView = createSettingsView(settings, () => showMain())
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
      if (backdrop.firstChild === settingsView.root) showMain()
      else menu.close()
    },
    dispose() {
      settingsView.dispose()
    },
  }
  return menu
}
