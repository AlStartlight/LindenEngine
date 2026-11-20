import React from 'react'
import ReactDOM from 'react-dom/client'
import { EditorLayout } from '@editor/EditorLayout'
import { ErrorBoundary } from '@editor/ui/ErrorBoundary'
import './App.css'

const App: React.FC = () => {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#0f172a] text-white p-6 gap-4 select-none">
          <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-2xl font-bold border border-red-500/40">
            ⚠️
          </div>
          <h1 className="text-lg font-bold text-gray-100">Linden Engine Encountered an Error</h1>
          <p className="text-xs text-red-300 font-mono bg-black/40 px-3 py-2 rounded max-w-lg border border-red-900/40 text-center break-words">
            {error.message}
          </p>
          <button
            onClick={() => {
              reset()
              window.location.reload()
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold shadow-lg transition-colors cursor-pointer"
          >
            Reload Linden Engine
          </button>
        </div>
      )}
    >
      <EditorLayout />
    </ErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
