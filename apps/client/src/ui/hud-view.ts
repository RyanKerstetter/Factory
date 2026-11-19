import { button, element } from './dom.ts'

export type HudInfo = { code: string; players: readonly string[]; pingMs: number | undefined }
export type ToastTone = 'info' | 'error'

export type HudView = {
  update(info: HudInfo): void
  // The key hints in the top right, as [key, what it does] pairs.
  setHints(hints: ReadonlyArray<readonly [string, string]>): void
  // A line in the pickup feed ("+3 Log"), which fades after a few seconds.
  pickup(text: string): void
  toast(text: string, tone?: ToastTone): void
  setConnecting(text: string | undefined): void
}

const TOAST_MS = 2_600
const PICKUP_MS = 2_400
const PICKUP_LINES = 5

// The strip along the top (the game's code, who is in it, the ping), the keys in the top right, a line for messages
// over the hotbar, what the player has just picked up, and the notice shown while the game is connecting.
export function createHudView(container: HTMLElement, onCopyInvite: () => void): HudView {
  const code = button('topbar-code', '', () => onCopyInvite())
  code.title = 'Copy an invite link'
  const players = element('span', 'topbar-item')
  const ping = element('span', 'topbar-item mono')
  const topbar = element('div', 'topbar', element('span', 'topbar-label', 'Game'), code, players, ping)
  const keys = element('div', 'keys')
  const feed = element('div', 'pickup-feed')
  feed.setAttribute('aria-live', 'polite')
  const toast = element('div', 'toast')
  toast.hidden = true
  toast.setAttribute('role', 'status')
  const connecting = element('div', 'connecting')
  container.append(topbar, keys, feed, toast, connecting)

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let shown = ''
  return {
    update(info) {
      const key = `${info.code}|${info.players.join(',')}|${info.pingMs === undefined ? '' : Math.round(info.pingMs)}`
      if (key === shown) return
      shown = key
      code.textContent = info.code
      players.textContent = `${info.players.length} ${info.players.length === 1 ? 'player' : 'players'}`
      players.title = info.players.join(', ')
      ping.textContent = info.pingMs === undefined ? '— ms' : `${Math.round(info.pingMs)} ms`
    },
    setHints(hints) {
      keys.replaceChildren(...hints.map(([key, action]) => element('span', 'key-hint', element('kbd', '', key), action)))
    },
    pickup(text) {
      const line = element('div', 'pickup-line', text)
      feed.append(line)
      while (feed.children.length > PICKUP_LINES) feed.firstElementChild?.remove()
      setTimeout(() => line.classList.add('is-fading'), PICKUP_MS - 400)
      setTimeout(() => line.remove(), PICKUP_MS)
    },
    toast(text, tone = 'info') {
      toast.textContent = text
      toast.classList.toggle('is-error', tone === 'error')
      toast.hidden = false
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        toast.hidden = true
      }, TOAST_MS)
    },
    setConnecting(text) {
      connecting.hidden = text === undefined
      connecting.textContent = text ?? ''
    },
  }
}
