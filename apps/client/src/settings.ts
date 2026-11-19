// The player's settings: which keys do what, and how loud the game is. They are kept in this browser (localStorage),
// so they last from one game to the next; anything missing or unreadable falls back to the default.

// What a key can be bound to. The mouse buttons (punch, place), Escape (the menu) and the wheel (zoom) are fixed.
export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'inventory'
  | 'hotbar1'
  | 'hotbar2'
  | 'hotbar3'
  | 'hotbar4'
  | 'hotbar5'
  | 'hotbar6'
  | 'hotbar7'
  | 'hotbar8'
  | 'hotbar9'
  | 'hand'
  | 'debug'

export type ActionInfo = { action: Action; label: string; group: string }

// Every action, in the order the controls list shows them.
export const ACTIONS: readonly ActionInfo[] = [
  { action: 'up', label: 'Walk up', group: 'Movement' },
  { action: 'down', label: 'Walk down', group: 'Movement' },
  { action: 'left', label: 'Walk left', group: 'Movement' },
  { action: 'right', label: 'Walk right', group: 'Movement' },
  { action: 'inventory', label: 'Inventory', group: 'Inventory' },
  { action: 'hotbar1', label: 'Hotbar slot 1', group: 'Inventory' },
  { action: 'hotbar2', label: 'Hotbar slot 2', group: 'Inventory' },
  { action: 'hotbar3', label: 'Hotbar slot 3', group: 'Inventory' },
  { action: 'hotbar4', label: 'Hotbar slot 4', group: 'Inventory' },
  { action: 'hotbar5', label: 'Hotbar slot 5', group: 'Inventory' },
  { action: 'hotbar6', label: 'Hotbar slot 6', group: 'Inventory' },
  { action: 'hotbar7', label: 'Hotbar slot 7', group: 'Inventory' },
  { action: 'hotbar8', label: 'Hotbar slot 8', group: 'Inventory' },
  { action: 'hotbar9', label: 'Hotbar slot 9', group: 'Inventory' },
  { action: 'hand', label: 'Put away (bare hands)', group: 'Inventory' },
  { action: 'debug', label: 'Debug view', group: 'Other' },
]

export const HOTBAR_ACTIONS: readonly Action[] = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9']

// Each action has two keys, either of which may be unbound (null). Keys are KeyboardEvent codes ("KeyW"), which
// name the key's place on the keyboard whatever the layout.
export type Binding = [string | null, string | null]
export type Bindings = Record<Action, Binding>

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  inventory: ['KeyE', 'Tab'],
  hotbar1: ['Digit1', null],
  hotbar2: ['Digit2', null],
  hotbar3: ['Digit3', null],
  hotbar4: ['Digit4', null],
  hotbar5: ['Digit5', null],
  hotbar6: ['Digit6', null],
  hotbar7: ['Digit7', null],
  hotbar8: ['Digit8', null],
  hotbar9: ['Digit9', null],
  hand: ['KeyQ', null],
  debug: ['F3', null],
}

// Keys that cannot be bound: Escape always opens the menu.
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['Escape'])

const STORAGE_KEY = 'factory-game.settings'

// The sound has a volume of its own for each kind of sound, under the master volume, which sets them all.
export type VolumeChannel = 'master' | 'effects' | 'footsteps'
export type Volumes = Record<VolumeChannel, number>

export const VOLUME_CHANNELS: ReadonlyArray<{ channel: VolumeChannel; label: string }> = [
  { channel: 'master', label: 'Master' },
  { channel: 'effects', label: 'Effects' },
  { channel: 'footsteps', label: 'Footsteps' },
]

export const DEFAULT_VOLUMES: Readonly<Volumes> = { master: 0.5, effects: 1, footsteps: 0.8 }

// `volume` is the single volume of earlier versions, read as the master volume.
type Stored = { bindings?: Partial<Record<string, unknown>>; volumes?: Partial<Record<string, unknown>>; volume?: unknown; muted?: unknown; view?: unknown }

// How the world is drawn: in 3D, seen from above at an angle, or flat from straight above in 2D. A change
// takes effect the next time a world is entered.
export type ViewMode = '3d' | '2d'
export const DEFAULT_VIEW: ViewMode = '3d'

export class Settings {
  private bindings: Bindings = cloneBindings(DEFAULT_BINDINGS)
  private byCode = new Map<string, Action>()
  private listeners = new Set<() => void>()
  volumes: Volumes = { ...DEFAULT_VOLUMES }
  muted = false
  view: ViewMode = DEFAULT_VIEW

  constructor() {
    this.load()
    this.index()
  }

  // The action a key does, if any.
  actionOf(code: string): Action | undefined {
    return this.byCode.get(code)
  }

  binding(action: Action): Binding {
    return this.bindings[action]
  }

  // Binds one of an action's two keys (or unbinds it, with null). A key bound to another action is taken from it, so
  // one key never does two things.
  bind(action: Action, which: 0 | 1, code: string | null): void {
    if (code !== null && RESERVED_KEYS.has(code)) return
    if (code !== null) {
      for (const other of ACTIONS) {
        const binding = this.bindings[other.action]
        if (binding[0] === code) binding[0] = null
        if (binding[1] === code) binding[1] = null
      }
    }
    this.bindings[action][which] = code
    this.changed()
  }

  setVolume(channel: VolumeChannel, volume: number): void {
    this.volumes[channel] = clamp01(volume)
    this.changed()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.changed()
  }

  setView(view: ViewMode): void {
    this.view = view
    this.changed()
  }

  resetAudio(): void {
    this.volumes = { ...DEFAULT_VOLUMES }
    this.muted = false
    this.changed()
  }

  resetControls(): void {
    this.bindings = cloneBindings(DEFAULT_BINDINGS)
    this.changed()
  }

  // A short name for the first key bound to an action, for hints ("E"), or an empty string if it has none.
  keyLabel(action: Action): string {
    const [first, second] = this.bindings[action]
    const code = first ?? second
    return code ? keyName(code) : ''
  }

  // Calls `listener` whenever a setting changes. Gives back a function that stops it.
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    this.index()
    this.save()
    for (const listener of this.listeners) listener()
  }

  private index(): void {
    this.byCode = new Map()
    for (const { action } of ACTIONS) {
      for (const code of this.bindings[action]) if (code && !this.byCode.has(code)) this.byCode.set(code, action)
    }
  }

  private load(): void {
    let stored: Stored | undefined
    try {
      const text = localStorage.getItem(STORAGE_KEY)
      stored = text ? (JSON.parse(text) as Stored) : undefined
    } catch {
      stored = undefined
    }
    if (!stored || typeof stored !== 'object') return
    const volume = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : undefined)
    this.volumes.master = volume(stored.volume) ?? this.volumes.master
    for (const { channel } of VOLUME_CHANNELS) this.volumes[channel] = volume(stored.volumes?.[channel]) ?? this.volumes[channel]
    if (typeof stored.muted === 'boolean') this.muted = stored.muted
    if (stored.view === '3d' || stored.view === '2d') this.view = stored.view
    const saved = stored.bindings
    if (!saved || typeof saved !== 'object') return
    for (const { action } of ACTIONS) {
      const binding = saved[action]
      if (!Array.isArray(binding) || binding.length !== 2) continue
      const key = (value: unknown): string | null => (typeof value === 'string' && !RESERVED_KEYS.has(value) ? value : null)
      this.bindings[action] = [key(binding[0]), key(binding[1])]
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ bindings: this.bindings, volumes: this.volumes, muted: this.muted, view: this.view }))
    } catch {
      // Storage is off or full: the settings still hold for this visit.
    }
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function cloneBindings(bindings: Readonly<Bindings>): Bindings {
  const copy = {} as Bindings
  for (const { action } of ACTIONS) copy[action] = [...bindings[action]] as Binding
  return copy
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  MetaLeft: 'L Meta',
  MetaRight: 'R Meta',
  CapsLock: 'Caps',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
}

// How a key code is written for a player: "KeyW" is W, "Digit1" is 1, "Numpad1" is Num 1.
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return code
}
