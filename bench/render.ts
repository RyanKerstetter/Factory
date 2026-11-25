// Runs the render benchmark (apps/client/render-bench.html: the game's 3D view drawing scenes that stress it) in a
// headless Chrome, and prints what it measured. `npm run bench:render`, or with options after `--`:
//   --software      draw without the graphics card (SwiftShader): about what a computer with no graphics card to
//                   speak of manages, the slowest case there is
//   --scene=forest  one scene only; --zoom=1.5 another zoom; --frames=300 more frames a scene
//   --shot=x.png    a picture of the last scene drawn, to see what was measured
// It finds Chrome (or Edge) where they are usually installed; set CHROME to its path if it is elsewhere.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const software = args.includes('--software')
const shot = args.find((arg) => arg.startsWith('--shot='))?.slice('--shot='.length)
const query = new URLSearchParams()
for (const arg of args) {
  const [, key, value] = /^--(scene|zoom|frames|seed)=(.+)$/.exec(arg) ?? []
  if (key) query.set(key, value)
}

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
const chrome = CANDIDATES.find((path): path is string => path !== undefined && existsSync(path))
if (!chrome) {
  console.error('No Chrome found: set CHROME to the path of Chrome or Edge.')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '../apps/client')
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'error', server: { port: 0, strictPort: false } })
await server.listen()
const address = server.httpServer?.address()
const port = typeof address === 'object' && address ? address.port : 0
const profile = mkdtempSync(join(tmpdir(), 'render-bench-'))
const flags = [
  '--headless=new',
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=0',
  '--window-size=1280,720',
  '--no-first-run',
  ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist']),
  `http://localhost:${port}/render-bench.html?${query}`,
]
const browser = spawn(chrome, flags, { stdio: 'ignore' })

const finish = async (code: number): Promise<never> => {
  browser.kill()
  await server.close()
  // Chrome lets go of its profile a moment after it closes.
  await new Promise((done) => setTimeout(done, 500))
  rmSync(profile, { recursive: true, force: true })
  process.exit(code)
}

// Chrome says which port it listens on in its profile, once it is up.
const portFile = join(profile, 'DevToolsActivePort')
const started = Date.now()
while (!existsSync(portFile)) {
  if (Date.now() - started > 20_000) {
    console.error('Chrome did not start.')
    await finish(1)
  }
  await new Promise((done) => setTimeout(done, 100))
}
const debugPort = readFileSync(portFile, 'utf8').split('\n')[0]
let pages: Array<{ type: string; webSocketDebuggerUrl: string }> = []
while (!pages.some((page) => page.type === 'page')) pages = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as typeof pages
const socket = new WebSocket(pages.find((page) => page.type === 'page')!.webSocketDebuggerUrl)
await new Promise((done) => socket.addEventListener('open', done, { once: true }))

let nextId = 1
// Sends a DevTools command, and gives its result.
const send = <T>(method: string, params: object): Promise<T> =>
  new Promise((done) => {
    const id = nextId++
    const answer = (event: MessageEvent): void => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: T }
      if (message.id !== id) return
      socket.removeEventListener('message', answer)
      done(message.result as T)
    }
    socket.addEventListener('message', answer)
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression: string): Promise<string> =>
  (await send<{ result?: { value?: string } }>('Runtime.evaluate', { expression })).result?.value ?? ''

// What goes wrong on the page is printed (errors written to its console, a shader that will not compile among them),
// and an error nothing caught ends the run, as the page will not finish.
let failed = false
socket.addEventListener('message', (event: MessageEvent) => {
  const message = JSON.parse(String(event.data)) as {
    method?: string
    params?: { type?: string; args?: Array<{ value?: unknown; description?: string }>; exceptionDetails?: { text?: string; exception?: { description?: string } } }
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    console.error('page error:', (message.params.args ?? []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' '))
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params?.exceptionDetails
    console.error('page error:', details?.exception?.description ?? details?.text ?? 'an exception')
    failed = true
  }
})
await send('Runtime.enable', {})

// Prints each scene's line as it comes, until it is done (or has taken far too long).
let shown = 0
const deadline = Date.now() + 15 * 60_000
for (;;) {
  const text = await evaluate(`document.getElementById('out')?.textContent ?? ''`)
  const lines = text.split('\n')
  if (lines.length > 1) {
    for (const line of lines.slice(shown)) if (line !== 'done') console.log(line)
    shown = lines.length
  }
  if (lines.at(-1) === 'done' || failed || Date.now() > deadline) break
  await new Promise((done) => setTimeout(done, 1000))
}
if (shot) {
  const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shot, Buffer.from(data, 'base64'))
  console.log(`(the last scene drawn is in ${shot})`)
}
socket.close()
await finish(failed ? 1 : 0)
