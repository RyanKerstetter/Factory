import { z } from 'zod'
import { BUILDING_KINDS } from './buildings.ts'
import { ALL_KEYS } from './movement.ts'

// Checks for what a page sends the server, which the server trusts nothing of. Kept apart from protocol.ts so the
// page's bundle does not carry the validation library it never uses.

const int = z.number().int().safe()
const tile = int.min(-1_000_000).max(1_000_000)
const item = int.min(0).max(1_000)
const slotRef = z.object({ id: int.min(0), i: int.min(0).max(255) })

export const CommandSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('build'), x: tile, y: tile, kind: z.enum(BUILDING_KINDS as [string, ...string[]]), dir: int.min(0).max(3) }),
  z.object({ k: z.literal('remove'), id: int.min(1) }),
  z.object({ k: z.literal('take'), id: int.min(1), item, max: int.min(1).max(100_000) }),
  z.object({ k: z.literal('put'), id: int.min(1), item, max: int.min(1).max(100_000) }),
  z.object({ k: z.literal('move'), from: int.min(0).max(255), to: int.min(0).max(255) }),
  z.object({ k: z.literal('slot'), from: slotRef, to: slotRef, count: int.min(1).max(100_000) }),
  z.object({ k: z.literal('drop'), from: slotRef, count: int.min(1).max(100_000), x: int, y: int }),
  z.object({ k: z.literal('punch'), id: int.min(1), slot: int.min(-1).max(255) }),
  z.object({ k: z.literal('attack'), special: z.boolean(), slot: int.min(-1).max(255), x: int, y: int, charge: int.min(0).max(10_000), seen: int.min(0).optional() }),
  z.object({ k: z.literal('craft'), recipe: int.min(1).max(1_000) }),
  z.object({ k: z.literal('work'), id: int.min(1), recipe: int.min(0).max(1_000).optional(), repeat: z.boolean().optional() }),
  z.object({ k: z.literal('apply'), x: tile, y: tile, slot: int.min(0).max(255) }),
  z.object({ k: z.literal('machine'), id: int.min(1), action: z.enum(['light', 'douse', 'seal', 'unseal']) }),
  z.object({ k: z.literal('use'), id: int.min(0) }),
  z.object({ k: z.literal('toggle'), id: int.min(1) }),
  z.object({ k: z.literal('strike'), animal: int.min(1), slot: int.min(-1).max(255) }),
  z.object({ k: z.literal('interact'), animal: int.min(1), slot: int.min(-1).max(255) }),
  z.object({ k: z.literal('place'), x: tile, y: tile, slot: int.min(0).max(255) }),
])

export const RequestMessageSchema = z.object({
  s: int.min(1),
  r: z.discriminatedUnion('k', [
    z.object({ k: z.literal('cmd'), tick: int.min(0), c: CommandSchema }),
    z.object({ k: z.literal('desync'), chunk: int.min(0), tick: int.min(0), hash: int }),
  ]),
})

export const InputMessageSchema = z.object({
  i: z.array(z.tuple([int.min(1), int.min(0).max(ALL_KEYS)])).max(64),
})

export const JoinMessageSchema = z.object({
  code: z.string().min(1).max(12),
  name: z.string().max(24),
})
export type JoinMessage = z.infer<typeof JoinMessageSchema>

export const AckMessageSchema = z.object({ s: int.min(0) })
export const PingMessageSchema = z.object({ c: z.number().finite() })

export const NewGameSchema = z.object({ name: z.string().max(40), seed: z.string().max(40).optional() })
