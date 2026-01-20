import React, { useRef, useEffect } from 'react'

interface ConsoleMessage {
  type: string
  message: string
  time: Date
}

interface ConsolePanelProps {
  messages?: ConsoleMessage[]
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ messages = [] }) => {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const getMessageColor = (type: string): string => {
    switch (type) {
      case 'error':
        return 'text-red-400'
      case 'warn':
        return 'text-yellow-400'
      case 'success':
        return 'text-green-400'
      case 'info':
      default:
        return 'text-gray-300'
    }
  }

  const getMessageIcon = (type: string): string => {
    switch (type) {
      case 'error':
        return '✕'
      case 'warn':
        return '⚠'
      case 'success':
        return '✓'
      case 'info':
      default:
        return 'ℹ'
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Console Content */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-auto p-2 font-mono text-xs space-y-1"
      >
        {messages.length === 0 ? (
          <div className="text-gray-500 text-center py-4">No messages</div>
        ) : (
          messages.map((msg, idx) => (
            <div 
              key={idx} 
              className={`flex items-start gap-2 ${getMessageColor(msg.type)} hover:bg-white/5 px-1 rounded`}
            >
              <span className="opacity-60">{getMessageIcon(msg.type)}</span>
              <span className="text-gray-500 shrink-0">
                [{msg.time.toLocaleTimeString()}]
              </span>
              <span className="break-all">{msg.message}</span>
            </div>
          ))
        )}
      </div>

      {/* Console Input */}
      <div className="p-2 border-t border-gray-700/50">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">{'>'}</span>
          <input
            type="text"
            placeholder="Enter command..."
            className="flex-1 bg-black/30 border border-gray-700/50 rounded px-2 py-1 text-xs outline-none focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Handle command input
                (e.target as HTMLInputElement).value = ''
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default ConsolePanel
