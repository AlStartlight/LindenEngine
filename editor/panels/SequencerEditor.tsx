/**
 * Sequencer Editor Panel - Timeline-based cinematic editor UI (UE5 style)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  Sequence,
  SequencerPlayer,
  SequencerTrack,
  TrackType,
  Keyframe,
  KeyframeInterpolation,
  PlaybackState,
  PropertyTrack,
} from '../../engine/cinematic'

// ==================== TYPES ====================

interface TimelineState {
  zoom: number
  scrollX: number
  currentTime: number
  isPlaying: boolean
  duration: number
}

interface Selection {
  trackId: string | null
  keyframeIds: Set<string>
}

// ==================== CONSTANTS ====================

const TRACK_HEIGHT = 32
const HEADER_WIDTH = 200
const TIME_SCALE = 100 // pixels per second

// ==================== COLOR UTILS ====================

const getTrackColor = (type: TrackType): string => {
  switch (type) {
    case TrackType.TRANSFORM:
      return '#f6e05e' // Yellow
    case TrackType.ANIMATION:
      return '#48bb78' // Green
    case TrackType.AUDIO:
      return '#4299e1' // Blue
    case TrackType.EVENT:
      return '#e53e3e' // Red
    case TrackType.CAMERA:
      return '#9f7aea' // Purple
    case TrackType.PROPERTY:
      return '#ed8936' // Orange
    default:
      return '#718096'
  }
}

const getTrackIcon = (type: TrackType): string => {
  switch (type) {
    case TrackType.TRANSFORM:
      return '📐'
    case TrackType.ANIMATION:
      return '🎬'
    case TrackType.AUDIO:
      return '🔊'
    case TrackType.EVENT:
      return '⚡'
    case TrackType.CAMERA:
      return '📷'
    case TrackType.PROPERTY:
      return '📊'
    default:
      return '📋'
  }
}

// ==================== TIME RULER ====================

interface TimeRulerProps {
  duration: number
  zoom: number
  scrollX: number
  currentTime: number
  onSeek: (time: number) => void
}

const TimeRuler: React.FC<TimeRulerProps> = ({
  duration,
  zoom,
  scrollX,
  currentTime,
  onSeek,
}) => {
  const rulerRef = useRef<HTMLDivElement>(null)

  const handleClick = (e: React.MouseEvent) => {
    const rect = rulerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + scrollX
    const time = x / (TIME_SCALE * zoom)
    onSeek(Math.max(0, Math.min(duration, time)))
  }

  const markers: number[] = []
  const step = 1 / zoom // seconds between major markers
  for (let t = 0; t <= duration; t += step) {
    markers.push(t)
  }

  return (
    <div
      ref={rulerRef}
      className="h-8 bg-gray-800 border-b border-gray-700 relative cursor-pointer overflow-hidden"
      style={{ marginLeft: HEADER_WIDTH }}
      onClick={handleClick}
    >
      {/* Time markers */}
      <div
        className="absolute h-full"
        style={{ transform: `translateX(-${scrollX}px)` }}
      >
        {markers.map((time) => (
          <div
            key={time}
            className="absolute h-full flex flex-col items-center"
            style={{ left: time * TIME_SCALE * zoom }}
          >
            <div className="text-xs text-gray-500 mt-1">
              {time.toFixed(1)}s
            </div>
            <div className="flex-1 w-px bg-gray-600" />
          </div>
        ))}
      </div>

      {/* Playhead */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-10"
        style={{
          left: currentTime * TIME_SCALE * zoom - scrollX,
        }}
      >
        <div className="absolute -left-1.5 -top-0 w-3 h-3 bg-red-500 rounded-full" />
      </div>
    </div>
  )
}

// ==================== TRACK HEADER ====================

interface TrackHeaderProps {
  track: SequencerTrack
  isSelected: boolean
  isMuted: boolean
  isLocked: boolean
  onSelect: () => void
  onToggleMute: () => void
  onToggleLock: () => void
  onDelete: () => void
}

const TrackHeader: React.FC<TrackHeaderProps> = ({
  track,
  isSelected,
  isMuted,
  isLocked,
  onSelect,
  onToggleMute,
  onToggleLock,
  onDelete,
}) => {
  const color = getTrackColor(track.type)

  return (
    <div
      className={`flex items-center px-2 border-b border-gray-700 cursor-pointer ${
        isSelected ? 'bg-gray-700' : 'bg-gray-800 hover:bg-gray-750'
      }`}
      style={{ height: TRACK_HEIGHT, width: HEADER_WIDTH }}
      onClick={onSelect}
    >
      {/* Track color indicator */}
      <div
        className="w-1 h-4 rounded mr-2"
        style={{ backgroundColor: color }}
      />

      {/* Icon */}
      <span className="mr-2 text-sm">{getTrackIcon(track.type)}</span>

      {/* Name */}
      <span className="flex-1 text-sm text-gray-300 truncate">{track.name}</span>

      {/* Controls */}
      <div className="flex gap-1">
        <button
          className={`w-5 h-5 text-xs rounded ${
            isMuted ? 'bg-red-600 text-white' : 'bg-gray-600 text-gray-400 hover:bg-gray-500'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleMute()
          }}
          title="Mute Track"
        >
          M
        </button>
        <button
          className={`w-5 h-5 text-xs rounded ${
            isLocked ? 'bg-yellow-600 text-white' : 'bg-gray-600 text-gray-400 hover:bg-gray-500'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleLock()
          }}
          title="Lock Track"
        >
          L
        </button>
        <button
          className="w-5 h-5 text-xs rounded bg-gray-600 text-red-400 hover:bg-red-600 hover:text-white"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          title="Delete Track"
        >
          ×
        </button>
      </div>
    </div>
  )
}

// ==================== KEYFRAME COMPONENT ====================

interface KeyframeComponentProps {
  keyframe: Keyframe<any>
  trackColor: string
  zoom: number
  scrollX: number
  isSelected: boolean
  onSelect: (id: string, addToSelection: boolean) => void
  onMove: (id: string, newTime: number) => void
}

const KeyframeComponent: React.FC<KeyframeComponentProps> = ({
  keyframe,
  trackColor,
  zoom,
  scrollX,
  isSelected,
  onSelect,
  onMove,
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartX, setDragStartX] = useState(0)
  const [originalTime, setOriginalTime] = useState(0)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDragging(true)
    setDragStartX(e.clientX)
    setOriginalTime(keyframe.time)
    onSelect(keyframe.id, e.shiftKey)
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartX
      const dt = dx / (TIME_SCALE * zoom)
      onMove(keyframe.id, Math.max(0, originalTime + dt))
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragStartX, originalTime, keyframe.id, zoom, onMove])

  const x = keyframe.time * TIME_SCALE * zoom - scrollX

  return (
    <div
      className={`absolute cursor-pointer transition-transform ${
        isSelected ? 'scale-125' : 'hover:scale-110'
      }`}
      style={{
        left: x - 6,
        top: TRACK_HEIGHT / 2 - 6,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Diamond shape */}
      <div
        className={`w-3 h-3 transform rotate-45 ${
          isSelected ? 'ring-2 ring-white' : ''
        }`}
        style={{ backgroundColor: trackColor }}
      />
    </div>
  )
}

// ==================== TRACK LANE ====================

interface TrackLaneProps {
  track: SequencerTrack
  zoom: number
  scrollX: number
  selectedKeyframes: Set<string>
  onKeyframeSelect: (id: string, addToSelection: boolean) => void
  onKeyframeMove: (id: string, newTime: number) => void
  onAddKeyframe: (time: number) => void
}

const TrackLane: React.FC<TrackLaneProps> = ({
  track,
  zoom,
  scrollX,
  selectedKeyframes,
  onKeyframeSelect,
  onKeyframeMove,
  onAddKeyframe,
}) => {
  const laneRef = useRef<HTMLDivElement>(null)
  const color = getTrackColor(track.type)

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = laneRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + scrollX
    const time = x / (TIME_SCALE * zoom)
    onAddKeyframe(time)
  }

  return (
    <div
      ref={laneRef}
      className="relative bg-gray-850 border-b border-gray-700"
      style={{
        height: TRACK_HEIGHT,
        backgroundImage: `repeating-linear-gradient(
          90deg,
          transparent,
          transparent ${TIME_SCALE * zoom - 1}px,
          #374151 ${TIME_SCALE * zoom - 1}px,
          #374151 ${TIME_SCALE * zoom}px
        )`,
        backgroundPosition: `${-scrollX}px 0`,
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Keyframes */}
      {track.keyframes.map((kf) => (
        <KeyframeComponent
          key={kf.id}
          keyframe={kf}
          trackColor={color}
          zoom={zoom}
          scrollX={scrollX}
          isSelected={selectedKeyframes.has(kf.id)}
          onSelect={onKeyframeSelect}
          onMove={onKeyframeMove}
        />
      ))}
    </div>
  )
}

// ==================== TRANSPORT CONTROLS ====================

interface TransportControlsProps {
  isPlaying: boolean
  currentTime: number
  duration: number
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onSeek: (time: number) => void
}

const TransportControls: React.FC<TransportControlsProps> = ({
  isPlaying,
  currentTime,
  duration,
  onPlay,
  onPause,
  onStop,
  onSeek,
}) => {
  return (
    <div className="flex items-center gap-2 p-2 bg-gray-800 border-b border-gray-700">
      {/* Play/Pause */}
      <button
        className={`w-8 h-8 flex items-center justify-center rounded ${
          isPlaying ? 'bg-yellow-600' : 'bg-green-600'
        } hover:opacity-80`}
        onClick={isPlaying ? onPause : onPlay}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Stop */}
      <button
        className="w-8 h-8 flex items-center justify-center rounded bg-red-600 hover:opacity-80"
        onClick={onStop}
      >
        ⏹
      </button>

      {/* Go to start */}
      <button
        className="w-8 h-8 flex items-center justify-center rounded bg-gray-700 hover:bg-gray-600"
        onClick={() => onSeek(0)}
      >
        ⏮
      </button>

      {/* Go to end */}
      <button
        className="w-8 h-8 flex items-center justify-center rounded bg-gray-700 hover:bg-gray-600"
        onClick={() => onSeek(duration)}
      >
        ⏭
      </button>

      {/* Time display */}
      <div className="flex items-center gap-2 ml-4 px-3 py-1 bg-gray-900 rounded">
        <span className="text-green-400 font-mono text-sm">
          {currentTime.toFixed(2)}s
        </span>
        <span className="text-gray-500">/</span>
        <span className="text-gray-400 font-mono text-sm">
          {duration.toFixed(2)}s
        </span>
      </div>

      {/* Frame counter */}
      <div className="px-2 py-1 bg-gray-900 rounded text-xs text-gray-500">
        Frame: {Math.floor(currentTime * 60)}
      </div>
    </div>
  )
}

// ==================== PROPERTIES PANEL ====================

interface KeyframePropertiesProps {
  selectedKeyframes: Keyframe<any>[]
  onUpdateInterpolation: (interpolation: KeyframeInterpolation) => void
}

const KeyframeProperties: React.FC<KeyframePropertiesProps> = ({
  selectedKeyframes,
  onUpdateInterpolation,
}) => {
  if (selectedKeyframes.length === 0) {
    return (
      <div className="w-56 bg-gray-900 border-l border-gray-700 p-4">
        <div className="text-gray-500 text-sm">No keyframe selected</div>
        <div className="mt-4 text-xs text-gray-600">
          <p>Double-click on a track to add keyframes</p>
          <p className="mt-2">Shift+click to select multiple</p>
        </div>
      </div>
    )
  }

  const keyframe = selectedKeyframes[0]

  return (
    <div className="w-56 bg-gray-900 border-l border-gray-700 p-4">
      <div className="text-sm font-medium text-white mb-4">
        Keyframe Properties
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-400">Time</label>
          <div className="text-sm text-gray-300">{keyframe.time.toFixed(3)}s</div>
        </div>

        <div>
          <label className="text-xs text-gray-400">Interpolation</label>
          <select
            value={keyframe.interpolation}
            onChange={(e) => onUpdateInterpolation(e.target.value as KeyframeInterpolation)}
            className="w-full mt-1 bg-gray-800 text-gray-300 text-sm px-2 py-1.5 rounded"
          >
            {Object.values(KeyframeInterpolation).map((interp) => (
              <option key={interp} value={interp}>
                {interp}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400">Value</label>
          <div className="text-xs text-gray-500 mt-1 p-2 bg-gray-800 rounded">
            {JSON.stringify(keyframe.value, null, 2)}
          </div>
        </div>

        {selectedKeyframes.length > 1 && (
          <div className="text-xs text-yellow-500">
            {selectedKeyframes.length} keyframes selected
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== MAIN SEQUENCER EDITOR ====================

export const SequencerEditor: React.FC = () => {
  // Create sample sequence
  const [sequence] = useState(() => {
    const seq = new Sequence('CinematicSequence_01')
    seq.duration = 10

    // Add Camera track
    const cameraTrack = new (class extends SequencerTrack {
      constructor() {
        super('MainCamera', TrackType.CAMERA)
      }
      getValueAtTime() { return null }
    })()
    cameraTrack.addKeyframe(0, { position: { x: 0, y: 2, z: -5 }, rotation: { x: 0, y: 0, z: 0 } })
    cameraTrack.addKeyframe(3, { position: { x: 5, y: 3, z: 0 }, rotation: { x: 0, y: 90, z: 0 } })
    cameraTrack.addKeyframe(7, { position: { x: 0, y: 5, z: 5 }, rotation: { x: -30, y: 180, z: 0 } })
    seq.addTrack(cameraTrack)

    // Add Transform track
    const transformTrack = new (class extends SequencerTrack {
      constructor() {
        super('Player', TrackType.TRANSFORM)
      }
      getValueAtTime() { return { x: 0, y: 0, z: 0 } }
    })()
    transformTrack.addKeyframe(0, { x: 0, y: 0, z: 0 })
    transformTrack.addKeyframe(5, { x: 10, y: 0, z: 0 })
    transformTrack.addKeyframe(10, { x: 10, y: 0, z: 10 })
    seq.addTrack(transformTrack)

    // Add Animation track
    const animTrack = new (class extends SequencerTrack {
      constructor() {
        super('Player Animation', TrackType.ANIMATION)
      }
      getValueAtTime() { return null }
    })()
    animTrack.addKeyframe(0, 'Idle')
    animTrack.addKeyframe(0.5, 'Walk')
    animTrack.addKeyframe(5, 'Run')
    animTrack.addKeyframe(9, 'Walk')
    animTrack.addKeyframe(10, 'Idle')
    seq.addTrack(animTrack)

    // Add Event track
    const eventTrack = new (class extends SequencerTrack {
      constructor() {
        super('Events', TrackType.EVENT)
      }
      getValueAtTime() { return null }
    })()
    eventTrack.addKeyframe(0, { event: 'OnSequenceStart' })
    eventTrack.addKeyframe(5, { event: 'OnHalfway', data: { checkpoint: 1 } })
    eventTrack.addKeyframe(10, { event: 'OnSequenceEnd' })
    seq.addTrack(eventTrack)

    // Add Audio track
    const audioTrack = new (class extends SequencerTrack {
      constructor() {
        super('BGM', TrackType.AUDIO)
      }
      getValueAtTime() { return { playing: false, volume: 1 } }
    })()
    audioTrack.addKeyframe(0, { clip: 'cinematic_music.wav', volume: 0.8 })
    audioTrack.addKeyframe(8, { volume: 0.3 })
    seq.addTrack(audioTrack)

    return seq
  })

  const [player] = useState(() => {
    const p = new SequencerPlayer()
    p.loadSequence(sequence)
    return p
  })

  const [timelineState, setTimelineState] = useState<TimelineState>({
    zoom: 1,
    scrollX: 0,
    currentTime: 0,
    isPlaying: false,
    duration: sequence.duration,
  })

  const [selection, setSelection] = useState<Selection>({
    trackId: null,
    keyframeIds: new Set(),
  })

  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set())
  const [lockedTracks, setLockedTracks] = useState<Set<string>>(new Set())
  const [, forceUpdate] = useState({})

  // Animation loop for playback
  useEffect(() => {
    let animationId: number

    const update = () => {
      if (player.state === PlaybackState.PLAYING) {
        setTimelineState(prev => ({
          ...prev,
          currentTime: player.currentTime,
          isPlaying: player.state === PlaybackState.PLAYING,
        }))
        animationId = requestAnimationFrame(update)
      }
    }

    if (timelineState.isPlaying) {
      animationId = requestAnimationFrame(update)
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [timelineState.isPlaying, player])

  // Playback controls
  const handlePlay = useCallback(() => {
    player.play()
    setTimelineState(prev => ({ ...prev, isPlaying: true }))
  }, [player])

  const handlePause = useCallback(() => {
    player.pause()
    setTimelineState(prev => ({ ...prev, isPlaying: false }))
  }, [player])

  const handleStop = useCallback(() => {
    player.stop()
    setTimelineState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }))
  }, [player])

  const handleSeek = useCallback((time: number) => {
    player.seek(time)
    setTimelineState(prev => ({ ...prev, currentTime: time }))
  }, [player])

  // Track selection
  const handleTrackSelect = useCallback((trackId: string) => {
    setSelection(prev => ({ ...prev, trackId }))
  }, [])

  // Keyframe selection
  const handleKeyframeSelect = useCallback((keyframeId: string, addToSelection: boolean) => {
    setSelection(prev => {
      const newSet = addToSelection ? new Set(prev.keyframeIds) : new Set<string>()
      if (newSet.has(keyframeId)) {
        newSet.delete(keyframeId)
      } else {
        newSet.add(keyframeId)
      }
      return { ...prev, keyframeIds: newSet }
    })
  }, [])

  // Keyframe move
  const handleKeyframeMove = useCallback((keyframeId: string, newTime: number) => {
    for (const track of sequence.tracks) {
      const kf = track.keyframes.find(k => k.id === keyframeId)
      if (kf) {
        kf.time = newTime
        break
      }
    }
    forceUpdate({})
  }, [sequence])

  // Add keyframe
  const handleAddKeyframe = useCallback((trackId: string, time: number) => {
    const track = sequence.tracks.find(t => t.id === trackId)
    if (track && !lockedTracks.has(trackId)) {
      // Add with default value based on track type
      const defaultValues: Record<TrackType, any> = {
        [TrackType.TRANSFORM]: { x: 0, y: 0, z: 0 },
        [TrackType.ANIMATION]: 'Idle',
        [TrackType.AUDIO]: { volume: 1 },
        [TrackType.EVENT]: { event: 'NewEvent' },
        [TrackType.CAMERA]: { position: { x: 0, y: 0, z: 0 } },
        [TrackType.PROPERTY]: { value: 0 },
        [TrackType.VISIBILITY]: true,
        [TrackType.MATERIAL]: { parameter: 'color', value: '#ffffff' },
        [TrackType.PARTICLE]: { enabled: true },
      }
      track.addKeyframe(time, defaultValues[track.type])
      forceUpdate({})
    }
  }, [sequence, lockedTracks])

  // Toggle mute
  const handleToggleMute = useCallback((trackId: string) => {
    setMutedTracks(prev => {
      const newSet = new Set(prev)
      if (newSet.has(trackId)) {
        newSet.delete(trackId)
      } else {
        newSet.add(trackId)
      }
      return newSet
    })
  }, [])

  // Toggle lock
  const handleToggleLock = useCallback((trackId: string) => {
    setLockedTracks(prev => {
      const newSet = new Set(prev)
      if (newSet.has(trackId)) {
        newSet.delete(trackId)
      } else {
        newSet.add(trackId)
      }
      return newSet
    })
  }, [])

  // Get selected keyframes
  const selectedKeyframes: Keyframe<any>[] = []
  for (const track of sequence.tracks) {
    for (const kf of track.keyframes) {
      if (selection.keyframeIds.has(kf.id)) {
        selectedKeyframes.push(kf)
      }
    }
  }

  // Update interpolation
  const handleUpdateInterpolation = useCallback((interpolation: KeyframeInterpolation) => {
    for (const kf of selectedKeyframes) {
      kf.interpolation = interpolation
    }
    forceUpdate({})
  }, [selectedKeyframes])

  // Zoom controls
  const handleZoom = useCallback((delta: number) => {
    setTimelineState(prev => ({
      ...prev,
      zoom: Math.max(0.1, Math.min(4, prev.zoom + delta)),
    }))
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        timelineState.isPlaying ? handlePause() : handlePlay()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete selected keyframes
        for (const track of sequence.tracks) {
          track.keyframes = track.keyframes.filter(
            kf => !selection.keyframeIds.has(kf.id)
          )
        }
        setSelection(prev => ({ ...prev, keyframeIds: new Set() }))
        forceUpdate({})
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [timelineState.isPlaying, handlePlay, handlePause, sequence, selection])

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Transport Controls */}
      <TransportControls
        isPlaying={timelineState.isPlaying}
        currentTime={timelineState.currentTime}
        duration={timelineState.duration}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onSeek={handleSeek}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-850 border-b border-gray-700">
        <span className="text-sm text-gray-300">{sequence.name}</span>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">Zoom:</span>
        <button
          className="w-6 h-6 text-xs bg-gray-700 rounded hover:bg-gray-600"
          onClick={() => handleZoom(-0.2)}
        >
          -
        </button>
        <span className="w-12 text-center text-xs text-gray-400">
          {(timelineState.zoom * 100).toFixed(0)}%
        </span>
        <button
          className="w-6 h-6 text-xs bg-gray-700 rounded hover:bg-gray-600"
          onClick={() => handleZoom(0.2)}
        >
          +
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Timeline area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Time ruler */}
          <TimeRuler
            duration={timelineState.duration}
            zoom={timelineState.zoom}
            scrollX={timelineState.scrollX}
            currentTime={timelineState.currentTime}
            onSeek={handleSeek}
          />

          {/* Tracks */}
          <div className="flex-1 overflow-auto">
            {sequence.tracks.map((track) => (
              <div key={track.id} className="flex">
                {/* Track header */}
                <TrackHeader
                  track={track}
                  isSelected={selection.trackId === track.id}
                  isMuted={mutedTracks.has(track.id)}
                  isLocked={lockedTracks.has(track.id)}
                  onSelect={() => handleTrackSelect(track.id)}
                  onToggleMute={() => handleToggleMute(track.id)}
                  onToggleLock={() => handleToggleLock(track.id)}
                  onDelete={() => {
                    sequence.removeTrack(track.id)
                    forceUpdate({})
                  }}
                />

                {/* Track lane */}
                <div className="flex-1 overflow-hidden">
                  <TrackLane
                    track={track}
                    zoom={timelineState.zoom}
                    scrollX={timelineState.scrollX}
                    selectedKeyframes={selection.keyframeIds}
                    onKeyframeSelect={handleKeyframeSelect}
                    onKeyframeMove={handleKeyframeMove}
                    onAddKeyframe={(time) => handleAddKeyframe(track.id, time)}
                  />
                </div>
              </div>
            ))}

            {/* Add track button */}
            <div
              className="flex items-center justify-center h-8 border-b border-gray-700 bg-gray-850 hover:bg-gray-800 cursor-pointer group"
              onClick={() => {
                // Show track type selector
                const trackTypes: { type: TrackType; name: string; icon: string }[] = [
                  { type: TrackType.TRANSFORM, name: 'Transform', icon: '📐' },
                  { type: TrackType.ANIMATION, name: 'Animation', icon: '🎬' },
                  { type: TrackType.AUDIO, name: 'Audio', icon: '🔊' },
                  { type: TrackType.EVENT, name: 'Event', icon: '⚡' },
                  { type: TrackType.CAMERA, name: 'Camera', icon: '📷' },
                  { type: TrackType.PROPERTY, name: 'Property', icon: '📊' },
                ]
                
                const trackName = prompt('Enter track name:')
                if (!trackName) return
                
                const name = `Track ${sequence.tracks.length + 1}`
                const newTrack = new PropertyTrack(trackName || name)
                sequence.addTrack(newTrack)
                forceUpdate({})
              }}
            >
              <span className="text-xs text-gray-500 group-hover:text-gray-300">+ Add Track</span>
            </div>
          </div>

          {/* Playhead line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-20"
            style={{
              left: HEADER_WIDTH + timelineState.currentTime * TIME_SCALE * timelineState.zoom - timelineState.scrollX,
            }}
          />
        </div>

        {/* Properties Panel */}
        <KeyframeProperties
          selectedKeyframes={selectedKeyframes}
          onUpdateInterpolation={handleUpdateInterpolation}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1 bg-gray-850 border-t border-gray-700 text-xs text-gray-500">
        <span>Tracks: {sequence.tracks.length}</span>
        <span>Duration: {sequence.duration}s</span>
        <span>FPS: 60</span>
        <span>{selection.keyframeIds.size} keyframe(s) selected</span>
      </div>
    </div>
  )
}

export default SequencerEditor
