/**
 * Godot .tres (Resource) Parser
 */

import { TscnParser, TscnDocument } from '../../../godot/tscn/TscnParser'

export class TresParser {
  private parser = new TscnParser()

  parse(content: string): TscnDocument {
    return this.parser.parse(content)
  }
}
