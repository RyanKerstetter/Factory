import { element } from './dom.ts'

// The name of whatever is under the mouse, in a small label beside it: anything with a `data-tip` (the slots, the
// hotbar, the recipes' items). One label for the whole page, moved about, rather than the browser's slow `title`.
export function createTooltips(container: HTMLElement): () => void {
  const tip = element('div', 'tooltip')
  tip.hidden = true
  container.append(tip)
  let over: HTMLElement | undefined

  const onMove = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null
    const text = target?.dataset.tip
    if (!target || !text) {
      tip.hidden = true
      over = undefined
      return
    }
    if (target !== over || tip.textContent !== text) {
      over = target
      tip.textContent = text
    }
    tip.hidden = false
    tip.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 16}px)`
  }
  const hide = (): void => {
    tip.hidden = true
    over = undefined
  }

  // Any key (E or Esc closing the panel under it) hides it too; it shows again when the mouse next moves over something.
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerdown', hide)
  window.addEventListener('keydown', hide)
  window.addEventListener('blur', hide)
  return () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', hide)
    window.removeEventListener('keydown', hide)
    window.removeEventListener('blur', hide)
    tip.remove()
  }
}
