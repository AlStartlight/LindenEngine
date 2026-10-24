import React, { useState } from 'react'
import { GodotBridge } from '../../engine/godot/GodotBridge'
import { CompatReport } from '../../engine/godot/report/CompatReport'
import { GodotBuildRunner } from '../../engine/godot/build/GodotBuildRunner'

interface GodotPanelProps {
  bridge?: GodotBridge
  onExport?: () => void
  onImport?: () => void
  onBuild?: (preset: string) => void
}

export const GodotPanel: React.FC<GodotPanelProps> = ({
  bridge,
  onExport,
  onImport,
  onBuild,
}) => {
  const [projectPath, setProjectPath] = useState<string>(bridge?.getConfig().godotProjectPath || '')
  const [executablePath, setExecutablePath] = useState<string>(bridge?.getConfig().godotExecutable || '')
  const [selectedPreset, setSelectedPreset] = useState<string>('Web')
  const [isSyncActive, setIsSyncActive] = useState<boolean>(bridge?.isLiveSyncActive || false)
  const [statusMsg, setStatusMsg] = useState<string>('Ready')
  const [report, setReport] = useState<CompatReport | null>(null)
  const [buildLogs, setBuildLogs] = useState<string[]>([])
  const [detectedGodot, setDetectedGodot] = useState<string | null>(
    GodotBuildRunner.findGodotExecutable(bridge?.getConfig().godotExecutable)
  )

  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.detectGodot) {
      window.electronAPI.detectGodot(executablePath || bridge?.getConfig().godotExecutable).then((res) => {
        if (res) setDetectedGodot(res)
      })
    }
  }, [executablePath, bridge])

  const handleToggleSync = async () => {
    if (!bridge) return
    try {
      if (isSyncActive) {
        bridge.stopLiveSync()
        setIsSyncActive(false)
        setStatusMsg('Live sync stopped')
      } else {
        await bridge.startLiveSync()
        setIsSyncActive(true)
        setStatusMsg(`Live sync active on port ${bridge.getConfig().syncPort} (Token: ${bridge.syncToken})`)
      }
    } catch (err: any) {
      setStatusMsg(`Sync error: ${err.message}`)
    }
  }

  const handleExport = async () => {
    setStatusMsg('Exporting scene to Godot...')
    if (onExport) {
      onExport()
    } else if (bridge && (bridge as any).currentWorld) {
      try {
        const outPath = `${projectPath}/main_scene.tscn`
        const rep = await bridge.exportScene((bridge as any).currentWorld, outPath)
        setReport(rep)
        setStatusMsg(`Exported successfully: ${rep.convertedCount} items converted`)
      } catch (err: any) {
        setStatusMsg(`Export failed: ${err.message}`)
      }
    }
  }

  const handleImport = async () => {
    setStatusMsg('Importing scene from Godot...')
    if (onImport) {
      onImport()
    } else if (bridge) {
      try {
        const inPath = `${projectPath}/main_scene.tscn`
        const res = await bridge.importScene(inPath)
        setReport(res.report)
        setStatusMsg(`Imported successfully: ${res.report.convertedCount} items converted`)
      } catch (err: any) {
        setStatusMsg(`Import failed: ${err.message}`)
      }
    }
  }

  const handleBuild = async () => {
    if (!detectedGodot && !executablePath) {
      setStatusMsg('Godot executable not found. Please specify executable path.')
      return
    }

    setStatusMsg(`Building for preset ${selectedPreset}...`)
    setBuildLogs([])

    if (onBuild) {
      onBuild(selectedPreset)
    } else if (bridge) {
      const outPath = `${projectPath}/build/${selectedPreset.toLowerCase()}/game`
      const res = await bridge.build(selectedPreset, outPath, (line) => {
        setBuildLogs((prev) => [...prev, line])
      })
      if (res.success) {
        setStatusMsg(`Build succeeded in ${res.durationMs}ms`)
      } else {
        setStatusMsg(`Build failed: ${res.error}`)
      }
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-200 p-4 space-y-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 pb-2">
        <div className="flex items-center space-x-2">
          <span className="text-xl">🤖</span>
          <h2 className="font-bold text-lg text-white">Bridge</h2>
          <span className="text-xs px-2 py-0.5 rounded bg-blue-900 text-blue-300">Target: Godot</span>
        </div>
        <div className="flex items-center space-x-2">
          <span
            className={`w-3 h-3 rounded-full ${
              isSyncActive ? 'bg-green-500 animate-pulse' : 'bg-gray-600'
            }`}
          />
          <span className="text-xs text-gray-400">
            {isSyncActive ? 'Live Sync Active' : 'Sync Offline'}
          </span>
        </div>
      </div>

      {/* Path Configurations */}
      <div className="space-y-3 bg-gray-800 p-3 rounded-lg border border-gray-700 text-sm">
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
            Godot Project Path
          </label>
          <input
            type="text"
            className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
            value={projectPath}
            onChange={(e) => {
              setProjectPath(e.target.value)
              bridge?.setConfig({ godotProjectPath: e.target.value })
            }}
            placeholder="/path/to/godot_project"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
            Godot Executable
          </label>
          <input
            type="text"
            className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
            value={executablePath}
            onChange={(e) => {
              const val = e.target.value
              setExecutablePath(val)
              bridge?.setConfig({ godotExecutable: val })
              if (typeof window !== 'undefined' && window.electronAPI?.detectGodot) {
                window.electronAPI.detectGodot(val).then((res) => {
                  setDetectedGodot(res)
                })
              } else {
                setDetectedGodot(GodotBuildRunner.findGodotExecutable(val))
              }
            }}
            placeholder={detectedGodot || 'Auto-detecting... or specify binary path'}
          />
          {detectedGodot ? (
            <span className="text-[10px] text-green-400 mt-1 block">
              ✓ Found: {detectedGodot}
            </span>
          ) : (
            <span className="text-[10px] text-yellow-400 mt-1 block">
              ⚠ Godot executable not found on system. Auto-detect will retry.
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleExport}
          className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-3 rounded text-xs flex items-center justify-center space-x-1 transition shadow"
        >
          <span>📤</span>
          <span>Export to Godot (.tscn)</span>
        </button>

        <button
          onClick={handleImport}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 px-3 rounded text-xs flex items-center justify-center space-x-1 transition shadow"
        >
          <span>📥</span>
          <span>Import from Godot</span>
        </button>
      </div>

      {/* Live Sync Controls */}
      <div className="bg-gray-800 p-3 rounded-lg border border-gray-700 text-sm flex items-center justify-between">
        <div>
          <div className="font-semibold text-xs text-white">Live Sync (WebSocket)</div>
          <div className="text-[11px] text-gray-400">
            Port {bridge?.getConfig().syncPort || 6007} • Localhost (127.0.0.1)
          </div>
        </div>
        <button
          onClick={handleToggleSync}
          className={`py-1.5 px-3 rounded text-xs font-semibold transition ${
            isSyncActive
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-green-600 hover:bg-green-500 text-white'
          }`}
        >
          {isSyncActive ? 'Stop Sync' : 'Start Sync'}
        </button>
      </div>

      {/* Build & Export Runner */}
      <div className="bg-gray-800 p-3 rounded-lg border border-gray-700 text-sm space-y-2">
        <div className="font-semibold text-xs text-white">Godot Build Runner</div>
        <div className="flex space-x-2">
          <select
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value)}
            className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-white flex-1 focus:outline-none"
          >
            <option value="Web">Web (HTML5)</option>
            <option value="Android">Android (APK)</option>
            <option value="iOS">iOS</option>
            <option value="Windows Desktop">Windows Desktop</option>
            <option value="macOS">macOS</option>
            <option value="Linux/X11">Linux</option>
          </select>
          <button
            onClick={handleBuild}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1 rounded text-xs font-semibold transition"
          >
            Build
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="text-xs bg-gray-950 px-3 py-2 rounded border border-gray-800 font-mono text-gray-400">
        Status: {statusMsg}
      </div>

      {/* Compatibility Report */}
      {report && (
        <div className="bg-gray-800 p-3 rounded-lg border border-gray-700 text-xs space-y-1">
          <div className="font-semibold text-white">Compatibility Report:</div>
          <div className="text-gray-300">
            Converted: {report.convertedCount} • Skipped: {report.skippedCount} • Warnings: {report.warnings.length} • Errors: {report.errors.length}
          </div>
          {report.issues.length > 0 && (
            <div className="max-h-24 overflow-y-auto mt-2 space-y-1 font-mono text-[11px]">
              {report.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className={
                    issue.severity === 'error'
                      ? 'text-red-400'
                      : issue.severity === 'warning'
                      ? 'text-yellow-400'
                      : 'text-gray-400'
                  }
                >
                  [{issue.severity.toUpperCase()}] {issue.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Build Logs */}
      {buildLogs.length > 0 && (
        <div className="bg-black p-3 rounded-lg border border-gray-800 text-[11px] font-mono text-gray-300 max-h-36 overflow-y-auto">
          <div className="text-gray-500 font-semibold mb-1">Build Output:</div>
          {buildLogs.map((log, idx) => (
            <div key={idx}>{log}</div>
          ))}
        </div>
      )}
    </div>
  )
}
