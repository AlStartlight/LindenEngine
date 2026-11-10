import { Component } from '../ecs/Component'

/**
 * Marks an entity as networked (multiplayer, see docs/specs/SPEC-Multiplayer-WebSocket.md).
 *
 * - `template` empty: a scene entity owned by the room; the host drives it, others see a puppet.
 * - `template` set (e.g. "player"): the entity is a template, hidden at Play. Each player gets a
 *   clone of the "player" template as avatar; scripts spawn others with ctx.net.spawn(template).
 */
export class NetworkSync extends Component {
  public template: string = ''
  public syncTransform: boolean = true
  /** Snapshots per second; 0 = project multiplayer.tickRate */
  public rate: number = 0
  public interpolate: boolean = true

  constructor() {
    super('NetworkSync')
  }

  clone(): NetworkSync {
    const c = new NetworkSync()
    c.template = this.template
    c.syncTransform = this.syncTransform
    c.rate = this.rate
    c.interpolate = this.interpolate
    return c
  }
}

/** Template name every player gets an avatar from */
export const PLAYER_TEMPLATE = 'player'
