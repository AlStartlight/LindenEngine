import React, { useEffect } from 'react'
import { Icons } from './Icons'

export interface ToastData {
  id: string
  message: string
  actionLabel?: string
  onAction?: () => void
  type?: 'success' | 'error' | 'info'
}

export interface ToastProps {
  toast: ToastData | null
  onDismiss: () => void
}

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => {
      onDismiss()
    }, 5000)
    return () => clearTimeout(timer)
  }, [toast, onDismiss])

  if (!toast) return null

  return (
    <div className="fixed bottom-8 right-8 z-60 animate-bounce-in max-w-md shadow-2xl">
      <div className="bg-[#0f3460] border border-blue-500/50 rounded-xl p-3.5 text-xs text-white shadow-xl flex items-center justify-between space-x-3 backdrop-blur-md">
        <div className="flex items-center space-x-2.5">
          <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/40">
            <Icons.Check className="w-3.5 h-3.5" />
          </div>
          <span className="font-medium text-gray-100">{toast.message}</span>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {toast.actionLabel && (
            <button
              onClick={() => {
                toast.onAction?.()
                onDismiss()
              }}
              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-[11px] transition shadow"
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-white p-1 rounded"
          >
            <Icons.Close className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
