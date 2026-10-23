import React, { useState } from 'react'
import { EngineId } from '../../engine/transmuter/core/lif/LIFTypes'
import { Pipeline, transmute } from '../../engine/transmuter/core/Pipeline'
import { FidelityReportData } from '../../engine/transmuter/core/FidelityReport'
import { FidelityReportView } from './FidelityReportView'

export interface TransmuterWizardProps {
  onClose?: () => void
  onOpenProject?: (projectPath: string) => void
}

export const TransmuterWizard: React.FC<TransmuterWizardProps> = ({ onClose, onOpenProject }) => {
  const [step, setStep] = useState<number>(1) // 1..6
  const [direction, setDirection] = useState<'import' | 'export' | 'direct'>('import')
  const [fromEngine, setFromEngine] = useState<EngineId>('godot')
  const [toEngine, setToEngine] = useState<EngineId>('linden')
  const [sourcePath, setSourcePath] = useState<string>('')
  const [outputPath, setOutputPath] = useState<string>('')
  const [scriptsOption, setScriptsOption] = useState<'transpile' | 'stub' | 'skip'>('transpile')
  const [convertModels, setConvertModels] = useState<boolean>(true)
  const [detectedVersion, setDetectedVersion] = useState<string>('')

  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const [logs, setLogs] = useState<string[]>([])
  const [reportData, setReportData] = useState<FidelityReportData | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleDetect = async (dir: string) => {
    setSourcePath(dir)
    setErrorMsg(null)
    const pipeline = new Pipeline()
    const res = await pipeline.detectEngine(dir)
    if (res.supported) {
      setFromEngine(res.engine)
      setDetectedVersion(res.version)
    } else if (res.reason) {
      setErrorMsg(res.reason)
    }
  }

  const handleStartAnalysis = async () => {
    setErrorMsg(null)
    setIsRunning(true)
    setLogs(['Analyzing project structure...'])
    setProgress(30)

    try {
      const report = await transmute(sourcePath, fromEngine, toEngine, outputPath || '/tmp/preview', {
        dryRun: true,
        scripts: scriptsOption,
      })
      setProgress(100)
      setReportData(report.getData())
      setIsRunning(false)
      setStep(3) // Analysis preview step
    } catch (err: any) {
      setErrorMsg(err.message)
      setIsRunning(false)
    }
  }

  const handleRunConversion = async () => {
    setErrorMsg(null)
    setIsRunning(true)
    setStep(5) // Running step
    setProgress(10)
    setLogs(['Initializing conversion...', 'Detecting engine...', 'Normalizing assets to LIF...'])

    try {
      const report = await transmute(sourcePath, fromEngine, toEngine, outputPath, {
        dryRun: false,
        scripts: scriptsOption,
        convertModelsToGltf: convertModels,
      })

      setProgress(100)
      setLogs((prev) => [...prev, 'Validation passed', 'Output written successfully', 'Generated report'])
      setReportData(report.getData())
      setIsRunning(false)
      setStep(6) // Result step
    } catch (err: any) {
      setErrorMsg(err.message)
      setIsRunning(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-labelledby="wizard-title"
      style={{
        width: '760px',
        maxHeight: '90vh',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        borderRadius: '8px',
        border: '1px solid #334155',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #334155',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h2 id="wizard-title" style={{ margin: 0, fontSize: '18px', color: '#f8fafc' }}>
            Transmuter Wizard
          </h2>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
            Step {step} of 6 — Godot &bull; Unity &bull; Linden Engine Converter
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '20px',
              cursor: 'pointer',
            }}
          >
            &times;
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
        {errorMsg && (
          <div
            role="alert"
            style={{
              backgroundColor: '#450a0a',
              border: '1px solid #991b1b',
              color: '#fca5a5',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '13px',
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Step 1: Direction */}
        {step === 1 && (
          <div>
            <h3 style={{ marginTop: 0, color: '#f8fafc' }}>Choose Conversion Direction</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '16px' }}>
              <div
                onClick={() => {
                  setDirection('import')
                  setToEngine('linden')
                }}
                style={{
                  border: direction === 'import' ? '2px solid #38bdf8' : '1px solid #334155',
                  backgroundColor: direction === 'import' ? '#1e293b' : '#0f172a',
                  padding: '16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Import to Linden</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Open an existing Godot 4.x or Unity project inside Linden Engine.
                </div>
              </div>
              <div
                onClick={() => {
                  setDirection('export')
                  setFromEngine('linden')
                  setToEngine('godot')
                }}
                style={{
                  border: direction === 'export' ? '2px solid #38bdf8' : '1px solid #334155',
                  backgroundColor: direction === 'export' ? '#1e293b' : '#0f172a',
                  padding: '16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Export from Linden</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Export your Linden project to standard Godot 4.x or Unity project.
                </div>
              </div>
              <div
                onClick={() => {
                  setDirection('direct')
                  setFromEngine('godot')
                  setToEngine('unity')
                }}
                style={{
                  border: direction === 'direct' ? '2px solid #38bdf8' : '1px solid #334155',
                  backgroundColor: direction === 'direct' ? '#1e293b' : '#0f172a',
                  padding: '16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Direct Conversion</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Convert Godot directly to Unity or vice versa via LIF representation.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Source & Target Paths */}
        {step === 2 && (
          <div>
            <h3 style={{ marginTop: 0, color: '#f8fafc' }}>Select Project Folders</h3>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#cbd5e1', marginBottom: '6px' }}>
                Source Project Path:
              </label>
              <input
                type="text"
                value={sourcePath}
                onChange={(e) => handleDetect(e.target.value)}
                placeholder="/path/to/project"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  color: '#f8fafc',
                }}
              />
              {detectedVersion && (
                <div style={{ marginTop: '6px', fontSize: '12px', color: '#38bdf8' }}>
                  Detected: <strong>{fromEngine}</strong> (Version: {detectedVersion})
                </div>
              )}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#cbd5e1', marginBottom: '6px' }}>
                Output Folder (Must be empty or new):
              </label>
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="/path/to/output_folder"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  color: '#f8fafc',
                }}
              />
            </div>
          </div>
        )}

        {/* Step 3: Analysis Preview (Dry Run) */}
        {step === 3 && reportData && (
          <div>
            <h3 style={{ marginTop: 0, color: '#f8fafc' }}>Dry-Run Analysis Result</h3>
            <div style={{ height: '320px', overflowY: 'auto' }}>
              <FidelityReportView report={reportData} />
            </div>
          </div>
        )}

        {/* Step 4: Options */}
        {step === 4 && (
          <div>
            <h3 style={{ marginTop: 0, color: '#f8fafc' }}>Conversion Options</h3>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#cbd5e1', marginBottom: '6px' }}>
                Script Handling:
              </label>
              <select
                value={scriptsOption}
                onChange={(e) => setScriptsOption(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  color: '#f8fafc',
                }}
              >
                <option value="transpile">Transpile code + stub unsupported (Recommended)</option>
                <option value="stub">Stub only (placeholders for manual rewrite)</option>
                <option value="skip">Skip script conversion</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
              <input
                type="checkbox"
                id="convert-models"
                checked={convertModels}
                onChange={(e) => setConvertModels(e.target.checked)}
              />
              <label htmlFor="convert-models" style={{ fontSize: '13px', color: '#cbd5e1' }}>
                Convert 3D models (FBX/OBJ) to standard GLTF/GLB
              </label>
            </div>
          </div>
        )}

        {/* Step 5: Running Progress */}
        {step === 5 && (
          <div>
            <h3 style={{ marginTop: 0, color: '#f8fafc' }}>Converting Project...</h3>
            <div
              style={{
                width: '100%',
                height: '8px',
                backgroundColor: '#334155',
                borderRadius: '4px',
                overflow: 'hidden',
                margin: '16px 0',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  backgroundColor: '#38bdf8',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div
              style={{
                backgroundColor: '#020617',
                padding: '12px',
                borderRadius: '6px',
                fontFamily: 'monospace',
                fontSize: '12px',
                height: '180px',
                overflowY: 'auto',
                color: '#94a3b8',
              }}
            >
              {logs.map((log, idx) => (
                <div key={idx}>{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* Step 6: Result */}
        {step === 6 && reportData && (
          <div>
            <h3 style={{ marginTop: 0, color: '#10b981' }}>Conversion Complete!</h3>
            <div style={{ height: '320px', overflowY: 'auto' }}>
              <FidelityReportView report={reportData} />
            </div>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div
        style={{
          padding: '16px 24px',
          borderTop: '1px solid #334155',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        {step > 1 && step < 5 ? (
          <button
            onClick={() => setStep(step - 1)}
            style={{
              padding: '8px 16px',
              backgroundColor: '#334155',
              color: '#f8fafc',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Back
          </button>
        ) : (
          <div />
        )}

        <div>
          {step === 1 && (
            <button
              onClick={() => setStep(2)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0284c7',
                color: '#f8fafc',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Next: Select Folders
            </button>
          )}

          {step === 2 && (
            <button
              onClick={handleStartAnalysis}
              disabled={isRunning || !sourcePath}
              style={{
                padding: '8px 16px',
                backgroundColor: isRunning || !sourcePath ? '#475569' : '#0284c7',
                color: '#f8fafc',
                border: 'none',
                borderRadius: '4px',
                cursor: isRunning || !sourcePath ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {isRunning ? 'Analyzing...' : 'Run Analysis (Dry-Run)'}
            </button>
          )}

          {step === 3 && (
            <button
              onClick={() => setStep(4)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0284c7',
                color: '#f8fafc',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Next: Options
            </button>
          )}

          {step === 4 && (
            <button
              onClick={handleRunConversion}
              disabled={isRunning || !outputPath}
              style={{
                padding: '8px 16px',
                backgroundColor: isRunning || !outputPath ? '#475569' : '#10b981',
                color: '#f8fafc',
                border: 'none',
                borderRadius: '4px',
                cursor: isRunning || !outputPath ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              Execute Conversion
            </button>
          )}

          {step === 6 && (
            <div style={{ display: 'flex', gap: '8px' }}>
              {onOpenProject && (
                <button
                  onClick={() => onOpenProject(outputPath)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#0284c7',
                    color: '#f8fafc',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Open Transmuted Project
                </button>
              )}
              {onClose && (
                <button
                  onClick={onClose}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#334155',
                    color: '#f8fafc',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
