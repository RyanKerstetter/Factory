import { button, element } from './dom.ts'

export type HudInfo = { code: string; players: readonly string[]; pingMs: number | undefined }
// The list of who is playing (held open with Tab): the world, and each player, whether it is you, and the host.
export type PlayerList = { title: string; players: ReadonlyArray<{ name: string; you: boolean; host: boolean }> }
export type ToastTone = 'info' | 'error'

export type HudView = {
  update(info: HudInfo): void
  // A line in the pickup feed ("+3 Log"), which fades after a few seconds.
  pickup(text: string): void
  toast(text: string, tone?: ToastTone): void
  // A line in the feed of who comes and goes ("Ada joined the game"), which fades after a while.
  notice(text: string): void
  // Shows who is playing (or hides the list, with undefined).
  showPlayers(list: PlayerList | undefined): void
  setConnecting(text: string | undefined): void
}

const TOAST_MS = 2_600
// The pickup feed and the notice feed: how many lines each shows at once, how long a line stays, and how long it takes
// to fade at the end of that.
const PICKUP_FEED = { lines: 5, ms: 2_400, fadeMs: 400 }
const NOTICE_FEED = { lines: 6, ms: 6_000, fadeMs: 600 }

// A line added to a feed, which fades and goes after a while; the oldest go at once if there are too many.
function addLine(feed: HTMLElement, className: string, text: string, how: { lines: number; ms: number; fadeMs: number }): void {
  const line = element('div', className, text)
  feed.append(line)
  while (feed.children.length > how.lines) feed.firstElementChild?.remove()
  setTimeout(() => line.classList.add('is-fading'), how.ms - how.fadeMs)
  setTimeout(() => line.remove(), how.ms)
}

const playerCount = (count: number): string => `${count} ${count === 1 ? 'player' : 'players'}`

// The strip along the top (the game's code, who is in it, the ping), a line for messages over the hotbar, what the
// player has just picked up, and the notice shown while the game is connecting.
export function createHudView(container: HTMLElement, onCopyInvite: () => void): HudView {
  const code = button('topbar-code', '', () => onCopyInvite())
  code.title = 'Copy an invite link'
  const players = element('span', 'topbar-item')
  const ping = element('span', 'topbar-item mono')
  const topbar = element('div', 'topbar', element('span', 'topbar-label', 'Game'), code, players, ping)
  const feed = element('div', 'pickup-feed')
  feed.setAttribute('aria-live', 'polite')
  const toast = element('div', 'toast')
  toast.hidden = true
  toast.setAttribute('role', 'status')
  const connecting = element('div', 'connecting')
  const notices = element('div', 'notice-feed')
  notices.setAttribute('aria-live', 'polite')
  const playersTitle = element('h2', 'player-list-title')
  const playersList = element('ul', 'player-list-names')
  const playerList = element('div', 'player-list', playersTitle, playersList)
  playerList.hidden = true
  container.append(topbar, notices, feed, toast, connecting, playerList)
  let shownPlayers = ''

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let shown = ''
  return {
    update(info) {
      const key = `${info.code}|${info.players.join(',')}|${info.pingMs === undefined ? '' : Math.round(info.pingMs)}`
      if (key === shown) return
      shown = key
      code.textContent = info.code
      players.textContent = playerCount(info.players.length)
      players.title = info.players.join(', ')
      ping.textContent = info.pingMs === undefined ? '— ms' : `${Math.round(info.pingMs)} ms`
    },
    pickup(text) {
      addLine(feed, 'pickup-line', text, PICKUP_FEED)
    },
    notice(text) {
      addLine(notices, 'notice-line', text, NOTICE_FEED)
    },
    showPlayers(list) {
      playerList.hidden = list === undefined
      if (!list) return
      const key = JSON.stringify(list)
      if (key === shownPlayers) return
      shownPlayers = key
      playersTitle.textContent = `${list.title} · ${playerCount(list.players.length)}`
      playersList.replaceChildren(
        ...list.players.map((player) =>
          element(
            'li',
            `player-list-row${player.you ? ' is-you' : ''}`,
            element('span', 'player-list-name', player.name),
            ...(player.host ? [element('span', 'player-list-tag', 'host')] : []),
            ...(player.you ? [element('span', 'player-list-tag is-you', 'you')] : []),
          ),
        ),
      )
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
