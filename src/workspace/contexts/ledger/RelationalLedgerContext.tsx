import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
  type JSX
} from 'react'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import {
  DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID,
  DEFAULT_RELATIONAL_LEDGER_NAME,
  DEFAULT_RELATIONAL_LEDGER_TYPE
} from '@shared/constants'
import { useProjectSession } from '../project/ProjectSession'

export interface RelationalLedgerContextValue {
  ledgerStore: RelationalLedgerStore
  dismissEdge: (edgeId: string) => Promise<void>
  refreshLedger: () => Promise<void>
}

const RelationalLedgerContext = createContext<RelationalLedgerContextValue | null>(null)

export interface RelationalLedgerProviderProps {
  children: ReactNode
  ledgerStore?: RelationalLedgerStore
  apiPort?: number | null
  hasSession?: boolean
}

export function RelationalLedgerProvider({
  children,
  ledgerStore: externalStore,
  apiPort: propApiPort,
  hasSession: propHasSession
}: RelationalLedgerProviderProps): JSX.Element {
  const [internalStore] = useState(() => new RelationalLedgerStore())
  const store = externalStore ?? internalStore
  const session = useProjectSession()
  const apiPort = propApiPort !== undefined ? propApiPort : session.apiPort
  const hasSession = propHasSession !== undefined ? propHasSession : session.hasSession
  const filePath = session.filePath

  const refreshLedger = useCallback(async () => {
    if (!hasSession || !apiPort) {
      store.clear()
      return
    }

    try {
      const res = await fetch(
        `http://localhost:${apiPort}/api/instances/${DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID}`
      )
      if (res.ok) {
        const data = (await res.json()) as {
          payload?: { edges?: unknown }
          content?: { edges?: unknown }
        }
        const edges = data.payload?.edges ?? data.content?.edges
        if (Array.isArray(edges)) {
          store.loadFromSnapshot(edges)
        } else {
          store.clear()
        }
      } else if (res.status === 404) {
        store.clear()
      }
    } catch (err: unknown) {
      console.warn('[RelationalLedgerContext] Failed to hydrate ledger from API:', err)
    }
  }, [apiPort, hasSession, store])

  useEffect(() => {
    if (hasSession && apiPort) {
      void refreshLedger()
    } else {
      store.clear()
    }
  }, [hasSession, apiPort, filePath, refreshLedger, store])

  const dismissEdge = useCallback(
    async (edgeId: string) => {
      store.removeEdge(edgeId)
      if (!hasSession || !apiPort) return

      const edges = store.exportSnapshot()
      try {
        const patchRes = await fetch(
          `http://localhost:${apiPort}/api/instances/${DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: { edges } })
          }
        )

        if (patchRes.status === 404) {
          let projectId = 'default'
          try {
            const listRes = await fetch(`http://localhost:${apiPort}/api/instances`)
            if (listRes.ok) {
              const listData = (await listRes.json()) as {
                projects?: Array<{ id: string }>
              }
              if (listData.projects?.[0]?.id) {
                projectId = listData.projects[0].id
              }
            }
          } catch (listErr: unknown) {
            console.warn('[RelationalLedgerContext] Could not resolve project list:', listErr)
          }

          const postRes = await fetch(`http://localhost:${apiPort}/api/instances`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID,
              name: DEFAULT_RELATIONAL_LEDGER_NAME,
              projectId,
              type: DEFAULT_RELATIONAL_LEDGER_TYPE,
              payload: { edges },
              metadata: { isHidden: true, isSystem: true }
            })
          })

          if (!postRes.ok) {
            throw new Error(`Failed to create ledger instance: HTTP ${postRes.status}`)
          }
        } else if (!patchRes.ok) {
          throw new Error(`Failed to update ledger instance: HTTP ${patchRes.status}`)
        }
      } catch (err: unknown) {
        console.error('[RelationalLedgerContext] Failed to persist dismissed edge:', err)
      }
    },
    [apiPort, hasSession, store]
  )

  const value = useMemo(
    () => ({
      ledgerStore: store,
      dismissEdge,
      refreshLedger
    }),
    [store, dismissEdge, refreshLedger]
  )

  return (
    <RelationalLedgerContext.Provider value={value}>{children}</RelationalLedgerContext.Provider>
  )
}

export function useRelationalLedger(): RelationalLedgerContextValue {
  const ctx = useContext(RelationalLedgerContext)
  if (!ctx) {
    throw new Error('useRelationalLedger must be used within a RelationalLedgerProvider')
  }
  return ctx
}

export function useOptionalRelationalLedger(): RelationalLedgerContextValue | null {
  return useContext(RelationalLedgerContext)
}
