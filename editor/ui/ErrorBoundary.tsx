import React from 'react'

interface ErrorBoundaryProps {
  fallback: (error: Error, reset: () => void) => React.ReactNode
  onError?: (error: Error) => void
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Keeps a crash inside one panel from unmounting the whole editor
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset)
    return this.props.children
  }
}

export default ErrorBoundary
