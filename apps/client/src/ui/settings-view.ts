import { ACTIONS, keyName, RESERVED_KEYS, VOLUME_CHANNELS, type Action, type Settings, type VolumeChannel } from '../settings.ts'
import { button, element } from './dom.ts'

export type SettingsView = {
  readonly root: HTMLElement
  // Brings what is shown up to date, and goes back to the first tab.
  refresh(): void
  dispose(): void
}

// The mouse buttons, Escape and the wheel cannot be rebound; they are listed so every control is in one place.
const FIXED: ReadonlyArray<[string, string]> = [
  ['Attack / break', 'Left mouse'],
  ['Place / plant / open', 'Right mouse'],
  ['Hotbar slot', 'Mouse wheel'],
  ['Zoom', 'Ctrl + mouse wheel'],
  ['Menu', 'Esc'],
]

type Tab = 'controls' | 'audio' | 'game'

// The settings of the game being played, kept by the server: who the host is, and whether players can hurt each
// other, which only the host can change.
export type GameSettings = {
  get: () => { host: string; pvp: boolean; isHost: boolean }
  setPvp: (on: boolean) => void
  // Calls `listener` whenever they change. Gives back a function that stops it.
  subscribe: (listener: () => void) => () => void
}

// The settings, in tabs. Controls lists every action with its two keys: click one and press a key to bind it
// (Escape cancels, Backspace or Delete leaves it unbound). A key already bound to something else moves here.
export function createSettingsView(settings: Settings, onBack: () => void, game?: GameSettings): SettingsView {
  let tab: Tab = 'controls'
  let listening: { action: Action; which: 0 | 1; button: HTMLButtonElement } | undefined

  const tabButtons = new Map<Tab, HTMLButtonElement>()
  const tabBar = element('div', 'tabs')
  const tabs: Array<[Tab, string]> = [['controls', 'Controls'], ['audio', 'Audio'], ...(game ? [['game', 'Game'] as [Tab, string]] : [])]
  for (const [id, label] of tabs) {
    const tabButton = button('tab', label, () => show(id))
    tabButton.setAttribute('role', 'tab')
    tabButtons.set(id, tabButton)
    tabBar.append(tabButton)
  }
  tabBar.setAttribute('role', 'tablist')

  // ---- controls

  const keyButtons = new Map<string, HTMLButtonElement>()
  const controlsBody = element('div', 'controls')
  let group = ''
  for (const info of ACTIONS) {
    if (info.group !== group) {
      group = info.group
      controlsBody.append(element('h3', 'controls-group', group))
    }
    const keys = ([0, 1] as const).map((which) => {
      const keyButton = button('key-bind', '', () => listen(info.action, which, keyButton))
      keyButtons.set(`${info.action}:${which}`, keyButton)
      return keyButton
    })
    controlsBody.append(element('div', 'controls-row', element('span', 'controls-label', info.label), ...keys))
  }
  controlsBody.append(element('h3', 'controls-group', 'Mouse and fixed keys'))
  for (const [label, key] of FIXED) {
    controlsBody.append(element('div', 'controls-row is-fixed', element('span', 'controls-label', label), element('span', 'key-fixed', key)))
  }
  const reset = button('btn btn-small', 'Reset to defaults', () => {
    stopListening()
    settings.resetControls()
  })
  const controlsPanel = element('div', 'settings-panel', element('div', 'controls-scroll', controlsBody), element('div', 'settings-actions', reset))

  // ---- audio

  const sliders = new Map<VolumeChannel, { input: HTMLInputElement; value: HTMLSpanElement }>()
  const audioRows: HTMLElement[] = []
  for (const { channel, label } of VOLUME_CHANNELS) {
    const input = element('input', 'range')
    input.type = 'range'
    input.min = '0'
    input.max = '100'
    input.step = '1'
    const value = element('span', 'range-value mono')
    input.addEventListener('input', () => settings.setVolume(channel, Number(input.value) / 100))
    sliders.set(channel, { input, value })
    audioRows.push(element('label', 'settings-row', element('span', 'controls-label', label), input, value))
  }
  const mute = element('input', 'checkbox')
  mute.type = 'checkbox'
  mute.addEventListener('change', () => settings.setMuted(mute.checked))
  audioRows.push(element('label', 'settings-row', element('span', 'controls-label', 'Mute'), mute))
  const resetAudio = button('btn btn-small', 'Reset to defaults', () => settings.resetAudio())
  const audioPanel = element('div', 'settings-panel', element('div', 'audio-rows', ...audioRows), element('div', 'settings-actions', resetAudio))

  // ---- game (the server's, for everyone in it)

  const pvpBox = element('input', 'checkbox')
  pvpBox.type = 'checkbox'
  pvpBox.addEventListener('change', () => game?.setPvp(pvpBox.checked))
  const hostNote = element('p', 'settings-note')
  const gamePanel = element(
    'div',
    'settings-panel',
    element('div', 'audio-rows', element('label', 'settings-row', element('span', 'controls-label', 'PvP'), pvpBox), element('p', 'settings-note', 'With PvP on, players can hurt each other.'), hostNote),
  )

  const body = element('div', 'settings-body')
  const root = element(
    'div',
    'pause-card settings-card',
    element('h2', 'pause-title', 'Settings'),
    element('div', 'stripe'),
    tabBar,
    body,
    button('btn', 'Back', () => {
      stopListening()
      onBack()
    }),
  )

  const fill = (): void => {
    for (const { action } of ACTIONS) {
      const binding = settings.binding(action)
      for (const which of [0, 1] as const) {
        const keyButton = keyButtons.get(`${action}:${which}`)!
        if (listening?.button === keyButton) continue
        const code = binding[which]
        keyButton.textContent = code ? keyName(code) : '—'
        keyButton.classList.toggle('is-unbound', !code)
      }
    }
    for (const [channel, { input, value }] of sliders) {
      input.value = String(Math.round(settings.volumes[channel] * 100))
      value.textContent = `${input.value}%`
      input.disabled = settings.muted
    }
    mute.checked = settings.muted
    if (game) {
      const { host, pvp, isHost } = game.get()
      pvpBox.checked = pvp
      pvpBox.disabled = !isHost
      hostNote.textContent = isHost ? 'You are the host: this is up to you, for everyone in the game.' : `Only the host${host ? ` (${host})` : ''} can change this.`
    }
  }

  const show = (next: Tab): void => {
    stopListening()
    tab = next
    for (const [id, tabButton] of tabButtons) {
      tabButton.classList.toggle('is-active', id === tab)
      tabButton.setAttribute('aria-selected', String(id === tab))
    }
    body.replaceChildren(tab === 'controls' ? controlsPanel : tab === 'audio' ? audioPanel : gamePanel)
  }

  const listen = (action: Action, which: 0 | 1, keyButton: HTMLButtonElement): void => {
    stopListening()
    listening = { action, which, button: keyButton }
    keyButton.textContent = 'Press a key…'
    keyButton.classList.add('is-listening')
  }

  function stopListening(): void {
    if (!listening) return
    listening.button.classList.remove('is-listening')
    listening = undefined
    fill()
  }

  // Before anything else hears it (the game and the menu listen to keys on the window too), a key pressed while waiting
  // for one is taken for the binding: Escape then cancels the binding rather than leaving the settings.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!listening) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const { action, which } = listening
    if (event.code === 'Escape') {
      stopListening()
      return
    }
    const code = event.code === 'Backspace' || event.code === 'Delete' ? null : event.code
    if (code !== null && RESERVED_KEYS.has(code)) return
    listening.button.classList.remove('is-listening')
    listening = undefined
    settings.bind(action, which, code)
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (listening && event.target !== listening.button) stopListening()
  }
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  const unsubscribe = settings.subscribe(fill)
  const unsubscribeGame = game?.subscribe(fill)

  fill()
  show('controls')

  return {
    root,
    refresh() {
      fill()
      show('controls')
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      unsubscribe()
      unsubscribeGame?.()
    },
  }
}
