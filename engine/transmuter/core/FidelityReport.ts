/**
 * Fidelity Report Generator (FR-10, NFR-02)
 *
 * Produces structured JSON and interactive HTML reports detailing
 * full, partial, and unsupported conversion elements.
 */

import { EngineId } from './lif/LIFTypes'

export type FidelityStatus = 'full' | 'partial' | 'unsupported'

export interface FidelityReportItem {
  kind: 'node' | 'component' | 'resource' | 'script' | 'shader' | 'asset' | 'setting'
  source: string
  status: FidelityStatus
  reason?: string
  fix?: string
}

export interface FidelitySummary {
  full: number
  partial: number
  unsupported: number
  score: number // 0.0 to 1.0
}

export interface FidelityReportData {
  source: { engine: EngineId; version: string }
  target: { engine: EngineId; version: string }
  summary: FidelitySummary
  items: FidelityReportItem[]
}

export class FidelityReport {
  public items: FidelityReportItem[] = []

  constructor(
    public source: { engine: EngineId; version: string } = { engine: 'godot', version: '4.3' },
    public target: { engine: EngineId; version: string } = { engine: 'linden', version: '0.3.0' }
  ) {}

  addItem(
    kind: FidelityReportItem['kind'],
    source: string,
    status: FidelityStatus,
    reason?: string,
    fix?: string
  ): void {
    this.items.push({ kind, source, status, reason, fix })
  }

  getSummary(): FidelitySummary {
    let full = 0
    let partial = 0
    let unsupported = 0

    for (const item of this.items) {
      if (item.status === 'full') full++
      else if (item.status === 'partial') partial++
      else if (item.status === 'unsupported') unsupported++
    }

    const total = full + partial + unsupported
    const score = total > 0 ? Number(((full + partial * 0.5) / total).toFixed(2)) : 1.0

    return { full, partial, unsupported, score }
  }

  getData(): FidelityReportData {
    return {
      source: this.source,
      target: this.target,
      summary: this.getSummary(),
      items: [...this.items],
    }
  }

  toJSON(): string {
    return JSON.stringify(this.getData(), null, 2)
  }

  toHTML(): string {
    const data = this.getData()
    const summary = data.summary
    const percent = Math.round(summary.score * 100)

    const rows = data.items
      .map((item) => {
        const badgeColor =
          item.status === 'full'
            ? '#10b981'
            : item.status === 'partial'
            ? '#f59e0b'
            : '#ef4444'

        return `
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 10px;">${item.kind}</td>
            <td style="padding: 10px; font-family: monospace;">${item.source}</td>
            <td style="padding: 10px;"><span style="background:${badgeColor}; color:#fff; padding:2px 8px; border-radius:4px; font-size:12px; font-weight:bold;">${item.status}</span></td>
            <td style="padding: 10px; color:#94a3b8;">${item.reason || '-'}</td>
            <td style="padding: 10px; color:#38bdf8;">${item.fix || '-'}</td>
          </tr>`
      })
      .join('\n')

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Transmuter Fidelity Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; margin: 0; }
    .card { background: #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .stats { display: flex; gap: 20px; margin-top: 16px; }
    .stat-box { background: #334155; padding: 14px 24px; border-radius: 6px; flex: 1; text-align: center; }
    .stat-val { font-size: 24px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { padding: 10px; background: #334155; color: #94a3b8; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Transmuter Fidelity Report</h1>
  <p style="color:#94a3b8;">Conversion: <strong>${data.source.engine} (${data.source.version})</strong> &rarr; <strong>${data.target.engine} (${data.target.version})</strong></p>
  
  <div class="card">
    <h2>Summary (Score: ${percent}%)</h2>
    <div class="stats">
      <div class="stat-box" style="border-left: 4px solid #10b981;"><div class="stat-val" style="color:#10b981;">${summary.full}</div><div>Full</div></div>
      <div class="stat-box" style="border-left: 4px solid #f59e0b;"><div class="stat-val" style="color:#f59e0b;">${summary.partial}</div><div>Partial</div></div>
      <div class="stat-box" style="border-left: 4px solid #ef4444;"><div class="stat-val" style="color:#ef4444;">${summary.unsupported}</div><div>Unsupported</div></div>
    </div>
  </div>

  <div class="card">
    <h2>Details (${data.items.length} items)</h2>
    <table>
      <thead>
        <tr><th>Kind</th><th>Source</th><th>Status</th><th>Reason</th><th>Recommendation</th></tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</body>
</html>`
  }
}
