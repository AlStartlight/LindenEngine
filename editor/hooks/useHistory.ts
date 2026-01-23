/**
 * useHistory Hook - Provides undo/redo functionality for editors
 */

import { useState, useCallback, useRef, useEffect } from 'react'

interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

interface UseHistoryReturn<T> {
  state: T
  setState: (newState: T | ((prev: T) => T)) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  clear: () => void
}

/**
 * Custom hook for managing undo/redo history
 * @param initialState - Initial state value
 * @param maxHistory - Maximum number of history entries (default: 50)
 * @returns Object with state, setState, undo, redo, and history status
 */
export function useHistory<T>(
  initialState: T,
  maxHistory: number = 50
): UseHistoryReturn<T> {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
  })

  // Track if we should record history (to avoid recording during undo/redo)
  const isUndoRedoRef = useRef(false)

  const setState = useCallback(
    (newState: T | ((prev: T) => T)) => {
      setHistory((currentHistory) => {
        const nextState =
          typeof newState === 'function'
            ? (newState as (prev: T) => T)(currentHistory.present)
            : newState

        // Don't add to history if state hasn't changed
        if (nextState === currentHistory.present) {
          return currentHistory
        }

        // Don't add to history during undo/redo operations
        if (isUndoRedoRef.current) {
          isUndoRedoRef.current = false
          return {
            ...currentHistory,
            present: nextState,
          }
        }

        // Add current state to past and update present
        const newPast = [...currentHistory.past, currentHistory.present]
        
        // Limit history size
        if (newPast.length > maxHistory) {
          newPast.shift()
        }

        return {
          past: newPast,
          present: nextState,
          future: [], // Clear future when new state is set
        }
      })
    },
    [maxHistory]
  )

  const undo = useCallback(() => {
    setHistory((currentHistory) => {
      if (currentHistory.past.length === 0) {
        return currentHistory
      }

      isUndoRedoRef.current = true

      const newPast = [...currentHistory.past]
      const newPresent = newPast.pop()!
      const newFuture = [currentHistory.present, ...currentHistory.future]

      return {
        past: newPast,
        present: newPresent,
        future: newFuture,
      }
    })
  }, [])

  const redo = useCallback(() => {
    setHistory((currentHistory) => {
      if (currentHistory.future.length === 0) {
        return currentHistory
      }

      isUndoRedoRef.current = true

      const newFuture = [...currentHistory.future]
      const newPresent = newFuture.shift()!
      const newPast = [...currentHistory.past, currentHistory.present]

      return {
        past: newPast,
        present: newPresent,
        future: newFuture,
      }
    })
  }, [])

  const clear = useCallback(() => {
    setHistory({
      past: [],
      present: history.present,
      future: [],
    })
  }, [history.present])

  return {
    state: history.present,
    setState,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    clear,
  }
}

/**
 * Hook to register keyboard shortcuts for undo/redo
 * @param undo - Undo function
 * @param redo - Redo function
 * @param canUndo - Whether undo is available
 * @param canRedo - Whether redo is available
 */
export function useUndoRedoShortcuts(
  undo: () => void,
  redo: () => void,
  canUndo: boolean,
  canRedo: boolean
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl/Cmd + Z (Undo)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        if (canUndo) {
          e.preventDefault()
          undo()
        }
      }
      // Check for Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y (Redo)
      else if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') ||
        ((e.ctrlKey || e.metaKey) && e.key === 'y')
      ) {
        if (canRedo) {
          e.preventDefault()
          redo()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, canUndo, canRedo])
}
