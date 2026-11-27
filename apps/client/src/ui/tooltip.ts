import { element } from './dom.ts'

// The name of whatever is under the mouse, in a small label beside it: anything with a `data-tip` (the slots, the
// hotbar, the recipes' items). One label for the whole page, moved about, rather than the browser's slow `title`.
export function createTooltips(container: HTMLElement): () => void {
  const tip = element('div', 'tooltip')
  tip.hidden = true
  container.append(tip)
  let over: HTMLElement | undefined
  // Where the mouse last was (and whether it has been anywhere yet).
  let mouse: { x: number; y: number } | undefined
  let checking = 0

  // The label for whatever has a tip under a point, beside it; none over anything else.
  const show = (target: Element | null, x: number, y: number): void => {
    const tipped = target?.closest<HTMLElement>('[data-tip]') ?? undefined
    const text = tipped?.dataset.tip
    if (!tipped || !text) {
      hide()
      return
    }
    if (tipped !== over || tip.textContent !== text) {
      over = tipped
      tip.textContent = text
    }
    tip.hidden = false
    tip.style.transform = `translate(${Math.round(x) + 14}px, ${Math.round(y) + 16}px)`
  }
  const onMove = (event: PointerEvent): void => {
    mouse = { x: event.clientX, y: event.clientY }
    show(event.target instanceof Element ? event.target : null, event.clientX, event.clientY)
  }
  const hide = (): void => {
    tip.hidden = true
    over = undefined
  }
  // A key does not hide it (walking, with the inventory open, would make it flicker): once the key has done what it
  // does (E or Esc closing the panel under it), what is under the mouse is looked at again, on the next frame.
  const recheck = (): void => {
    if (checking || !mouse) return
    checking = requestAnimationFrame(() => {
      checking = 0
      if (mouse) show(document.elementFromPoint(mouse.x, mouse.y), mouse.x, mouse.y)
    })
  }
  const onKey = (event: KeyboardEvent): void => {
    if (!event.repeat) recheck()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerdown', hide)
  window.addEventListener('keydown', onKey)
  window.addEventListener('blur', hide)
  return () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', hide)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('blur', hide)
    if (checking) cancelAnimationFrame(checking)
    tip.remove()
  }
}
