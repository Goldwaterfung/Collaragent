import { useEffect, useRef, useState } from 'react'
import { SyncClient, SyncClientConfig } from '../sync/SyncClient'
import { isSyncPaused, subscribeSyncPause } from '../sync/syncPause'

export interface SyncSessionHookOptions<
  TCommand,
  TSnapshot,
  TLocalCommand
> extends SyncClientConfig<TCommand, TSnapshot> {
  instanceId: string | null | undefined
  path: string // Ensure path is provided for the session
  onSnapshot: (snapshot: TSnapshot) => void
  onRemoteCommand: (command: TCommand) => void
  onStagedChanges?: (commands: TCommand[], threadId?: string) => void
  subscribeToLocal: (handler: (cmd: TLocalCommand) => void) => () => void
  mapLocalToShared: (cmd: TLocalCommand) => TCommand | null
}

/**
 * A shared hook to manage WebSocket synchronization sessions using SyncClient.
 * Bridges the gap between the network protocol and local state management.
 */
export function useSyncSession<TCommand, TSnapshot, TLocalCommand>(
  options: SyncSessionHookOptions<TCommand, TSnapshot, TLocalCommand>
) {
  const {
    instanceId,
    onSnapshot,
    onRemoteCommand,
    onStagedChanges,
    subscribeToLocal,
    mapLocalToShared,
    ...clientConfig
  } = options

  // Host must be provided dynamically. If not available yet, we skip connection.
  const [client, setClient] = useState<SyncClient<TCommand, TSnapshot> | null>(null)
  const clientRef = useRef<SyncClient<TCommand, TSnapshot> | null>(null)
  const isApplyingRemoteRef = useRef(false)
  const isPausedRef = useRef(isSyncPaused())
  const pendingSnapshotRef = useRef<TSnapshot | null>(null)
  const onSnapshotRef = useRef(onSnapshot)
  onSnapshotRef.current = onSnapshot

  // 1. Connection lifecycle and inbound message handling
  useEffect(() => {
    // Skip if no instanceId or host (ports not yet available from session)
    if (!instanceId || !clientConfig.host) return

    pendingSnapshotRef.current = null

    const clientInstance = new SyncClient<TCommand, TSnapshot>(clientConfig)
    clientRef.current = clientInstance
    setClient(clientInstance)

    clientInstance.connect(instanceId).catch((err) => {
      console.error(
        `[useSyncSession] Connection failed for ${clientConfig.path}/${instanceId}`,
        err
      )
    })

    const unsubscribeMsg = clientInstance.onMessage((msg) => {
      if (msg.type === 'sync-snapshot') {
        // Remove type/version from message to get pure snapshot
        const { type: _type, version: _version, ...snapshot } = msg as Record<string, unknown>
        const typedSnapshot = snapshot as unknown as TSnapshot

        if (isPausedRef.current) {
          pendingSnapshotRef.current = typedSnapshot
          return
        }

        isApplyingRemoteRef.current = true
        try {
          onSnapshotRef.current(typedSnapshot)
        } finally {
          isApplyingRemoteRef.current = false
        }
      } else if (msg.type === 'sync-changes') {
        if (isPausedRef.current) return
        if (onStagedChanges) {
          onStagedChanges(msg.commands, msg.threadId)
        }
      }
    })

    const unsubscribeCmd = clientInstance.onCommand((cmd) => {
      if (isPausedRef.current) return
      isApplyingRemoteRef.current = true
      try {
        onRemoteCommand(cmd)
      } finally {
        isApplyingRemoteRef.current = false
      }
    })

    return () => {
      try {
        unsubscribeMsg()
        unsubscribeCmd()
        clientInstance.disconnect()
      } finally {
        clientRef.current = null
        setClient(null)
        pendingSnapshotRef.current = null
      }
    }
  }, [
    instanceId,
    clientConfig.path,
    clientConfig.host,
    clientConfig.stateReducer,
    onSnapshot,
    onRemoteCommand
  ])

  // 2. Outbound command broadcasting
  useEffect(() => {
    const unsubscribe = subscribeToLocal((localCmd) => {
      // Avoid echoing back commands that were triggered by remote updates
      if (isApplyingRemoteRef.current) return
      if (isPausedRef.current) return

      const client = clientRef.current
      if (!client) return

      const sharedCmd = mapLocalToShared(localCmd)
      if (sharedCmd) {
        client.send(sharedCmd).catch((err: unknown) => {
          console.debug('[useSyncSession] Outbound command unacknowledged on teardown:', err)
        })
      }
    })
    return unsubscribe
  }, [subscribeToLocal, mapLocalToShared])

  useEffect(() => {
    return subscribeSyncPause((paused) => {
      isPausedRef.current = paused
      if (!paused) {
        if (pendingSnapshotRef.current) {
          const buffered = pendingSnapshotRef.current
          pendingSnapshotRef.current = null
          isApplyingRemoteRef.current = true
          try {
            onSnapshotRef.current(buffered)
          } finally {
            isApplyingRemoteRef.current = false
          }
        }
        clientRef.current?.requestSync()
      }
    })
  }, [])

  return {
    client,
    isApplyingRemote: () => isApplyingRemoteRef.current,
    setApplyingRemote: (val: boolean) => {
      isApplyingRemoteRef.current = val
    }
  }
}
