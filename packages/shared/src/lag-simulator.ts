// Simulated bad networks, for trying the netcode out: every message in both directions is held back by `latencyMs`
// plus up to `jitterMs` (so they can arrive out of order), and `loss` of them are dropped. Reliability is ours to
// provide (see reliable-stream.ts), so every message can be lost, not only the unreliable ones.
export type LagConfig = { latencyMs: number; jitterMs: number; loss: number }

type Channel = {
  emit(event: string, data?: any, options?: any): unknown
  on(event: string, callback: (data: any) => void): unknown
}

export function withLag<T extends Channel>(channel: T, config: Partial<LagConfig> = {}): { channel: T; config: LagConfig } {
  const lag: LagConfig = { latencyMs: 0, jitterMs: 0, loss: 0, ...config }
  const later = (deliver: () => void): void => {
    if (lag.loss > 0 && Math.random() < lag.loss) return
    const delay = lag.latencyMs + Math.random() * lag.jitterMs
    if (delay <= 0) deliver()
    else setTimeout(deliver, delay)
  }
  const wrapped = new Proxy(channel, {
    get(target, property, receiver) {
      if (property === 'emit') {
        return (event: string, data?: unknown, options?: unknown) => later(() => target.emit(event, data, options))
      }
      if (property === 'on') {
        return (event: string, callback: (data: unknown) => void) => target.on(event, (data) => later(() => callback(data)))
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { channel: wrapped, config: lag }
}

// Reads `?lag=<ms>&jitter=<ms>&loss=<0 to 1>` from a page's address.
export function lagConfigFromQuery(search: string): Partial<LagConfig> | undefined {
  const params = new URLSearchParams(search)
  const read = (key: string): number | undefined => {
    const value = Number(params.get(key) ?? NaN)
    return Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const latencyMs = read('lag')
  const jitterMs = read('jitter')
  const loss = read('loss')
  if (latencyMs === undefined && jitterMs === undefined && loss === undefined) return undefined
  return {
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(jitterMs !== undefined ? { jitterMs } : {}),
    ...(loss !== undefined ? { loss: Math.min(1, loss) } : {}),
  }
}
