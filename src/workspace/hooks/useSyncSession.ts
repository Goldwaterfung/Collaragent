import { useEffect, useRef, useState } from 'react';
import { SyncClient, SyncClientConfig } from '../sync/SyncClient';
import { isSyncPaused, subscribeSyncPause } from '../sync/syncPause';

export interface SyncSessionHookOptions<TCommand, TSnapshot, TLocalCommand> 
    extends SyncClientConfig<TCommand, TSnapshot> {
    instanceId: string | null | undefined;
    path: string; // Ensure path is provided for the session
    onSnapshot: (snapshot: TSnapshot) => void;
    onRemoteCommand: (command: TCommand) => void;
    onStagedChanges?: (commands: TCommand[]) => void;
    subscribeToLocal: (handler: (cmd: TLocalCommand) => void) => () => void;
    mapLocalToShared: (cmd: TLocalCommand) => TCommand | null;
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
    } = options;

    // Host must be provided dynamically. If not available yet, we skip connection.
    const [client, setClient] = useState<SyncClient<TCommand, TSnapshot> | null>(null);
    const clientRef = useRef<SyncClient<TCommand, TSnapshot> | null>(null);
    const isApplyingRemoteRef = useRef(false);
    const isPausedRef = useRef(isSyncPaused());

    // 1. Connection lifecycle and inbound message handling
    useEffect(() => {
        // Skip if no instanceId or host (ports not yet available from session)
        if (!instanceId || !clientConfig.host) return;

        const clientInstance = new SyncClient<TCommand, TSnapshot>(clientConfig);
        clientRef.current = clientInstance;
        setClient(clientInstance);

        clientInstance.connect(instanceId).catch(err => {
            console.error(`[useSyncSession] Connection failed for ${clientConfig.path}/${instanceId}`, err);
        });

        const unsubscribeMsg = clientInstance.onMessage((msg) => {
            if (isPausedRef.current) return;
            if (msg.type === 'sync-snapshot') {
                // Remove type/version from message to get pure snapshot
                const { type, version, ...snapshot } = msg as any;
                
                isApplyingRemoteRef.current = true;
                try {
                    onSnapshot(snapshot as TSnapshot);
                } finally {
                    isApplyingRemoteRef.current = false;
                }
            } else if (msg.type === 'sync-changes') {
                if (onStagedChanges) {
                    onStagedChanges(msg.commands);
                }
            }
        });

        const unsubscribeCmd = clientInstance.onCommand((cmd) => {
            if (isPausedRef.current) return;
            isApplyingRemoteRef.current = true;
            try {
                onRemoteCommand(cmd);
            } finally {
                isApplyingRemoteRef.current = false;
            }
        });

        return () => {
            unsubscribeMsg();
            unsubscribeCmd();
            clientInstance.disconnect();
            clientRef.current = null;
            setClient(null);
        };
    }, [instanceId, clientConfig.path, clientConfig.host, clientConfig.stateReducer, onSnapshot, onRemoteCommand]);

    // 2. Outbound command broadcasting
    useEffect(() => {
        const unsubscribe = subscribeToLocal((localCmd) => {
            // Avoid echoing back commands that were triggered by remote updates
            if (isApplyingRemoteRef.current) return;
            if (isPausedRef.current) return;

            const client = clientRef.current;
            if (!client) return;

            const sharedCmd = mapLocalToShared(localCmd);
            if (sharedCmd) {
                client.send(sharedCmd);
            }
        });
        return unsubscribe;
    }, [subscribeToLocal, mapLocalToShared]);

    useEffect(() => {
        return subscribeSyncPause((paused) => {
            isPausedRef.current = paused;
            if (!paused) {
                clientRef.current?.requestSync();
            }
        });
    }, []);

    return {
        client,
        isApplyingRemote: () => isApplyingRemoteRef.current,
        setApplyingRemote: (val: boolean) => { isApplyingRemoteRef.current = val; }
    };
}
