import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icons } from '../ui/Icons'
import { useI18n } from '../i18n/translations'

/**
 * Agent Bridge dialog (SPEC-DSH-MCP-Agent-Integration P3).
 *
 * Layout: fixed header, one scrollable body made of spaced cards (Connection,
 * Agent access, Roles, Clients + Locks), fixed footer for actions. The copy action
 * lives in the main process: the role token goes straight to the clipboard.
 */

interface BridgeRole {
  id: string
  name: string
  order: number
  tools: number
  writes: string[]
}

interface BridgeClient {
  id: string
  role: string
  scope: string[] | null
}

interface BridgeState {
  status: {
    running: boolean
    projectPath: string | null
    endpoint: string | null
    manifestPath: string | null
    protocolVersion: string
    clients: BridgeClient[]
    locks: { key: string; clientId: string; role: string; expiresAt: number }[]
  } | null
  manifest: { manifestPath: string; endpoint: string; projectPath: string; roles: { id: string; name: string; tools: number }[] } | null
  roles: BridgeRole[]
}

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-gray-700/60 bg-[#131c33]/70 p-4 ${className}`}>{children}</section>
)

const CardTitle: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
  <div className="mb-3 flex items-baseline justify-between gap-3">
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{children}</h4>
    {hint && <span className="text-[10px] text-gray-500">{hint}</span>}
  </div>
)

export const BridgeModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useI18n()
  // t is re-created on every render; keep it in a ref so `load` stays stable and
  // the dialog does not refetch in a loop.
  const tRef = useRef(t)
  tRef.current = t
  const [state, setState] = useState<BridgeState | null>(null)
  const [roleId, setRoleId] = useState('linden-game-architect')
  const [format, setFormat] = useState<'dsh' | 'json'>('dsh')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.electronAPI?.agentBridgeStatus?.()
      if (next) setState(next as BridgeState)
      else setError(tRef.current('agent.bridge.offline_hint'))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2200)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.electronAPI?.agentBridgeCopyConfig?.({ roleId, format })
      if (res?.ok) setCopied(true)
      else setError(res?.error ?? tRef.current('agent.bridge.offline_hint'))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const restart = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.electronAPI?.agentBridgeRestart?.()
      if (next) setState(next as BridgeState)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const status = state?.status ?? null
  const clients = status?.clients ?? []
  const roles = state?.roles ?? []
  const locks = status?.locks ?? []
  const selectedRole = useMemo(() => roles.find((role) => role.id === roleId), [roles, roleId])
  const running = !!status?.running

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-700/80 bg-[#16213e] shadow-2xl">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-gray-700/60 bg-[#0f3460]/70 px-6 py-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{t('agent.bridge.title')}</h3>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${
                  running
                    ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                    : 'border-gray-500/30 bg-gray-500/15 text-gray-300'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                {running ? t('agent.bridge.running') : t('agent.bridge.offline')}
              </span>
            </div>
            <p className="max-w-xl text-[11px] leading-relaxed text-gray-400">{t('agent.bridge.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
            title={t('agent.bridge.close')}
          >
            <Icons.Close className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5 pb-6">
          {loading && !state && <p className="py-8 text-center text-xs text-gray-500">{t('agent.bridge.loading')}</p>}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-red-300">
              {error}
            </div>
          )}

          {!loading && !running && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200">
              {t('agent.bridge.offline_hint')}
            </div>
          )}

          {status && (
            <Card>
              <CardTitle>{t('agent.bridge.connection')}</CardTitle>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <dt className="text-[10px] uppercase tracking-wide text-gray-500">{t('agent.bridge.endpoint')}</dt>
                  <dd className="break-all font-mono text-[11px] text-emerald-300">{status.endpoint ?? '—'}</dd>
                </div>
                <div className="min-w-0 space-y-1">
                  <dt className="text-[10px] uppercase tracking-wide text-gray-500">{t('agent.bridge.protocol')}</dt>
                  <dd className="font-mono text-[11px] text-gray-200">{status.protocolVersion}</dd>
                </div>
                <div className="min-w-0 space-y-1 sm:col-span-2">
                  <dt className="text-[10px] uppercase tracking-wide text-gray-500">{t('agent.bridge.manifest')}</dt>
                  <dd className="break-all font-mono text-[11px] text-gray-400">{status.manifestPath ?? '—'}</dd>
                </div>
                <div className="min-w-0 space-y-1 sm:col-span-2">
                  <dt className="text-[10px] uppercase tracking-wide text-gray-500">{t('agent.bridge.project')}</dt>
                  <dd className="break-all font-mono text-[11px] text-gray-400">{status.projectPath ?? '—'}</dd>
                </div>
              </dl>
            </Card>
          )}

          {/* Primary action */}
          <Card className="border-blue-500/25 bg-blue-500/[0.06]">
            <CardTitle hint={running ? undefined : t('agent.bridge.offline')}>{t('agent.bridge.access')}</CardTitle>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_auto] sm:items-end">
              <label className="min-w-0 space-y-1.5">
                <span className="block text-[10px] uppercase tracking-wide text-gray-500">{t('agent.bridge.role')}</span>
                <select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className="w-full rounded-lg border border-gray-700/70 bg-[#1a1a2e] px-2.5 py-1.5 text-[11px] text-gray-200 focus:border-blue-500 focus:outline-none"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 space-y-1.5">
                <span className="block text-[10px] uppercase tracking-wide text-gray-500">{t('agent.bridge.format')}</span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as 'dsh' | 'json')}
                  className="w-full rounded-lg border border-gray-700/70 bg-[#1a1a2e] px-2.5 py-1.5 text-[11px] text-gray-200 focus:border-blue-500 focus:outline-none"
                >
                  <option value="dsh">DeepSeek Harness YAML</option>
                  <option value="json">mcpServers JSON</option>
                </select>
              </label>
              <button
                onClick={copy}
                disabled={busy || !running}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
              >
                {copied ? <span>✓</span> : <Icons.ExternalLink className="h-3 w-3" />}
                {copied ? t('agent.bridge.copied_short') : t('agent.bridge.copy')}
              </button>
            </div>
            {selectedRole && (
              <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
                {selectedRole.tools} {t('agent.bridge.tools')}
                {selectedRole.writes.length > 0 ? ` · ${t('agent.bridge.writes')}: ${selectedRole.writes.join(', ')}` : ` · ${t('agent.bridge.readonly')}`}
              </p>
            )}
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">{t('agent.bridge.secret_note')}</p>
          </Card>

          <Card>
            <CardTitle hint={`${roles.length} ${t('agent.bridge.total')}`}>{t('agent.bridge.roles')}</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => {
                const selected = role.id === roleId
                return (
                  <button
                    key={role.id}
                    onClick={() => setRoleId(role.id)}
                    className={`flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                      selected
                        ? 'border-blue-500/60 bg-blue-500/10'
                        : 'border-gray-700/50 bg-[#1a2338]/50 hover:border-gray-600 hover:bg-[#1a2338]'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-gray-200">{role.name}</span>
                      <span className="shrink-0 rounded bg-gray-700/50 px-1.5 py-0.5 font-mono text-[9px] text-gray-400">
                        {role.tools} {t('agent.bridge.tools')}
                      </span>
                    </span>
                    <span className="truncate text-[10px] text-gray-500">
                      {role.writes.length > 0 ? role.writes.join(' · ') : t('agent.bridge.readonly')}
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardTitle hint={`${clients.length} ${t('agent.bridge.total')}`}>{t('agent.bridge.clients')}</CardTitle>
              {clients.length === 0 ? (
                <p className="py-2 text-[11px] leading-relaxed text-gray-500">{t('agent.bridge.no_clients')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {clients.map((client) => (
                    <li
                      key={client.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-gray-700/40 bg-[#1a2338]/50 px-2.5 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                        <span className="truncate font-mono text-[11px] text-gray-300">{client.id}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[9px] uppercase text-gray-500">
                        {client.scope === null ? t('agent.bridge.full_access') : `${client.scope.length} ${t('agent.bridge.tools')}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardTitle hint={`${locks.length} ${t('agent.bridge.total')}`}>{t('agent.bridge.locks')}</CardTitle>
              {locks.length === 0 ? (
                <p className="py-2 text-[11px] leading-relaxed text-gray-500">{t('agent.bridge.no_locks')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {locks.map((lock) => (
                    <li
                      key={lock.key}
                      className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5"
                    >
                      <span className="truncate font-mono text-[11px] text-amber-200">{lock.key}</span>
                      <span className="shrink-0 font-mono text-[9px] uppercase text-amber-300/80">{lock.role}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-700/60 bg-[#0f3460]/50 px-6 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={restart}
              disabled={busy || !running}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700/70 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              title={t('agent.bridge.restart_hint')}
            >
              <Icons.RefreshCw className="h-3 w-3" />
              {t('agent.bridge.restart')}
            </button>
            <button
              onClick={load}
              disabled={busy || loading}
              className="rounded-lg px-2.5 py-1.5 text-[11px] text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200 disabled:opacity-50"
            >
              {t('agent.bridge.refresh')}
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-white/5 px-3.5 py-1.5 text-[11px] font-medium text-gray-200 transition-colors hover:bg-white/10"
          >
            {t('agent.bridge.close')}
          </button>
        </footer>
      </div>
    </div>
  )
}
