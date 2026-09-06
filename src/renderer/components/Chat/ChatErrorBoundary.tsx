import React from 'react'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'

interface ChatErrorBoundaryProps {
  children: React.ReactNode
  fallbackContent?: string
}

const ErrorFallback: React.FC<FallbackProps & { fallbackContent?: string }> = ({
  error,
  resetErrorBoundary,
  fallbackContent
}) => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown rendering error'

  return (
    <div className="p-3 my-2 rounded-lg border border-red-500/20 bg-red-500/5 text-xs text-red-600 dark:text-red-400">
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold">Rendering issue prevented full formatting</span>
        <button
          type="button"
          onClick={resetErrorBoundary}
          className="text-[11px] underline hover:opacity-80 cursor-pointer focus:outline-none"
        >
          Retry
        </button>
      </div>
      {fallbackContent ? (
        <pre className="mt-2 p-2 rounded bg-surface-100/80 text-black/80 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
          {fallbackContent}
        </pre>
      ) : (
        <p className="mt-1 text-[11px] opacity-80">{errorMessage}</p>
      )}
    </div>
  )
}

export const ChatErrorBoundary: React.FC<ChatErrorBoundaryProps> = ({
  children,
  fallbackContent
}) => {
  return (
    <ErrorBoundary
      fallbackRender={(props) => <ErrorFallback {...props} fallbackContent={fallbackContent} />}
    >
      {children}
    </ErrorBoundary>
  )
}
