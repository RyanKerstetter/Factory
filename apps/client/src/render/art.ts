import { Assets, Texture } from 'pixi.js'
import { ART_CATALOG } from './art-catalog.ts'
import { PLACEHOLDER_SIZE } from './placeholders.ts'

// Every PNG under res/, by its path from res/ ("buildings/belt.png"). Vite gives each its address, in development and
// in a build, and a new file is found on reload.
const files = import.meta.glob('../../../../res/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const RES_PREFIX = '../../../../res/'
const fileUrls = new Map(Object.entries(files).map(([path, url]) => [path.slice(RES_PREFIX.length), url]))

const placeholderUrls = new Map<string, string>()
const placeholderCanvases = new Map<string, HTMLCanvasElement>()

function placeholderCanvas(id: string): HTMLCanvasElement {
  let canvas = placeholderCanvases.get(id)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = PLACEHOLDER_SIZE
    canvas.height = PLACEHOLDER_SIZE
    const context = canvas.getContext('2d')
    const entry = ART_CATALOG[id]
    if (context && entry) entry.placeholder(context)
    placeholderCanvases.set(id, canvas)
  }
  return canvas
}

// Whether a picture comes from a file (true) or is a placeholder.
export function hasArtFile(id: string): boolean {
  const entry = ART_CATALOG[id]
  return entry !== undefined && fileUrls.has(entry.file)
}

// An address for a picture, for the page's own elements (the build bar, the inventory): its file, or the placeholder
// drawn and turned into a data address.
export function artUrl(id: string): string {
  const entry = ART_CATALOG[id]
  const file = entry && fileUrls.get(entry.file)
  if (file) return file
  let url = placeholderUrls.get(id)
  if (!url) {
    url = placeholderCanvas(id).toDataURL()
    placeholderUrls.set(id, url)
  }
  return url
}

// The textures the world is drawn with, one for each picture in the catalog, all sampled nearest so pixel art stays
// crisp. A file that will not load is drawn as its placeholder, with a warning.
export class Art {
  private constructor(private readonly textures: ReadonlyMap<string, Texture>) {}

  static async load(): Promise<Art> {
    const textures = new Map<string, Texture>()
    await Promise.all(
      Object.entries(ART_CATALOG).map(async ([id, entry]) => {
        const url = fileUrls.get(entry.file)
        let texture: Texture | undefined
        if (url) {
          try {
            texture = await Assets.load<Texture>(url)
          } catch (error) {
            console.warn(`Could not load res/${entry.file}, so ${id} is drawn as its placeholder.`, error)
          }
        }
        texture ??= Texture.from(placeholderCanvas(id))
        texture.source.scaleMode = 'nearest'
        textures.set(id, texture)
      }),
    )
    if (import.meta.env.DEV) {
      const missing = Object.entries(ART_CATALOG).filter(([id]) => !hasArtFile(id)).map(([, entry]) => `res/${entry.file}`)
      if (missing.length > 0) console.info(`Drawn as placeholders until these files exist:\n${missing.join('\n')}`)
    }
    return new Art(textures)
  }

  texture(id: string): Texture {
    return this.textures.get(id) ?? Texture.WHITE
  }
}
