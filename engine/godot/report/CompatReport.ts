/**
 * Compatibility Report for Bridge (Godot)
 * Tracks conversion statistics, warnings, unsupported features, and errors.
 */

export interface CompatIssue {
  entityId?: string
  nodeName?: string
  component?: string
  message: string
  severity: 'info' | 'warning' | 'error'
  line?: number
}

export class CompatReport {
  public convertedCount: number = 0
  public skippedCount: number = 0
  public issues: CompatIssue[] = []

  recordConverted(count = 1): void {
    this.convertedCount += count
  }

  recordSkipped(entityId?: string, nodeName?: string, component?: string, reason?: string): void {
    this.skippedCount++
    if (reason) {
      this.addWarning(reason, { entityId, nodeName, component })
    }
  }

  addWarning(message: string, context?: { entityId?: string; nodeName?: string; component?: string }): void {
    this.issues.push({
      message,
      severity: 'warning',
      entityId: context?.entityId,
      nodeName: context?.nodeName,
      component: context?.component,
    })
  }

  addInfo(message: string, context?: { entityId?: string; nodeName?: string; component?: string }): void {
    this.issues.push({
      message,
      severity: 'info',
      entityId: context?.entityId,
      nodeName: context?.nodeName,
      component: context?.component,
    })
  }

  addError(message: string, context?: { entityId?: string; nodeName?: string; component?: string; line?: number }): void {
    this.issues.push({
      message,
      severity: 'error',
      entityId: context?.entityId,
      nodeName: context?.nodeName,
      component: context?.component,
      line: context?.line,
    })
  }

  get warnings(): CompatIssue[] {
    return this.issues.filter((i) => i.severity === 'warning')
  }

  get errors(): CompatIssue[] {
    return this.issues.filter((i) => i.severity === 'error')
  }

  get isSuccess(): boolean {
    return this.errors.length === 0
  }

  formatSummary(): string {
    const lines = [
      `[Compatibility Report] Converted: ${this.convertedCount}, Skipped: ${this.skippedCount}, Warnings: ${this.warnings.length}, Errors: ${this.errors.length}`,
    ]
    for (const issue of this.issues) {
      const prefix = issue.severity.toUpperCase()
      const target = issue.nodeName ? ` [${issue.nodeName}]` : issue.entityId ? ` (${issue.entityId})` : ''
      lines.push(`  - ${prefix}${target}: ${issue.message}`)
    }
    return lines.join('\n')
  }
}
