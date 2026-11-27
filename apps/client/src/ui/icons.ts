import { getItem, type ItemId } from '../../../../packages/shared/src/index.ts'

// Every item's picture: its `icon` in data/items.json (or icons/items/<key>.png), a PNG
// under res/. Vite gives each file its address, in development and in a build, and a new file is found on reload. An
// item with no file yet is drawn as a stand-in: a gem in its colour.
const files = import.meta.glob('../../../../res/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const RES_PREFIX = '../../../../res/'
const fileUrls = new Map(Object.entries(files).map(([path, url]) => [path.slice(RES_PREFIX.length), url]))
const SIZE = 32
// How many pixels a side every icon is: anywhere one is shown, it is shown at a whole multiple of this (16, 32, 48).
export const ICON_PIXELS = 16
const made = new Map<ItemId, string>()

// The path under res/ an item's picture goes at (tests/client.test.ts looks for each the same way).
function iconFile(item: ItemId): string {
  const def = getItem(item)
  return def.icon ?? `icons/items/${def.key}.png`
}

// Shows an item's picture in an image, unless it already shows it (an image's `src` reads back as a whole address,
// not the one it was given, so it is compared as it was set).
export function showIcon(image: HTMLImageElement, item: ItemId): void {
  const url = iconUrl(item)
  if (image.getAttribute('src') !== url) image.src = url
}

// An address for an item's picture.
export function iconUrl(item: ItemId): string {
  const file = fileUrls.get(iconFile(item))
  if (file) return file
  let url = made.get(item)
  if (!url) {
    // Painted at SIZE, then taken down to 16 pixels a side (every other pixel), so it is pixel art of the same size as
    // every icon file and scales up the same.
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const g = canvas.getContext('2d')
    if (g) gem(getItem(item).color)(g)
    const small = document.createElement('canvas')
    small.width = ICON_PIXELS
    small.height = ICON_PIXELS
    const s = small.getContext('2d')
    if (s) {
      s.imageSmoothingEnabled = false
      s.drawImage(canvas, 0, 0, ICON_PIXELS, ICON_PIXELS)
    }
    url = small.toDataURL()
    made.set(item, url)
  }
  return url
}

type Painter = (g: CanvasRenderingContext2D) => void

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`
// A colour made darker (amount below 1) or lighter (above 1).
const shade = (color: number, amount: number): string => {
  const channel = (shift: number): number => Math.max(0, Math.min(255, Math.round(((color >> shift) & 255) * amount)))
  return hex((channel(16) << 16) | (channel(8) << 8) | channel(0))
}
const rect = (g: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void => {
  g.fillStyle = color
  g.fillRect(x, y, w, h)
}

// A gem in a colour: the stand-in for any item without a picture of its own.
function gem(color: number): Painter {
  return (g) => {
    const diamond = (inset: number, fill: string): void => {
      g.fillStyle = fill
      g.beginPath()
      g.moveTo(16, inset)
      g.lineTo(32 - inset, 16)
      g.lineTo(16, 32 - inset)
      g.lineTo(inset, 16)
      g.closePath()
      g.fill()
    }
    diamond(3, shade(color, 0.5))
    diamond(6, hex(color))
    rect(g, shade(color, 1.35), 12, 11, 4, 3)
  }
}

