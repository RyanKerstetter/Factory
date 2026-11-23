// A canvas laid over the whole view for an effect drawn on the screen (the snowstorm, the frost), kept the size of its
// container at the screen's pixel ratio (at most 2, which is sharp enough for soft shapes).

// The view's size in CSS pixels, and how many of the canvas's pixels make one.
export type OverlaySize = { width: number; height: number; ratio: number }

export type OverlayCanvas = {
  readonly canvas: HTMLCanvasElement
  // Undefined where the browser gives no 2D drawing (the effect is then left out).
  readonly context: CanvasRenderingContext2D | undefined
  readonly size: Readonly<OverlaySize>
  dispose(): void
}

// `fitted` is told the new size each time the canvas is sized to the view (first while this is being made).
export function createOverlayCanvas(container: HTMLElement, className: string, fitted: (size: OverlaySize) => void = () => {}): OverlayCanvas {
  const canvas = document.createElement('canvas')
  canvas.className = className
  container.append(canvas)
  const context = canvas.getContext('2d') ?? undefined
  const size: OverlaySize = { width: 0, height: 0, ratio: 1 }
  const fit = (): void => {
    size.ratio = Math.min(2, window.devicePixelRatio || 1)
    size.width = container.clientWidth
    size.height = container.clientHeight
    canvas.width = Math.max(1, Math.round(size.width * size.ratio))
    canvas.height = Math.max(1, Math.round(size.height * size.ratio))
    fitted(size)
  }
  fit()
  const resize = new ResizeObserver(fit)
  resize.observe(container)
  return {
    canvas,
    context,
    size,
    dispose() {
      resize.disconnect()
      canvas.remove()
    },
  }
}

// An effect's strength eased towards where it should be at `perSecond` a second, over `seconds`, so it comes on and
// goes off gradually rather than at once.
export function easeToward(from: number, to: number, perSecond: number, seconds: number): number {
  const step = perSecond * seconds
  return from + Math.max(-step, Math.min(step, to - from))
}
