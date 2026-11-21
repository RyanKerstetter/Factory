// The snowstorm: snow blowing across the view in the cold, over whichever view draws the world, on a canvas of its
// own. How heavy it is (0 to 1, see snowAt in terrain.ts) sets how many flakes there are, how hard the wind drives
// them, and how white the edges of the view go, so the deep cold is a near whiteout. It eases from one strength to
// the next, so walking into the cold the snow thickens rather than switching on.

const MAX_FLAKES = 900
// How fast the strength follows where the player is, per second.
const EASE_PER_SECOND = 0.6

type Flake = { x: number; y: number; size: number; speed: number; drift: number; phase: number; alpha: number }

export type Snowstorm = {
  // How heavy the snow should be now, and the ms since the last frame.
  update(target: number, elapsedMs: number): void
  dispose(): void
}

export function createSnowstorm(container: HTMLElement): Snowstorm {
  const canvas = document.createElement('canvas')
  canvas.className = 'snowstorm'
  container.append(canvas)
  const context = canvas.getContext('2d')
  const flakes: Flake[] = []
  let strength = 0
  let width = 0
  let height = 0
  let time = 0

  const fit = (): void => {
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    width = container.clientWidth
    height = container.clientHeight
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    context?.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  fit()
  const resize = new ResizeObserver(fit)
  resize.observe(container)

  const newFlake = (anywhere: boolean): Flake => ({
    x: Math.random() * (width + 200) - 100,
    y: anywhere ? Math.random() * height : -10 - Math.random() * 40,
    size: 1 + Math.random() * Math.random() * 3.2,
    speed: 0.6 + Math.random() * 0.8,
    drift: Math.random() * 2 - 1,
    phase: Math.random() * Math.PI * 2,
    alpha: 0.55 + Math.random() * 0.45,
  })

  return {
    update(target, elapsedMs) {
      if (!context) return
      const seconds = elapsedMs / 1000
      time += seconds
      const step = EASE_PER_SECOND * seconds
      strength += Math.max(-step, Math.min(step, target - strength))
      if (strength < 0.002) {
        if (flakes.length > 0 || canvas.style.opacity !== '0') {
          flakes.length = 0
          context.clearRect(0, 0, width, height)
          canvas.style.opacity = '0'
        }
        return
      }
      canvas.style.opacity = '1'
      // More flakes the heavier it snows; new ones start anywhere so a storm does not arrive in a single sheet.
      const wanted = Math.round(MAX_FLAKES * strength * strength + 60 * strength)
      while (flakes.length < wanted) flakes.push(newFlake(true))
      if (flakes.length > wanted) flakes.length = wanted
      // The wind blows to the right and gusts; harder in a heavier storm.
      const gust = 0.6 + 0.4 * Math.sin(time * 0.7) * Math.sin(time * 1.9 + 1)
      const wind = (60 + 520 * strength) * gust
      const fall = 70 + 260 * strength

      context.clearRect(0, 0, width, height)
      // A white haze over everything, thickest at the edges.
      const haze = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.75)
      // Many stops along a smooth curve, so the haze has no rings in it.
      const inner = 0.12 * strength
      const outer = 0.7 * strength * strength + 0.12 * strength
      for (let i = 0; i <= 8; i++) {
        const t = i / 8
        haze.addColorStop(t, `rgba(235, 242, 250, ${(inner + (outer - inner) * t * t * (3 - 2 * t)).toFixed(4)})`)
      }
      context.fillStyle = haze
      context.fillRect(0, 0, width, height)

      context.fillStyle = '#ffffff'
      context.strokeStyle = '#ffffff'
      context.lineCap = 'round'
      for (let i = 0; i < flakes.length; i++) {
        const flake = flakes[i]
        const dx = (wind * flake.speed + Math.sin(time * 2 + flake.phase) * 25 * (1 + flake.drift)) * seconds
        const dy = fall * flake.speed * seconds
        flake.x += dx
        flake.y += dy
        if (flake.y > height + 10 || flake.x > width + 100 || flake.x < -100) {
          const fresh = newFlake(false)
          // In a strong wind, flakes come in from the left side as well as the top.
          if (Math.random() < Math.min(0.6, wind / 900)) {
            fresh.x = -20
            fresh.y = Math.random() * height
          }
          flakes[i] = fresh
          continue
        }
        context.globalAlpha = flake.alpha * Math.min(1, 0.4 + strength)
        // In a strong wind the flakes streak.
        const streak = Math.min(18, Math.hypot(dx, dy) * 0.9)
        if (streak > 3 && strength > 0.45) {
          context.lineWidth = flake.size
          context.beginPath()
          context.moveTo(flake.x, flake.y)
          context.lineTo(flake.x - dx * (streak / Math.max(1, Math.hypot(dx, dy))), flake.y - dy * (streak / Math.max(1, Math.hypot(dx, dy))))
          context.stroke()
        } else {
          context.beginPath()
          context.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2)
          context.fill()
        }
      }
      context.globalAlpha = 1
    },
    dispose() {
      resize.disconnect()
      canvas.remove()
    },
  }
}
