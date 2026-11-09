import { Component, type ReactNode } from 'react'

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-bg-cream)] px-6 text-center">
      <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">{title}</h1>
      <p className="max-w-lg text-sm text-[var(--color-text-secondary)]">{message}</p>
    </div>
  )
}

export function ConfigErrorScreen({ message }: { message: string }) {
  return <ErrorScreen title="Hiba is not configured" message={message} />
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      const detail = import.meta.env.DEV ? this.state.error.message : 'Please refresh the page.'
      return <ErrorScreen title="Something went wrong" message={detail} />
    }
    return this.props.children
  }
}
