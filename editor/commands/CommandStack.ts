import { World } from '../../engine/ecs/World'

export interface EditorCommand {
  label: string
  do(world: World): void
  undo(world: World): void
  mergeKey?: string
}

export class CommandStack {
  private historyList: EditorCommand[] = []
  private currentCursor: number = 0
  private savedCursor: number = 0
  private maxDepth: number = 200
  private world: World

  private activeGroup: EditorCommand[] | null = null
  private activeGroupLabel: string = ''
  private lastExecutedTime: number = 0
  private lastExecutedMergeKey: string | null = null

  constructor(world: World, maxDepth: number = 200) {
    this.world = world
    this.maxDepth = maxDepth
  }

  get history(): readonly EditorCommand[] {
    return this.historyList
  }

  get cursor(): number {
    return this.currentCursor
  }

  canUndo(): boolean {
    return this.currentCursor > 0
  }

  canRedo(): boolean {
    return this.currentCursor < this.historyList.length
  }

  isDirty(): boolean {
    return this.currentCursor !== this.savedCursor
  }

  markSaved(): void {
    this.savedCursor = this.currentCursor
  }

  beginGroup(label: string): void {
    if (this.activeGroup !== null) {
      this.endGroup()
    }
    this.activeGroup = []
    this.activeGroupLabel = label
  }

  endGroup(): void {
    if (!this.activeGroup) return
    const cmds = this.activeGroup
    const label = this.activeGroupLabel
    this.activeGroup = null
    this.activeGroupLabel = ''

    if (cmds.length === 0) return

    const compoundCmd: EditorCommand = {
      label,
      do: (w) => {
        for (const c of cmds) {
          c.do(w)
        }
      },
      undo: (w) => {
        for (let i = cmds.length - 1; i >= 0; i--) {
          cmds[i].undo(w)
        }
      },
    }

    this.pushCommand(compoundCmd)
  }

  execute(cmd: EditorCommand): void {
    cmd.do(this.world)

    if (this.activeGroup) {
      this.activeGroup.push(cmd)
      return
    }

    const now = Date.now()
    // Check merging
    if (
      cmd.mergeKey &&
      this.lastExecutedMergeKey === cmd.mergeKey &&
      now - this.lastExecutedTime <= 500 &&
      this.currentCursor > 0
    ) {
      // Merge with previous command: keep original undo, use latest do
      const prevCmd = this.historyList[this.currentCursor - 1]
      const mergedCmd: EditorCommand = {
        label: cmd.label,
        mergeKey: cmd.mergeKey,
        undo: prevCmd.undo,
        do: cmd.do,
      }
      this.historyList[this.currentCursor - 1] = mergedCmd
      this.lastExecutedTime = now
      return
    }

    this.lastExecutedTime = now
    this.lastExecutedMergeKey = cmd.mergeKey || null
    this.pushCommand(cmd)
  }

  private pushCommand(cmd: EditorCommand): void {
    // Truncate redo history
    this.historyList = this.historyList.slice(0, this.currentCursor)

    this.historyList.push(cmd)
    this.currentCursor++

    // Enforce max depth
    if (this.historyList.length > this.maxDepth) {
      const excess = this.historyList.length - this.maxDepth
      this.historyList = this.historyList.slice(excess)
      this.currentCursor -= excess
      this.savedCursor -= excess
    }
  }

  undo(): void {
    if (this.currentCursor <= 0) return
    this.currentCursor--
    const cmd = this.historyList[this.currentCursor]
    cmd.undo(this.world)
    this.lastExecutedMergeKey = null
  }

  redo(): void {
    if (this.currentCursor >= this.historyList.length) return
    const cmd = this.historyList[this.currentCursor]
    cmd.do(this.world)
    this.currentCursor++
    this.lastExecutedMergeKey = null
  }

  clear(): void {
    this.historyList = []
    this.currentCursor = 0
    this.savedCursor = 0
    this.activeGroup = null
    this.lastExecutedMergeKey = null
  }
}
