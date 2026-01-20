import React, { useRef, useEffect } from 'react'

interface ViewportProps {
  canvasId: string
}

export const Viewport: React.FC<ViewportProps> = ({ canvasId }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement
    if (!canvas || !containerRef.current) return

    const resizeCanvas = () => {
      const { clientWidth, clientHeight } = containerRef.current!
      canvas.style.width = `${clientWidth}px`
      canvas.style.height = `${clientHeight}px`
    }

    window.addEventListener('resize', resizeCanvas)
    resizeCanvas()

    return () => window.removeEventListener('resize', resizeCanvas)
  }, [canvasId])

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        id={canvasId}
        className="w-full h-full"
        style={{ display: 'block' }}
      />

      {/* Viewport gizmo */}
      <div className="absolute bottom-4 left-4 w-24 h-24 bg-black/50 rounded border border-gray-600 flex items-center justify-center">
        <div className="text-xs text-center">
          <div className="text-red-400 font-bold">X</div>
          <div className="text-green-400 font-bold">Y</div>
          <div className="text-blue-400 font-bold">Z</div>
        </div>
      </div>

      {/* Stats overlay */}
      <div className="absolute top-4 right-4 bg-black/70 px-3 py-2 rounded text-xs font-mono">
        <div className="text-green-400">Engine Stats</div>
      </div>
    </div>
  )
}
