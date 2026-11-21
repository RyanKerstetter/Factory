import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { checkSave, type WorldSave } from './save.ts'

// A save as bytes: its JSON, gzipped (a save's JSON is mostly the same few words over and over, so it shrinks to about a
// tenth). What `fromBytes` reads back, gzipped or not (an exported save someone unzipped and edited, or an old one).
export function toBytes(save: WorldSave): Buffer {
  return gzipSync(JSON.stringify(save))
}

export function fromBytes(bytes: Buffer): unknown {
  const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  return JSON.parse((gzipped ? gunzipSync(bytes) : bytes).toString('utf8'))
}

// The saves folder: a file per world, `<code>.json.gz`, named by its code. (Saves from before they were gzipped, plain
// `<code>.json`, are read too, and replaced by a gzipped one the next time the world is saved.)
export class SaveFolder {
  constructor(readonly dir: string) {}

  private file(code: string): string {
    return join(this.dir, `${code}.json.gz`)
  }

  private plainFile(code: string): string {
    return join(this.dir, `${code}.json`)
  }

  // Writes a save, through a file beside it that is then renamed over it, so a crash part way leaves the last good one.
  async write(save: WorldSave): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const temporary = `${this.file(save.code)}.tmp`
    await writeFile(temporary, toBytes(save))
    await rename(temporary, this.file(save.code))
    await rm(this.plainFile(save.code), { force: true })
  }

  async read(code: string): Promise<WorldSave | undefined> {
    for (const file of [this.file(code), this.plainFile(code)]) {
      try {
        const checked = checkSave(fromBytes(await readFile(file)))
        if (checked.ok) return checked.save
      } catch {
        // Not there, or not a save: try the other, or give up.
      }
    }
    return undefined
  }

  // Deletes a save (both forms of its file). Gives whether there was one.
  async remove(code: string): Promise<boolean> {
    const had = (await this.read(code)) !== undefined
    for (const file of [this.file(code), this.plainFile(code), `${this.file(code)}.tmp`]) await rm(file, { force: true })
    return had
  }

  // Every save in the folder, newest first.
  async list(): Promise<WorldSave[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return []
    }
    const codes = new Set(names.flatMap((name) => /^([A-Z0-9]{1,12})\.json(\.gz)?$/.exec(name)?.[1] ?? []))
    const saves: WorldSave[] = []
    for (const code of codes) {
      const save = await this.read(code)
      if (save) saves.push(save)
    }
    return saves.sort((a, b) => b.savedAt - a.savedAt)
  }
}
