import { getItem, type ItemId } from '../../../../packages/shared/src/index.ts'

// Every item's picture: its `icon` in data/items.json (or icons/items/<key>.png, an ore's icons/ores/<key>.png), a PNG
// under res/. Vite gives each file its address, in development and in a build, and a new file is found on reload. An
// item with no file yet is drawn as a stand-in: a gem in its colour (or a little picture, for the few that have one).
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
  return def.icon ?? (def.category === 'ore' ? `icons/ores/${def.key}.png` : `icons/items/${def.key}.png`)
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
    if (g) (STAND_INS[getItem(item).key] ?? gem(getItem(item).color))(g)
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

const STAND_INS: Readonly<Record<string, Painter>> = {
  // A garden plot: dark soil in a wooden frame, furrows across it.
  'garden-plot': (g) => {
    rect(g, '#6e4a2c', 1, 1, 30, 30)
    rect(g, '#4a3220', 3, 3, 26, 26)
    for (let y = 6; y < 28; y += 6) rect(g, '#3a2616', 4, y, 24, 2)
    rect(g, '#9a6a3c', 1, 1, 30, 2)
  },
  // A feed box: a wooden trough with hay in it.
  'feed-box': (g) => {
    g.fillStyle = 'rgba(0, 0, 0, 0.25)'
    g.fillRect(3, 24, 28, 5)
    rect(g, '#6e4a2c', 2, 8, 28, 18)
    rect(g, '#9a6a3c', 3, 9, 26, 16)
    rect(g, '#d8c27a', 5, 9, 22, 6)
    rect(g, '#b99f55', 7, 11, 18, 2)
    rect(g, '#c08a52', 3, 15, 26, 2)
  },
}
