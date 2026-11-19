import { KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP } from '../../../packages/shared/src/index.ts'
import type { Action, Settings } from './settings.ts'

const MOVEMENT: Partial<Record<Action, number>> = { up: KEY_UP, down: KEY_DOWN, left: KEY_LEFT, right: KEY_RIGHT }

// The keys held down, by code, and the movement they make under the player's key bindings.
export class HeldKeys {
  private readonly held = new Set<string>()

  constructor(private readonly settings: Settings) {}

  press(code: string): void {
    this.held.add(code)
  }

  release(code: string): void {
    this.held.delete(code)
  }

  clear(): void {
    this.held.clear()
  }

  // With `turned` (the isometric view, whose screen is turned 45° from the world's grid), up on the screen is north-west
  // in the world, right is north-east, and so on, so the keys go the way they point on the screen.
  movement(turned = false): number {
    let keys = 0
    for (const code of this.held) {
      const action = this.settings.actionOf(code)
      if (action) keys |= MOVEMENT[action] ?? 0
    }
    if (!turned) return keys
    const right = (keys & KEY_RIGHT ? 1 : 0) - (keys & KEY_LEFT ? 1 : 0)
    const down = (keys & KEY_DOWN ? 1 : 0) - (keys & KEY_UP ? 1 : 0)
    const east = right + down
    const south = down - right
    return (east > 0 ? KEY_RIGHT : east < 0 ? KEY_LEFT : 0) | (south > 0 ? KEY_DOWN : south < 0 ? KEY_UP : 0)
  }
}

export function isMovementAction(action: Action | undefined): boolean {
  return action !== undefined && MOVEMENT[action] !== undefined
}

// Whether a key was pressed while typing in a field, where the game leaves it alone.
export function isTypingIn(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}
