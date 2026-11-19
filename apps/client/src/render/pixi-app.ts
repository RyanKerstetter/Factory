import { Application } from 'pixi.js'

// A Pixi application filling `container`, resized with it, drawn at the screen's own pixel density, with whole-pixel
// positions so pixel art stays sharp.
export async function createPixiApp(container: HTMLElement): Promise<Application> {
  const app = new Application()
  await app.init({
    background: '#171915',
    resizeTo: container,
    antialias: false,
    autoDensity: true,
    roundPixels: true,
    resolution: window.devicePixelRatio || 1,
  })
  container.replaceChildren(app.canvas)
  return app
}
