// Stand-in art, drawn on a small canvas, for every picture that has no file in res/ yet. Each is flat colour on a
// PLACEHOLDER_SIZE grid, so it sits with pixel art. Buildings that face a way are drawn facing east (right).
export const PLACEHOLDER_SIZE = 32

export type Painter = (g: CanvasRenderingContext2D) => void

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

// A colour made darker (amount below 1) or lighter (above 1).
function shade(color: number, amount: number): string {
  const channel = (shift: number): number => Math.max(0, Math.min(255, Math.round(((color >> shift) & 255) * amount)))
  return hex((channel(16) << 16) | (channel(8) << 8) | channel(0))
}

function rect(g: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  g.fillStyle = color
  g.fillRect(x, y, w, h)
}

function circle(g: CanvasRenderingContext2D, color: string, x: number, y: number, r: number): void {
  g.fillStyle = color
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
}

const GROUND = 0x3f5a30

// Grass: one flat green, a darker line on two edges so the tiles read as a grid, and a few blades.
export const ground: Painter = (g) => {
  rect(g, hex(GROUND), 0, 0, 32, 32)
  rect(g, shade(GROUND, 0.9), 0, 31, 32, 1)
  rect(g, shade(GROUND, 0.9), 31, 0, 1, 32)
  for (const [x, y] of [[5, 7], [19, 4], [26, 18], [11, 22], [3, 27], [22, 27]]) {
    rect(g, shade(GROUND, 1.18), x, y, 1, 2)
    rect(g, shade(GROUND, 1.1), x + 2, y + 1, 1, 2)
  }
}

// ---- plants, seen from above. A tree is drawn larger than its tile (see building-layer.ts), so its canopy spreads.

// A tree: a round canopy in three greens over a shadow, with a little of the trunk showing at the bottom.
export const tree: Painter = (g) => {
  g.fillStyle = 'rgba(0, 0, 0, 0.28)'
  g.beginPath()
  g.ellipse(17, 26, 11, 5, 0, 0, Math.PI * 2)
  g.fill()
  rect(g, '#4a3220', 14, 21, 5, 8)
  rect(g, '#6b4a2c', 15, 21, 2, 8)
  circle(g, '#1f4a24', 16, 14, 13)
  circle(g, '#2c6631', 15, 13, 11)
  circle(g, '#3a7f3b', 11, 10, 6)
  circle(g, '#3a7f3b', 20, 15, 5)
  circle(g, '#3a7f3b', 17, 7, 4)
  rect(g, '#5aa84f', 9, 7, 3, 2)
  rect(g, '#5aa84f', 19, 12, 2, 2)
}

// A bush: a low clump of leaves with a few red berries in it.
export const bush: Painter = (g) => {
  g.fillStyle = 'rgba(0, 0, 0, 0.25)'
  g.beginPath()
  g.ellipse(16, 24, 12, 5, 0, 0, Math.PI * 2)
  g.fill()
  circle(g, '#24502a', 11, 18, 8)
  circle(g, '#24502a', 21, 18, 8)
  circle(g, '#2f6a35', 16, 13, 9)
  circle(g, '#3c8240', 13, 12, 4)
  circle(g, '#3c8240', 21, 16, 3)
  for (const [x, y] of [[10, 17], [19, 11], [22, 20], [14, 21], [17, 16]]) {
    rect(g, '#8e1c33', x, y + 1, 3, 2)
    rect(g, '#d6344f', x, y, 2, 2)
  }
}

// A berry sprout: a small, young clump of light green leaves, with no berries yet (they come when it is a bush).
export const berrySprout: Painter = (g) => {
  g.fillStyle = 'rgba(0, 0, 0, 0.25)'
  g.beginPath()
  g.ellipse(16, 24, 9, 4, 0, 0, Math.PI * 2)
  g.fill()
  circle(g, '#2f6a35', 12, 19, 6)
  circle(g, '#2f6a35', 20, 19, 6)
  circle(g, '#4a9a45', 16, 15, 7)
  circle(g, '#6fbf4a', 14, 13, 3)
  circle(g, '#6fbf4a', 19, 17, 2)
}

// A sapling: a thin stem with two pairs of leaves. It is drawn bigger as it grows.
export const sapling: Painter = (g) => {
  g.fillStyle = 'rgba(0, 0, 0, 0.25)'
  g.beginPath()
  g.ellipse(16, 27, 7, 3, 0, 0, Math.PI * 2)
  g.fill()
  rect(g, '#5b3d22', 15, 12, 2, 15)
  for (const [x, y, w] of [[8, 12, 7], [17, 9, 7], [10, 18, 5], [17, 16, 6]]) {
    rect(g, '#2f6a35', x, y, w, 4)
    rect(g, '#5aa84f', x + 1, y, w - 2, 2)
  }
}

// ---- items gathered from plants

export const log: Painter = (g) => {
  rect(g, '#4a3220', 4, 11, 22, 12)
  rect(g, '#7a5233', 4, 12, 22, 9)
  rect(g, '#5e3f25', 6, 15, 16, 1)
  circle(g, '#4a3220', 26, 17, 6)
  circle(g, '#c9a06a', 26, 17, 5)
  circle(g, '#a77b4f', 26, 17, 3)
  circle(g, '#c9a06a', 26, 17, 1)
}

export const stick: Painter = (g) => {
  for (let i = 0; i < 20; i++) {
    rect(g, '#5e3f25', 6 + i, 25 - i, 3, 2)
    rect(g, '#a77b4f', 6 + i, 24 - i, 2, 1)
  }
  rect(g, '#5e3f25', 17, 9, 2, 5)
  rect(g, '#a77b4f', 17, 9, 1, 4)
}

export const acorn: Painter = (g) => {
  circle(g, '#6e4a1f', 16, 19, 8)
  circle(g, '#a8742f', 15, 18, 7)
  rect(g, '#d9a75a', 12, 15, 2, 3)
  rect(g, '#4a3220', 8, 9, 16, 6)
  rect(g, '#6b4a2c', 9, 10, 14, 3)
  rect(g, '#4a3220', 15, 5, 2, 4)
}

export const twine: Painter = (g) => {
  g.strokeStyle = '#7d7547'
  g.lineWidth = 3
  for (const r of [10, 7, 4]) {
    g.beginPath()
    g.arc(16, 16, r, 0.3, Math.PI * 2 - 0.3)
    g.stroke()
  }
  g.strokeStyle = '#cfc78e'
  g.lineWidth = 1
  for (const r of [10, 7, 4]) {
    g.beginPath()
    g.arc(16, 16, r, 0.3, Math.PI * 2 - 0.3)
    g.stroke()
  }
  rect(g, '#7d7547', 25, 18, 4, 2)
}

export const berries: Painter = (g) => {
  rect(g, '#2f6a35', 14, 4, 6, 4)
  rect(g, '#5b3d22', 16, 7, 1, 5)
  for (const [x, y] of [[12, 15], [20, 15], [16, 21], [10, 22], [22, 22]]) {
    circle(g, '#8e1c33', x, y, 5)
    circle(g, '#d6344f', x - 1, y - 1, 4)
    rect(g, '#f4a0ae', x - 3, y - 3, 2, 2)
  }
}

// Ground with nuggets of an ore showing through.
export function oreTile(color: number): Painter {
  return (g) => {
    ground(g)
    const nuggets = [[4, 5], [14, 3], [23, 8], [8, 14], [18, 16], [26, 22], [5, 24], [15, 26]]
    for (const [x, y] of nuggets) {
      rect(g, shade(color, 0.55), x, y + 1, 4, 3)
      rect(g, hex(color), x, y, 3, 3)
      rect(g, shade(color, 1.25), x, y, 1, 1)
    }
  }
}

// A rock, seen from above: a lumpy grey boulder over a shadow, lit from the top left, with a crack and a fleck of flint.
export const rock: Painter = (g) => {
  g.fillStyle = 'rgba(0, 0, 0, 0.3)'
  g.beginPath()
  g.ellipse(17, 25, 13, 5, 0, 0, Math.PI * 2)
  g.fill()
  circle(g, '#55585e', 11, 18, 8)
  circle(g, '#55585e', 21, 19, 8)
  circle(g, '#55585e', 16, 13, 9)
  circle(g, '#7b7e85', 15, 13, 7)
  circle(g, '#7b7e85', 10, 17, 5)
  circle(g, '#7b7e85', 21, 17, 5)
  circle(g, '#9a9da3', 12, 10, 3)
  rect(g, '#3f4247', 18, 12, 1, 4)
  rect(g, '#3f4247', 19, 16, 1, 3)
  rect(g, '#2e3340', 9, 19, 3, 2)
}

// ---- items from rocks, and tools

// A piece of flint: a dark, glassy, sharp-edged flake.
export const flint: Painter = (g) => {
  g.fillStyle = '#2e3340'
  g.beginPath()
  g.moveTo(8, 22)
  g.lineTo(14, 7)
  g.lineTo(25, 11)
  g.lineTo(23, 24)
  g.lineTo(13, 27)
  g.closePath()
  g.fill()
  g.fillStyle = '#4a5162'
  g.beginPath()
  g.moveTo(12, 20)
  g.lineTo(15, 10)
  g.lineTo(22, 13)
  g.lineTo(18, 21)
  g.closePath()
  g.fill()
  rect(g, '#8b93a8', 15, 11, 3, 2)
}

// A lump of stone: rounded and grey.
export const stone: Painter = (g) => {
  circle(g, '#5d6066', 16, 18, 10)
  circle(g, '#8d8f94', 15, 17, 8)
  circle(g, '#a9abaf', 12, 14, 3)
  rect(g, '#5d6066', 18, 19, 3, 1)
}

// A handle: a stick from the bottom left to the top right, bound near the top with twine.
function handle(g: CanvasRenderingContext2D): void {
  for (let i = 0; i < 18; i++) {
    rect(g, '#5e3f25', 5 + i, 26 - i, 3, 2)
    rect(g, '#a77b4f', 5 + i, 25 - i, 2, 1)
  }
  rect(g, '#cfc78e', 17, 11, 4, 2)
  rect(g, '#cfc78e', 18, 13, 4, 1)
}

export const pickaxe: Painter = (g) => {
  handle(g)
  g.fillStyle = '#2e3340'
  g.beginPath()
  g.moveTo(9, 6)
  g.quadraticCurveTo(20, 3, 28, 14)
  g.lineTo(25, 15)
  g.quadraticCurveTo(19, 9, 9, 9)
  g.closePath()
  g.fill()
  rect(g, '#8b93a8', 14, 6, 4, 1)
}

export const axe: Painter = (g) => {
  handle(g)
  g.fillStyle = '#2e3340'
  g.beginPath()
  g.moveTo(17, 7)
  g.lineTo(23, 2)
  g.lineTo(29, 9)
  g.lineTo(24, 14)
  g.closePath()
  g.fill()
  g.fillStyle = '#4a5162'
  g.beginPath()
  g.moveTo(22, 4)
  g.lineTo(28, 9)
  g.lineTo(25, 11)
  g.closePath()
  g.fill()
}

export const knife: Painter = (g) => {
  for (let i = 0; i < 9; i++) {
    rect(g, '#5e3f25', 5 + i, 26 - i, 3, 2)
    rect(g, '#a77b4f', 5 + i, 25 - i, 2, 1)
  }
  rect(g, '#cfc78e', 12, 18, 3, 2)
  g.fillStyle = '#2e3340'
  g.beginPath()
  g.moveTo(13, 17)
  g.lineTo(27, 4)
  g.lineTo(18, 20)
  g.closePath()
  g.fill()
  rect(g, '#8b93a8', 20, 10, 2, 1)
}

// An item: a cut gem in its colour.
export function item(color: number): Painter {
  return (g) => {
    g.fillStyle = shade(color, 0.5)
    g.beginPath()
    g.moveTo(16, 3)
    g.lineTo(29, 16)
    g.lineTo(16, 29)
    g.lineTo(3, 16)
    g.closePath()
    g.fill()
    g.fillStyle = hex(color)
    g.beginPath()
    g.moveTo(16, 6)
    g.lineTo(26, 16)
    g.lineTo(16, 26)
    g.lineTo(6, 16)
    g.closePath()
    g.fill()
    rect(g, shade(color, 1.35), 12, 11, 4, 3)
  }
}

const BELT_BASE = '#2a2c2d'
const BELT_RAIL = '#191a1b'
const BELT_TRACK = '#3a3d3f'
const BELT_MARK = '#d29e1c'

function chevron(g: CanvasRenderingContext2D, x: number): void {
  for (let i = 0; i < 6; i++) {
    rect(g, BELT_MARK, x + i, 10 + i, 2, 1)
    rect(g, BELT_MARK, x + i, 21 - i, 2, 1)
  }
}

// A straight belt carrying east: rails top and bottom, a track between and two chevrons.
export const belt: Painter = (g) => {
  rect(g, BELT_BASE, 0, 0, 32, 32)
  rect(g, BELT_RAIL, 0, 3, 32, 3)
  rect(g, BELT_RAIL, 0, 26, 32, 3)
  rect(g, BELT_TRACK, 0, 7, 32, 18)
  chevron(g, 6)
  chevron(g, 20)
}

// A belt that turns: in at the top (its left side) and out at the right, round the top right corner.
export const beltCurve: Painter = (g) => {
  rect(g, BELT_BASE, 0, 0, 32, 32)
  const ring = (outer: number, inner: number, color: string): void => {
    g.fillStyle = color
    g.beginPath()
    g.arc(32, 0, outer, Math.PI / 2, Math.PI)
    g.arc(32, 0, inner, Math.PI, Math.PI / 2, true)
    g.closePath()
    g.fill()
  }
  ring(29, 3, BELT_RAIL)
  ring(25, 7, BELT_TRACK)
  // A chevron where items come in, pointing down, and one where they leave, pointing right.
  for (let i = 0; i < 5; i++) {
    rect(g, BELT_MARK, 11 + i, 4 + i, 1, 2)
    rect(g, BELT_MARK, 19 - i, 4 + i, 1, 2)
    rect(g, BELT_MARK, 22 + i, 12 + i, 2, 1)
    rect(g, BELT_MARK, 22 + i, 20 - i, 2, 1)
  }
}

const CLAW = 0x3b9a92

// An extractor: a belt with a teal clamp across its back end, where it pulls from.
export const extractor: Painter = (g) => {
  belt(g)
  rect(g, shade(CLAW, 0.6), 0, 1, 9, 30)
  rect(g, hex(CLAW), 0, 1, 8, 28)
  rect(g, shade(CLAW, 1.3), 0, 1, 8, 2)
  rect(g, shade(CLAW, 0.6), 3, 8, 2, 16)
}

export const extractorCurve: Painter = (g) => {
  beltCurve(g)
  rect(g, shade(CLAW, 0.6), 1, 0, 30, 9)
  rect(g, hex(CLAW), 1, 0, 28, 8)
  rect(g, shade(CLAW, 1.3), 1, 0, 2, 8)
}

// A miner: a squat frame with a drill head in the middle and a bolt at each corner.
export const miner: Painter = (g) => {
  rect(g, '#4b4134', 1, 1, 30, 30)
  rect(g, '#6a5c48', 2, 2, 28, 28)
  rect(g, '#4b4134', 6, 6, 20, 20)
  rect(g, '#c98a24', 10, 9, 12, 14)
  rect(g, '#c98a24', 9, 10, 14, 12)
  rect(g, '#7a5214', 13, 13, 6, 6)
  rect(g, '#e8b44a', 10, 10, 3, 2)
  for (const [x, y] of [[3, 3], [27, 3], [3, 27], [27, 27]]) rect(g, '#9aa09a', x, y, 2, 2)
}

// A chest: a wooden crate with a metal band and a latch.
export const chest: Painter = (g) => {
  rect(g, '#4a3220', 2, 3, 28, 27)
  rect(g, '#7b5532', 3, 4, 26, 25)
  for (const y of [10, 17, 24]) rect(g, '#5e4026', 3, y, 26, 1)
  rect(g, '#8f969c', 3, 13, 26, 3)
  rect(g, '#d29e1c', 14, 12, 4, 5)
  rect(g, '#5e4026', 15, 14, 2, 2)
}

// A player from above, facing south (down): shoulders, a hard hat, and the hat's brim and a nose at the front.
// A caveman seen from above, facing south (down): a fur tunic over his shoulders, bare arms, shaggy hair and a beard.
export const player: Painter = (g) => {
  rect(g, '#2a1a0e', 3, 12, 26, 11)
  rect(g, '#d8a27a', 4, 13, 4, 8)
  rect(g, '#d8a27a', 24, 13, 4, 8)
  rect(g, '#5e3f25', 7, 11, 18, 12)
  rect(g, '#7a5233', 8, 12, 16, 10)
  rect(g, '#9a7048', 10, 13, 4, 3)
  rect(g, '#9a7048', 18, 17, 4, 3)
  rect(g, '#2a1a0e', 10, 6, 12, 14)
  rect(g, '#4a3220', 11, 7, 10, 9)
  rect(g, '#5e3f25', 13, 8, 4, 3)
  rect(g, '#d8a27a', 12, 15, 8, 4)
  rect(g, '#1c1a16', 13, 16, 2, 1)
  rect(g, '#1c1a16', 17, 16, 2, 1)
  rect(g, '#3a2616', 12, 19, 8, 3)
}

// ---- farming: fences, gates, the stump's neighbours, plots, crops, animals

const WOOD = '#9c7448'
const WOOD_DARK = '#5e3f25'
const WOOD_LIGHT = '#c49562'

// A fence post, and two rails out from it towards each side it joins (`mask`: north 1, east 2, south 4, west 8), so
// fences meeting make I, L, T and X shapes.
export function fence(mask: number): Painter {
  return (g) => {
    const rails = (x: number, y: number, w: number, h: number): void => {
      rect(g, WOOD_DARK, x, y, w, h)
      rect(g, WOOD, x, y, w, Math.max(1, h - 1))
    }
    if (mask & 1) {
      rails(12, 0, 2, 16)
      rails(18, 0, 2, 16)
    }
    if (mask & 4) {
      rails(12, 16, 2, 16)
      rails(18, 16, 2, 16)
    }
    if (mask & 2) {
      rails(16, 11, 16, 3)
      rails(16, 18, 16, 3)
    }
    if (mask & 8) {
      rails(0, 11, 16, 3)
      rails(0, 18, 16, 3)
    }
    rect(g, WOOD_DARK, 11, 10, 10, 12)
    rect(g, WOOD, 12, 11, 8, 10)
    rect(g, WOOD_LIGHT, 12, 11, 8, 2)
  }
}

// A gate across its tile, east to west (`horizontal`) or north to south: two posts and a board between them, swung
// back against one post when it is open.
export function gate(horizontal: boolean, open: boolean): Painter {
  return (g) => {
    const post = (x: number, y: number): void => {
      rect(g, WOOD_DARK, x, y, 6, 6)
      rect(g, WOOD, x + 1, y + 1, 4, 4)
    }
    if (horizontal) {
      post(0, 13)
      post(26, 13)
      if (open) {
        rect(g, WOOD_DARK, 2, 2, 3, 12)
        rect(g, WOOD_LIGHT, 2, 2, 2, 11)
      } else {
        rect(g, WOOD_DARK, 5, 12, 22, 8)
        rect(g, WOOD, 5, 12, 22, 3)
        rect(g, WOOD, 5, 17, 22, 2)
        rect(g, WOOD_LIGHT, 8, 13, 16, 1)
      }
    } else {
      post(13, 0)
      post(13, 26)
      if (open) {
        rect(g, WOOD_DARK, 2, 2, 12, 3)
        rect(g, WOOD_LIGHT, 2, 2, 11, 2)
      } else {
        rect(g, WOOD_DARK, 12, 5, 8, 22)
        rect(g, WOOD, 12, 5, 3, 22)
        rect(g, WOOD, 17, 5, 2, 22)
      }
    }
  }
}

// A garden plot: dark tilled earth in furrows inside a wooden edge.
export const plot: Painter = (g) => {
  rect(g, WOOD_DARK, 1, 1, 30, 30)
  rect(g, '#4a3220', 3, 3, 26, 26)
  for (let y = 6; y < 28; y += 6) rect(g, '#3a2616', 4, y, 24, 2)
  rect(g, WOOD, 1, 1, 30, 2)
}

// A feed box: a wooden trough with hay in it.
export const feeder: Painter = (g) => {
  g.fillStyle = 'rgba(0, 0, 0, 0.25)'
  g.fillRect(3, 24, 28, 5)
  rect(g, WOOD_DARK, 2, 8, 28, 18)
  rect(g, WOOD, 3, 9, 26, 16)
  rect(g, '#d8c27a', 5, 9, 22, 6)
  rect(g, '#b99f55', 7, 11, 18, 2)
  rect(g, WOOD_LIGHT, 3, 15, 26, 2)
}

// A tuft of grass: a few blades in two greens.
export const grass: Painter = (g) => {
  for (const [x, h] of [[9, 12], [12, 16], [15, 18], [18, 14], [21, 11], [24, 9]]) {
    rect(g, '#2f6a35', x, 28 - h, 2, h)
    rect(g, '#5aa84f', x, 28 - h, 1, h - 2)
  }
}

// A crop, by how far it has grown: a sprout, a half-grown plant, or a grown one with golden ears.
export function crop(stage: 'sprout' | 'mid' | 'full'): Painter {
  return (g) => {
    const height = stage === 'sprout' ? 8 : stage === 'mid' ? 16 : 24
    for (const x of [9, 15, 21]) {
      rect(g, '#3c8240', x, 30 - height, 2, height)
      if (stage === 'full') rect(g, '#e3c35a', x - 1, 30 - height, 4, 7)
    }
  }
}

// An animal, until it has a picture: a body and a head in its colour, facing left.
export function animal(color: number): Painter {
  return (g) => {
    g.fillStyle = 'rgba(0, 0, 0, 0.2)'
    g.fillRect(6, 25, 22, 3)
    rect(g, shade(color, 0.7), 9, 21, 3, 5)
    rect(g, shade(color, 0.7), 22, 21, 3, 5)
    rect(g, hex(color), 8, 11, 20, 12)
    rect(g, hex(color), 3, 7, 9, 9)
    rect(g, '#1c1a16', 5, 9, 2, 2)
  }
}

export const steak: Painter = (g) => {
  circle(g, '#7d1f2a', 16, 17, 11)
  circle(g, '#c0394a', 15, 16, 10)
  circle(g, '#f1d3c7', 19, 20, 3)
  rect(g, '#e26a75', 9, 12, 6, 2)
}

export const rawChicken: Painter = (g) => {
  circle(g, '#c98f86', 14, 15, 9)
  circle(g, '#f0b3a8', 13, 14, 8)
  rect(g, '#f2efe6', 20, 20, 8, 3)
  circle(g, '#f2efe6', 28, 21, 3)
}

export const milk: Painter = (g) => {
  rect(g, '#6b5a44', 9, 6, 14, 3)
  rect(g, '#d9d9d2', 8, 9, 16, 19)
  rect(g, '#f4f4f0', 10, 11, 12, 15)
  rect(g, '#5aa0c8', 10, 16, 12, 3)
}

// ---- water, and the workshop: the workbench, campfire, barrel, drying rack, buckets

// Water: a deep blue with a few light ripples.
export const water: Painter = (g) => {
  rect(g, '#2d5f9a', 0, 0, 32, 32)
  for (const [x, y] of [[4, 6], [18, 4], [10, 17], [24, 20], [6, 27]]) {
    rect(g, '#4d8fd1', x, y, 6, 1)
    rect(g, '#6aa8e0', x + 1, y, 3, 1)
  }
}

export const workbench: Painter = (g) => {
  rect(g, '#5e3f25', 3, 22, 3, 8)
  rect(g, '#5e3f25', 26, 22, 3, 8)
  rect(g, '#5e3f25', 2, 9, 28, 14)
  rect(g, '#9c7448', 3, 10, 26, 11)
  rect(g, '#c49562', 3, 10, 26, 2)
  rect(g, '#8d8f94', 6, 13, 6, 3)
  rect(g, '#a77b4f', 16, 14, 9, 2)
}

// A ring of stones round crossed logs, with flames when it is lit.
export function campfire(lit: boolean): Painter {
  return (g) => {
    for (const [x, y] of [[6, 20], [10, 25], [16, 27], [22, 25], [26, 20], [22, 15], [10, 15]]) circle(g, '#7b7e85', x, y, 3)
    rect(g, '#5e3f25', 8, 19, 16, 3)
    rect(g, '#7a5233', 11, 16, 3, 10)
    rect(g, '#7a5233', 18, 16, 3, 10)
    if (!lit) return
    circle(g, '#e5533d', 16, 16, 6)
    circle(g, '#f0b429', 16, 17, 4)
    circle(g, '#ffe28a', 16, 18, 2)
    rect(g, '#e5733d', 15, 6, 2, 6)
  }
}

export const barrel: Painter = (g) => {
  rect(g, '#5e3f25', 7, 4, 18, 25)
  rect(g, '#8a5f36', 8, 5, 16, 23)
  rect(g, '#a8753f', 11, 5, 3, 23)
  rect(g, '#3a3d3f', 7, 9, 18, 2)
  rect(g, '#3a3d3f', 7, 22, 18, 2)
}

// A frame of sticks with a hide stretched on it.
export const rack: Painter = (g) => {
  rect(g, '#5e3f25', 4, 4, 2, 26)
  rect(g, '#5e3f25', 26, 4, 2, 26)
  rect(g, '#7a5233', 4, 4, 24, 2)
  rect(g, '#a87a4f', 8, 7, 16, 16)
  rect(g, '#8a5a3a', 10, 9, 12, 12)
}

export function bucket(contents: string | undefined): Painter {
  return (g) => {
    rect(g, '#3a3d3f', 9, 6, 14, 2)
    rect(g, '#5e3f25', 7, 9, 18, 19)
    rect(g, '#9c7448', 8, 10, 16, 17)
    if (contents) rect(g, contents, 9, 10, 14, 4)
    rect(g, '#3a3d3f', 7, 15, 18, 2)
  }
}

export const bark: Painter = (g) => {
  rect(g, '#4a3220', 6, 8, 20, 16)
  rect(g, '#6b4a2c', 7, 9, 18, 14)
  for (const y of [11, 15, 19]) rect(g, '#4a3220', 9, y, 14, 1)
}

export const compost: Painter = (g) => {
  circle(g, '#3a2a1a', 16, 18, 10)
  circle(g, '#4a3a26', 15, 17, 8)
  rect(g, '#4f8a3a', 12, 13, 3, 2)
  rect(g, '#6b4a2c', 18, 19, 3, 2)
}

export function hide(color: string): Painter {
  return (g) => {
    g.fillStyle = color
    g.beginPath()
    g.moveTo(6, 8)
    g.lineTo(26, 6)
    g.lineTo(27, 24)
    g.lineTo(16, 28)
    g.lineTo(5, 24)
    g.closePath()
    g.fill()
  }
}
