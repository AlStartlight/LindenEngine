import React, { useEffect } from 'react'

export interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string | null
  singleButton?: boolean
  confirmButtonVariant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel?: () => void
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Buang perubahan',
  cancelLabel = 'Batal',
  singleButton = false,
  confirmButtonVariant = 'danger',
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (singleButton || !onCancel) {
          onConfirm()
        } else {
          onCancel()
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onConfirm()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onConfirm, onCancel, singleButton])

  if (!isOpen) return null

  const handleBackdropClick = () => {
    if (singleButton || !onCancel) {
      onConfirm()
    } else {
      onCancel()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-[#16213e] border border-gray-700/50 rounded-lg shadow-2xl p-6 max-w-md w-full mx-4 flex flex-col gap-4 text-white"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h3 id="confirm-dialog-title" className="text-lg font-semibold text-gray-100">
          {title}
        </h3>
        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
          {message}
        </p>
        <div className="flex justify-end gap-3 mt-2">
          {!singleButton && onCancel && cancelLabel && (
            <button
              type="button"
              className="px-4 py-2 text-sm rounded bg-gray-700/60 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={`px-4 py-2 text-sm rounded font-medium transition-colors ${
              confirmButtonVariant === 'danger'
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
