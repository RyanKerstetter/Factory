// How each liquid looks on the page: its colour (in a barrel, see models.ts) and the class it is shown with in panels
// (`is-<tone>` on a gauge or a drop: see style.css). By name, as items.json's `bucket`s name them; one not listed looks
// like water.
export type LiquidTone = 'water' | 'salt' | 'tannin' | 'milk' | 'blood' | 'honey'
const LOOKS: Readonly<Record<string, { color: number; tone: LiquidTone }>> = {
  water: { color: 0x3a74b0, tone: 'water' },
  'salt water': { color: 0x3f8aa0, tone: 'salt' },
  tannin: { color: 0x7a4a22, tone: 'tannin' },
  milk: { color: 0xf0ece0, tone: 'milk' },
  blood: { color: 0x7a0f1a, tone: 'blood' },
  honey: { color: 0xe0961a, tone: 'honey' },
}

export function liquidLook(name: string | undefined): { color: number; tone: LiquidTone } {
  return LOOKS[name ?? ''] ?? LOOKS.water
}
