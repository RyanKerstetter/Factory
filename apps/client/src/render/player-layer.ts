import { Container, Sprite, Text } from 'pixi.js'
import { TILE_PX } from '../camera.ts'
import type { Art } from './art.ts'
import type { PlayerView } from './world-renderer.ts'

const PLAYER_PX = TILE_PX * 0.8
const NAME_STYLE = {
  fontFamily: 'Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif',
  fontSize: 14,
  fill: 0xece8d9,
  letterSpacing: 0.5,
}

// The player picture is drawn facing south (down the screen), so it is turned by a quarter turn less than its facing.
const ART_FACING = Math.PI / 2
// How much of the way to its new facing a player turns each frame, so it swings round rather than snapping.
const TURN_RATE = 0.35

type Drawn = { root: Container; body: Sprite; name: Text; angle: number }

// The players, each with its name over it. Names stay the same size on screen whatever the zoom.
export class PlayerLayer {
  readonly view = new Container()
  private readonly drawn = new Map<number, Drawn>()

  constructor(private readonly art: Art) {}

  update(players: readonly PlayerView[], zoom: number): void {
    const seen = new Set<number>()
    for (const player of players) {
      seen.add(player.id)
      let drawn = this.drawn.get(player.id)
      if (!drawn) {
        const body = new Sprite(this.art.texture('player'))
        body.anchor.set(0.5)
        body.setSize(PLAYER_PX, PLAYER_PX)
        const name = new Text({ text: player.name, style: NAME_STYLE, resolution: 2 })
        name.anchor.set(0.5, 1)
        const root = new Container()
        root.addChild(body, name)
        this.view.addChild(root)
        drawn = { root, body, name, angle: player.facing }
        this.drawn.set(player.id, drawn)
      }
      if (drawn.name.text !== player.name) drawn.name.text = player.name
      drawn.name.style.fill = player.local ? 0xf0b429 : 0xece8d9
      drawn.name.scale.set(1 / zoom)
      drawn.name.position.set(0, -PLAYER_PX / 2 - 4 / zoom)
      drawn.root.position.set(player.x * TILE_PX, player.y * TILE_PX)
      drawn.angle += shortestTurn(drawn.angle, player.facing) * TURN_RATE
      drawn.body.rotation = drawn.angle - ART_FACING
    }
    for (const [id, drawn] of this.drawn) {
      if (seen.has(id)) continue
      drawn.root.destroy({ children: true })
      this.drawn.delete(id)
    }
  }
}

// The smallest turn from one angle to another, between -π and π.
function shortestTurn(from: number, to: number): number {
  const turn = (to - from) % (Math.PI * 2)
  return turn > Math.PI ? turn - Math.PI * 2 : turn < -Math.PI ? turn + Math.PI * 2 : turn
}
