// A reliable, ordered stream over Geckos' unreliable, unordered channel. Each message is numbered; the receiver hands
// them on strictly in order (holding back any that come early) and answers with the number of the last one it has
// everything up to; the sender keeps each message until that answer covers it, and sends it again if it is slow.

export type Numbered<T> = T & { s: number }

export type ReliableSenderOptions = {
  // How long to wait for an answer before sending a message again, in milliseconds. It doubles with each try, up to
  // `maxResendMs`.
  resendMs?: number
  maxResendMs?: number
  // The most messages sent again in one `resend` call, so a long outage does not end in a flood.
  maxResendsPerCall?: number
}

type Unanswered<T> = { message: Numbered<T>; sentAt: number; waitMs: number }

export class ReliableSender<T extends object> {
  private nextSeq = 1
  private unanswered: Unanswered<T>[] = []
  private readonly resendMs: number
  private readonly maxResendMs: number
  private readonly maxResendsPerCall: number

  constructor(private readonly transmit: (message: Numbered<T>) => void, options: ReliableSenderOptions = {}) {
    this.resendMs = options.resendMs ?? 200
    this.maxResendMs = options.maxResendMs ?? 2_000
    this.maxResendsPerCall = options.maxResendsPerCall ?? 32
  }

  // The number the last message sent was given (0 before any).
  get lastSeq(): number {
    return this.nextSeq - 1
  }

  // How many messages are waiting for an answer.
  get pending(): number {
    return this.unanswered.length
  }

  send(payload: T, now = performance.now()): number {
    const message = { ...payload, s: this.nextSeq++ } as Numbered<T>
    this.unanswered.push({ message, sentAt: now, waitMs: this.resendMs })
    this.transmit(message)
    return message.s
  }

  // The receiver has every message up to and including `seq`.
  acknowledge(seq: number): void {
    let drop = 0
    while (drop < this.unanswered.length && this.unanswered[drop].message.s <= seq) drop++
    if (drop > 0) this.unanswered.splice(0, drop)
  }

  // Sends again what has waited too long for an answer, oldest first.
  resend(now = performance.now()): void {
    let sent = 0
    for (const entry of this.unanswered) {
      if (sent >= this.maxResendsPerCall) break
      if (now - entry.sentAt < entry.waitMs) continue
      entry.sentAt = now
      entry.waitMs = Math.min(this.maxResendMs, entry.waitMs * 2)
      this.transmit(entry.message)
      sent++
    }
  }
}

export class ReliableReceiver<T extends object> {
  private next = 1
  private readonly early = new Map<number, Numbered<T>>()

  constructor(private readonly window = 50_000) {}

  // The number of the last message that has been handed on: everything up to it has arrived. This is the answer.
  get acknowledged(): number {
    return this.next - 1
  }

  // Takes a message off the wire, and gives back the messages that can now be handed on, in order: none if it came
  // early or was seen before, and it and any that were waiting on it if it was the next one.
  receive(message: Numbered<T>): Numbered<T>[] {
    const seq = message.s
    if (!Number.isSafeInteger(seq) || seq < this.next || seq >= this.next + this.window) return []
    if (seq !== this.next) {
      this.early.set(seq, message)
      return []
    }
    const ready = [message]
    this.next++
    for (let waiting = this.early.get(this.next); waiting; waiting = this.early.get(this.next)) {
      this.early.delete(this.next)
      ready.push(waiting)
      this.next++
    }
    return ready
  }
}
