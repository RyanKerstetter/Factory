import { element } from './dom.ts'

export type DebugOverlay = { update(lines: readonly string[] | undefined): void }

// The numbers behind the netcode, at the top left while the debug view (F3) is on.
export function createDebugOverlay(container: HTMLElement): DebugOverlay {
  const pre = element('pre', 'debug-overlay')
  pre.hidden = true
  container.append(pre)
  return {
    update(lines) {
      pre.hidden = !lines
      if (lines) pre.textContent = lines.join('\n')
    },
  }
}
