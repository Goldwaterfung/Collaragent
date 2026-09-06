import React, { useEffect, useId, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'strict',
  fontFamily: 'Inter, sans-serif'
})

interface MermaidDiagramProps {
  code: string
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ code }) => {
  const reactId = useId()
  const elementId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCompiling, setIsCompiling] = useState(true)

  useEffect(() => {
    let isCancelled = false
    setIsCompiling(true)
    setError(null)

    const renderDiagram = async () => {
      try {
        const trimmedCode = code.trim()
        if (!trimmedCode) return

        const isValid = await mermaid.parse(trimmedCode).catch(() => false)
        if (!isValid) {
          if (!isCancelled) {
            setError('Diagram syntax incomplete or invalid')
            setIsCompiling(false)
          }
          return
        }

        const { svg } = await mermaid.render(elementId, trimmedCode)
        if (!isCancelled) {
          setSvgContent(svg)
          setError(null)
          setIsCompiling(false)
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          const message = err instanceof Error ? err.message : 'Failed to render Mermaid diagram'
          setError(message)
          setIsCompiling(false)
        }
      }
    }

    void renderDiagram()

    return () => {
      isCancelled = true
    }
  }, [code, elementId])

  if (error || !svgContent) {
    return (
      <div className="my-3 rounded-lg border border-surface-200 bg-surface-100/50 p-3 text-xs">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-surface-200/60 text-black/60">
          <span className="font-mono font-semibold text-[11px]">mermaid</span>
          <span className="text-[11px] text-amber-600">
            {isCompiling ? 'Compiling diagram...' : 'Incomplete / Syntax Error'}
          </span>
        </div>
        <pre className="overflow-x-auto font-mono text-[11px] text-black/80 whitespace-pre-wrap">
          {code}
        </pre>
      </div>
    )
  }

  return (
    <div className="my-3 rounded-lg border border-surface-200 bg-white p-4 shadow-2xs overflow-x-auto flex justify-center">
      <div
        className="mermaid-svg-container max-w-full"
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  )
}
