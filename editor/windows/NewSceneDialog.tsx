import React, { useState, useEffect, useRef } from 'react'

export interface NewSceneDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (name: string) => void
  existingScenes?: string[]
}

export function validateSceneName(
  name: string,
  existingScenes: string[] = []
): { valid: boolean; error?: string } {
  const trimmed = name.trim()
  if (!trimmed) {
    return { valid: false, error: 'Nama scene tidak boleh kosong.' }
  }
  if (name.length > 64) {
    return { valid: false, error: 'Nama scene maksimal 64 karakter.' }
  }
  if (/[/\\:*?"<>|]/.test(name)) {
    return { valid: false, error: 'Nama scene tidak boleh mengandung karakter / \\ : * ? " < > |' }
  }
  const normalizedExisting = existingScenes.map((s) => {
    const file = s.split(/[/\\]/).filter(Boolean).pop() || s
    return file.replace(/\.lscene$/i, '').toLowerCase()
  })
  if (normalizedExisting.includes(trimmed.toLowerCase())) {
    return { valid: false, error: 'Nama sudah dipakai' }
  }
  return { valid: true }
}

export const NewSceneDialog: React.FC<NewSceneDialogProps> = ({
  isOpen,
  onClose,
  onCreate,
  existingScenes = [],
}) => {
  const [name, setName] = useState('NewScene')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName('NewScene')
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 50)
    }
  }, [isOpen])

  if (!isOpen) return null

  const validation = validateSceneName(name, existingScenes)

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!validation.valid) return
    onCreate(name.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (validation.valid) {
        onCreate(name.trim())
      }
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-[#16213e] border border-gray-700/80 rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden text-xs text-gray-200">
        {/* Title bar */}
        <div className="h-9 px-4 bg-[#0f172a] border-b border-gray-700/60 flex items-center justify-between">
          <span className="font-semibold text-gray-100 flex items-center gap-2">
            <span>🎬</span> New Scene
          </span>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-gray-300 font-medium mb-1.5">
              Scene Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#0f172a] border border-gray-700 rounded px-3 py-2 text-white outline-none focus:border-blue-500 font-mono text-xs"
              placeholder="Enter scene name..."
            />
            {!validation.valid && (
              <p className="mt-1.5 text-red-400 text-[11px] font-medium">
                {validation.error}
              </p>
            )}
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-700/50">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!validation.valid}
              className={`px-4 py-1.5 rounded font-medium transition-colors ${
                validation.valid
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                  : 'bg-gray-700/60 text-gray-500 cursor-not-allowed'
              }`}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
