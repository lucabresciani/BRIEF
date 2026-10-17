import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Rendered instead of the children after an error; `reset` remounts the area. */
  fallback: (reset: () => void, error: Error) => ReactNode
  /** Changing this key resets the boundary (e.g. a new project). */
  resetKey?: unknown
}

interface State {
  error: Error | null
  key: unknown
}

/** Per-area boundary: a crash in the plot or a panel never takes the data or the rest of the app down. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[area error]', error, info.componentStack)
  }

  render() {
    if (this.state.error) return this.props.fallback(() => this.setState({ error: null }), this.state.error)
    return this.props.children
  }
}
