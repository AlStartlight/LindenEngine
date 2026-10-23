import React, { useState } from 'react'
import { FidelityReportData, FidelityStatus } from '../../engine/transmuter/core/FidelityReport'

interface FidelityReportViewProps {
  report: FidelityReportData
  onSelectNode?: (nodePath: string) => void
  onClose?: () => void
}

export const FidelityReportView: React.FC<FidelityReportViewProps> = ({
  report,
  onSelectNode,
  onClose,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  const summary = report.summary
  const scorePercent = Math.round(summary.score * 100)

  const filteredItems = report.items.filter((item) => {
    if (filterStatus !== 'all' && item.status !== filterStatus) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return item.source.toLowerCase().includes(q) || (item.reason && item.reason.toLowerCase().includes(q))
    }
    return true
  })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        padding: '20px',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#f8fafc' }}>Transmuter Fidelity Report</h2>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
            {report.source.engine} ({report.source.version}) &rarr; {report.target.engine} ({report.target.version})
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              backgroundColor: '#334155',
              color: '#f8fafc',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <div style={{ backgroundColor: '#1e293b', padding: '14px', borderRadius: '6px', textAlign: 'center', borderTop: '3px solid #38bdf8' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#38bdf8' }}>{scorePercent}%</div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>Overall Fidelity</div>
        </div>
        <div style={{ backgroundColor: '#1e293b', padding: '14px', borderRadius: '6px', textAlign: 'center', borderTop: '3px solid #10b981' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>{summary.full}</div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>Full Fidelity</div>
        </div>
        <div style={{ backgroundColor: '#1e293b', padding: '14px', borderRadius: '6px', textAlign: 'center', borderTop: '3px solid #f59e0b' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f59e0b' }}>{summary.partial}</div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>Partial Fidelity</div>
        </div>
        <div style={{ backgroundColor: '#1e293b', padding: '14px', borderRadius: '6px', textAlign: 'center', borderTop: '3px solid #ef4444' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ef4444' }}>{summary.unsupported}</div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>Unsupported</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search items..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search report items"
          style={{
            flex: 1,
            backgroundColor: '#1e293b',
            border: '1px solid #475569',
            borderRadius: '4px',
            padding: '8px 12px',
            color: '#f8fafc',
          }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="Filter status"
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #475569',
            borderRadius: '4px',
            padding: '8px 12px',
            color: '#f8fafc',
          }}
        >
          <option value="all">All Statuses ({report.items.length})</option>
          <option value="full">Full ({summary.full})</option>
          <option value="partial">Partial ({summary.partial})</option>
          <option value="unsupported">Unsupported ({summary.unsupported})</option>
        </select>
      </div>

      {/* Items Table */}
      <div style={{ backgroundColor: '#1e293b', borderRadius: '6px', overflow: 'hidden', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#334155', color: '#cbd5e1' }}>
              <th style={{ padding: '10px 14px' }}>Kind</th>
              <th style={{ padding: '10px 14px' }}>Source Element</th>
              <th style={{ padding: '10px 14px' }}>Status</th>
              <th style={{ padding: '10px 14px' }}>Reason & Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item, idx) => {
              const badgeBg =
                item.status === 'full'
                  ? '#065f46'
                  : item.status === 'partial'
                  ? '#854d0e'
                  : '#991b1b'

              const badgeText =
                item.status === 'full'
                  ? '#6ee7b7'
                  : item.status === 'partial'
                  ? '#fde68a'
                  : '#fca5a5'

              return (
                <tr
                  key={idx}
                  style={{ borderBottom: '1px solid #334155', cursor: onSelectNode ? 'pointer' : 'default' }}
                  onClick={() => onSelectNode && onSelectNode(item.source)}
                >
                  <td style={{ padding: '10px 14px', textTransform: 'capitalize' }}>{item.kind}</td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#38bdf8' }}>{item.source}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span
                      style={{
                        backgroundColor: badgeBg,
                        color: badgeText,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 'bold',
                        fontSize: '11px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div>{item.reason || '-'}</div>
                    {item.fix && <div style={{ color: '#38bdf8', marginTop: '2px' }}>Fix: {item.fix}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
