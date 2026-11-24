import { CHEST_NAME_LENGTH } from '../../../../packages/shared/src/index.ts'
import { button, element } from './dom.ts'

// A waystone's panel (see waystones.ts): its name, typed in, and every other waystone in the world, each a button that
// sends the player there. While the waystone charges, the buttons are off and it says so.

export type WaystoneDestination = { id: number; title: string; distance: number; direction: string }
export type WaystoneView = {
  id: number
  name: string
  destinations: readonly WaystoneDestination[]
  // The player is on their way already (to `travellingTo`, if it is one of these).
  travelling: boolean
  travellingTo?: number
}

export type WaystoneHandlers = {
  rename: (id: number, name: string) => void
  travel: (from: number, to: number) => void
  close: () => void
}

export type WaystonePanel = {
  show: (view: WaystoneView | undefined) => void
  readonly isOpen: boolean
}

export function createWaystonePanel(container: HTMLElement, handlers: WaystoneHandlers): WaystonePanel {
  const nameInput = element('input', 'field-input chest-name')
  nameInput.placeholder = 'Name this waystone'
  nameInput.maxLength = CHEST_NAME_LENGTH
  const note = element('p', 'panel-note')
  const list = element('div', 'waystone-list')
  const heading = element('h3', 'waystone-heading', 'Travel to')
  const root = element(
    'div',
    'panels waystone-panels',
    element(
      'section',
      'panel waystone-panel',
      element('header', 'panel-header', element('h2', 'panel-title', 'Waystone'), button('panel-close', '×', () => handlers.close())),
      nameInput,
      heading,
      list,
      note,
    ),
  )
  root.hidden = true
  container.append(root)

  let current: WaystoneView | undefined
  let listKey = ''
  // Its name: kept when the box is left (or Enter is pressed).
  const save = (): void => {
    if (current && nameInput.value.trim() !== current.name) handlers.rename(current.id, nameInput.value)
  }
  nameInput.addEventListener('change', save)
  nameInput.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') nameInput.blur()
    if (event.key === 'Escape') {
      nameInput.blur()
      handlers.close()
    }
  })

  const show = (view: WaystoneView | undefined): void => {
    if (!view) {
      if (current && document.activeElement === nameInput) {
        save()
        nameInput.blur()
      }
      current = undefined
      root.hidden = true
      listKey = ''
      return
    }
    const opened = current?.id !== view.id
    current = view
    root.hidden = false
    if (opened || document.activeElement !== nameInput) nameInput.value = view.name
    const key = JSON.stringify([view.destinations, view.travelling, view.travellingTo])
    if (key === listKey) return
    listKey = key
    list.replaceChildren(
      ...view.destinations.map((destination) => {
        const made = button('waystone-destination', '', () => handlers.travel(view.id, destination.id))
        made.append(
          element('span', 'waystone-destination-name', destination.title),
          element('span', 'waystone-destination-far', `${destination.distance} tiles ${destination.direction}`),
        )
        made.disabled = view.travelling
        if (view.travellingTo === destination.id) made.classList.add('is-chosen')
        return made
      }),
    )
    heading.hidden = view.destinations.length === 0
    note.textContent = view.travelling
      ? 'The waystone is charging. Hold still…'
      : view.destinations.length === 0
        ? 'There are no other waystones yet. Put one down somewhere else to travel to it.'
        : 'Pick a waystone to travel to it.'
  }

  return {
    show,
    get isOpen() {
      return current !== undefined
    },
  }
}
