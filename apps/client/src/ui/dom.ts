// An element with a class (if given) and what goes in it: nodes or plain text.
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  if (className) made.className = className
  made.append(...children)
  return made
}

export function button(className: string, label: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
  const made = element('button', className, label)
  made.type = 'button'
  made.addEventListener('click', onClick)
  return made
}

// An image of pixel art (an item's icon), kept crisp, that cannot be dragged off the page; `src` may be set later.
export function pixelImage(className: string, src?: string): HTMLImageElement {
  const image = element('img', `pixel ${className}`)
  if (src !== undefined) image.src = src
  image.alt = ''
  image.draggable = false
  return image
}

// Copies text, falling back to a hidden text box on pages where the clipboard is not allowed (plain http).
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const box = element('textarea')
    box.value = text
    box.style.position = 'fixed'
    box.style.opacity = '0'
    document.body.append(box)
    box.select()
    const copied = document.execCommand('copy')
    box.remove()
    return copied
  }
}
