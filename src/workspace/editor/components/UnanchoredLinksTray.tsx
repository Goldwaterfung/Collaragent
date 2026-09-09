import { useCallback, useEffect, useState, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $isParagraphNode
} from 'lexical'
import { $createInlineClaimBadgeNode } from '../nodes/InlineClaimBadgeNode'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import { useOptionalRelationalLedger } from '@workspace/contexts/ledger/RelationalLedgerContext'
import type { RelationalLedgerEntry } from '@shared/wiki'

export interface UnanchoredLinksTrayProps {
  instanceId: string
  ledgerStore?: RelationalLedgerStore
}

export default function UnanchoredLinksTray({
  instanceId,
  ledgerStore: propLedgerStore
}: UnanchoredLinksTrayProps): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const ledgerContext = useOptionalRelationalLedger()
  const ledgerStore = propLedgerStore ?? ledgerContext?.ledgerStore
  const [unanchoredEdges, setUnanchoredEdges] = useState<RelationalLedgerEntry[]>([])

  const refreshEdges = useCallback(() => {
    if (!instanceId || !ledgerStore) {
      setUnanchoredEdges([])
      return
    }
    const outlinks = ledgerStore.getOutlinks(instanceId)
    const unanchored = outlinks.filter(
      (edge) =>
        (edge.provenance === 'canvas_relational' || edge.status === 'anchor_lost') &&
        edge.status !== 'archived'
    )
    setUnanchoredEdges(unanchored)
  }, [instanceId, ledgerStore])

  useEffect(() => {
    refreshEdges()
    if (!ledgerStore) return
    return ledgerStore.subscribe(() => {
      refreshEdges()
    })
  }, [refreshEdges, ledgerStore])

  const handleAnchorEdge = useCallback(
    (edge: RelationalLedgerEntry) => {
      editor.update(() => {
        const selection = $getSelection()
        const badgeNode = $createInlineClaimBadgeNode(
          edge.targetEntityId,
          edge.rel,
          edge.anchor?.justification || ''
        )

        if ($isRangeSelection(selection)) {
          selection.insertNodes([badgeNode])
        } else {
          const root = $getRoot()
          const firstChild = root.getFirstChild()
          if ($isParagraphNode(firstChild)) {
            firstChild.append(badgeNode)
          } else {
            const p = $createParagraphNode()
            p.append(badgeNode)
            root.append(p)
          }
        }
      })
    },
    [editor]
  )

  const handleDismissEdge = useCallback(
    async (edgeId: string) => {
      if (ledgerContext) {
        await ledgerContext.dismissEdge(edgeId)
      } else if (ledgerStore) {
        ledgerStore.removeEdge(edgeId)
      }
    },
    [ledgerContext, ledgerStore]
  )

  if (!ledgerStore || unanchoredEdges.length === 0) {
    return null
  }

  return (
    <div
      className="bg-surface-100/80 dark:bg-surface-850/80 backdrop-blur-xs border-b border-surface-200 dark:border-surface-750 px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs select-none"
      role="region"
      aria-label="Unanchored Relationships Tray"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 font-semibold text-surface-600 dark:text-surface-300">
          <span aria-hidden="true">⚡</span>
          <span>Unanchored Links ({unanchoredEdges.length}):</span>
        </div>

        {unanchoredEdges.map((edge) => (
          <div
            key={edge.id}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium transition-colors ${
              edge.status === 'anchor_lost'
                ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                : 'bg-surface-50 text-surface-700 border-surface-300 dark:bg-surface-800 dark:text-surface-200 dark:border-surface-700'
            }`}
          >
            {edge.status === 'anchor_lost' && (
              <span title="Anchor block was removed from document" aria-hidden="true">
                ⚠️
              </span>
            )}
            <span className="font-semibold">{edge.rel}:</span>
            <span className="truncate max-w-36" title={edge.targetEntityId}>
              {edge.targetEntityId}
            </span>

            <button
              type="button"
              onClick={() => handleAnchorEdge(edge)}
              className="ml-1 text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200 font-bold focus:outline-none cursor-pointer"
              title="Anchor into current document position"
              aria-label={`Anchor ${edge.rel} relation to ${edge.targetEntityId}`}
            >
              ➕
            </button>

            <button
              type="button"
              onClick={() => handleDismissEdge(edge.id)}
              className="ml-0.5 text-surface-400 hover:text-rose-600 dark:hover:text-rose-400 focus:outline-none cursor-pointer"
              title="Dismiss relationship"
              aria-label={`Dismiss ${edge.rel} relation to ${edge.targetEntityId}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
