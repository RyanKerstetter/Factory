import { createOverlayCanvas, easeToward, type OverlaySize } from './overlay-canvas.ts'

// The cold, seen: frost creeping in over the edges of the view as the player's body cools (see frostOf in cold.ts),
// on a canvas of its own over the world. Nothing at all while the body is warm; a rim of rime as it gets cold; ferns of
// ice reaching further and further in as it freezes; and, in deadly cold, nearly closed in, the ice throbbing with each
// hurt. The ice is drawn once (for the size of the view) and uncovered from the edges inwards, so it creeps rather than
// fades.

// How fast the frost follows the body, per second (it eases, so it creeps in and thaws out).
const EASE_PER_SECOND = 0.5
// How far in, as a share of the way from the edge to the middle, the ice reaches when the body is at its coldest.
const FULL_REACH = 0.78

export type FrostView = {
  // How frozen the player is now (0 to 1), and the ms since the last frame.
  update(target: number, elapsedMs: number): void
  dispose(): void
}

export function createFrostView(container: HTMLElement): FrostView {
  // The ice, drawn over the whole view (the size of the view), to be uncovered.
  const ice = document.createElement('canvas')
  let shown = -1
  let amount = 0
  let time = 0

  // Rime thick at the edges, frosted in soft blotches, with a few fine ferns of ice growing in from them.
  const drawIce = ({ width, height, ratio }: OverlaySize): void => {
    ice.width = Math.max(1, Math.round(width * ratio))
    ice.height = Math.max(1, Math.round(height * ratio))
    const paint = ice.getContext('2d')
    if (!paint) return
    paint.setTransform(ratio, 0, 0, ratio, 0, 0)
    paint.clearRect(0, 0, width, height)
    const middle = { x: width / 2, y: height / 2 }
    const reach = Math.hypot(middle.x, middle.y)
    // How near the edge a point is, 0 (the middle) to 1 (a corner).
    const edgeness = (x: number, y: number): number => Math.hypot(x - middle.x, y - middle.y) / reach
    const rime = paint.createRadialGradient(middle.x, middle.y, reach * 0.2, middle.x, middle.y, reach)
    for (let i = 0; i <= 12; i++) {
      const t = i / 12
      rime.addColorStop(t, `rgba(222, 238, 250, ${(0.62 * t * t * t).toFixed(3)})`)
    }
    paint.fillStyle = rime
    paint.fillRect(0, 0, width, height)
    // Frosted blotches, thicker towards the edges.
    const blotches = Math.round((width * height) / 900)
    for (let i = 0; i < blotches; i++) {
      const x = Math.random() * width
      const y = Math.random() * height
      const near = edgeness(x, y)
      if (Math.random() > near * near) continue
      const r = 6 + Math.random() * 26
      const soft = paint.createRadialGradient(x, y, 0, x, y, r)
      soft.addColorStop(0, `rgba(235, 246, 255, ${(0.08 + 0.1 * near).toFixed(3)})`)
      soft.addColorStop(1, 'rgba(235, 246, 255, 0)')
      paint.fillStyle = soft
      paint.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // A few fine ferns of ice, feathered and faint.
    const fern = (x: number, y: number, angle: number, length: number, depth: number): void => {
      if (depth === 0 || length < 4) return
      const ex = x + Math.cos(angle) * length
      const ey = y + Math.sin(angle) * length
      paint.lineWidth = Math.max(0.5, depth * 0.3)
      paint.strokeStyle = `rgba(246, 252, 255, ${(0.1 + depth * 0.06).toFixed(3)})`
      paint.beginPath()
      paint.moveTo(x, y)
      paint.lineTo(ex, ey)
      paint.stroke()
      // Feathers all along it, both sides, short and swept forward.
      const feathers = Math.floor(length / 7)
      for (let f = 1; f <= feathers; f++) {
        const along = f / (feathers + 1)
        for (const side of [-1, 1]) fern(x + (ex - x) * along, y + (ey - y) * along, angle + side * 0.75, length * 0.32 * (1 - along * 0.5), depth - 1)
      }
    }
    const perimeter = 2 * (width + height)
    const count = Math.round(perimeter / 70)
    for (let i = 0; i < count; i++) {
      const along = Math.random() * perimeter
      let x: number
      let y: number
      if (along < width) [x, y] = [along, 0]
      else if (along < width + height) [x, y] = [width, along - width]
      else if (along < 2 * width + height) [x, y] = [along - width - height, height]
      else [x, y] = [0, along - 2 * width - height]
      const inward = Math.atan2(middle.y - y, middle.x - x) + (Math.random() - 0.5) * 0.9
      fern(x, y, inward, 40 + Math.random() * reach * 0.28, 3)
    }
  }

  // Drawn again for each size of the view.
  const { canvas, context, dispose } = createOverlayCanvas(container, 'frost', (size) => {
    drawIce(size)
    shown = -1
  })

  return {
    update(target, elapsedMs) {
      if (!context) return
      const seconds = elapsedMs / 1000
      time += seconds
      amount = easeToward(amount, target, EASE_PER_SECOND, seconds)
      // In deadly cold the ice throbs.
      const throb = amount > 0.97 ? 0.05 * Math.sin(time * 6) : 0
      const level = Math.max(0, Math.min(1, amount + throb))
      if (Math.abs(level - shown) < 0.003) return
      shown = level
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (level <= 0.002) return
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = Math.min(1, level * 2.2)
      context.drawImage(ice, 0, 0)
      context.globalAlpha = 1
      // The clear middle, shrinking as the ice creeps in: everything inside it is wiped away, softly at its edge.
      const middle = { x: canvas.width / 2, y: canvas.height / 2 }
      const reach = Math.hypot(middle.x, middle.y)
      const clear = reach * (1 - FULL_REACH * level)
      const hole = context.createRadialGradient(middle.x, middle.y, clear * 0.55, middle.x, middle.y, clear)
      hole.addColorStop(0, 'rgba(0, 0, 0, 1)')
      hole.addColorStop(1, 'rgba(0, 0, 0, 0)')
      context.globalCompositeOperation = 'destination-out'
      context.save()
      // An oval, the shape of the view, so the ice comes in as evenly from the sides as from the top and bottom.
      context.translate(middle.x, middle.y)
      context.scale(canvas.width / Math.max(1, canvas.height) / 1.25, 1)
      context.translate(-middle.x, -middle.y)
      context.fillStyle = hole
      context.fillRect(-canvas.width, -canvas.height, canvas.width * 3, canvas.height * 3)
      context.restore()
      context.globalCompositeOperation = 'source-over'
    },
    dispose,
  }
}
