import { defineConfig } from 'vite'

// One public web port: the page talks only to this server, which forwards the game API and the Geckos signalling to
// the game server on the same machine. Besides this port, only the WebRTC UDP port has to be reachable.
const apiPort = process.env.API_PORT ?? '9300'
const geckosPort = process.env.GECKOS_PORT ?? '9301'
const webPort = Number(process.env.CLIENT_PORT ?? 5173)

const serverOptions = {
  host: true,
  port: webPort,
  strictPort: true,
  allowedHosts: true as const,
  proxy: {
    '/api': `http://127.0.0.1:${apiPort}`,
    '/.wrtc': `http://127.0.0.1:${geckosPort}`,
  },
}

export default defineConfig({
  server: serverOptions,
  preview: serverOptions,
})
