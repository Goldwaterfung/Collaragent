import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { instanceService } from '@shared/services/InstanceService';
import { checkpointService } from '@shared/services/CheckpointService';
import { setSyncPaused } from '../../sync/syncPause';

interface ProjectSessionContextValue {
    apiPort: number | null;
    wsPort: number | null;
    hasSession: boolean;
    filePath: string | null;
}

const ProjectSessionContext = createContext<ProjectSessionContextValue | null>(null);

export function ProjectSessionProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<ProjectSessionContextValue>({
        apiPort: null,
        wsPort: null,
        hasSession: false,
        filePath: null,
    });

    const [isConfigured, setIsConfigured] = useState(false);

    useEffect(() => {
        // Parse query params for ports
        const params = new URLSearchParams(window.location.search);
        const apiPortStr = params.get('apiPort');
        const wsPortStr = params.get('wsPort');


        const filePath = params.get('filePath');

        if (apiPortStr && wsPortStr) {
            const apiPort = parseInt(apiPortStr, 10);
            const wsPort = parseInt(wsPortStr, 10);

            // CRITICAL: Configure the singleton service before rendering children
            const baseUrl = `http://localhost:${apiPort}/api`;
            instanceService.setBaseUrl(baseUrl);
            checkpointService.setBaseUrl(baseUrl);

            console.log(`[ProjectSession] Configured session: API=${apiPort}, WS=${wsPort}, File=${filePath}`);

            setSession({
                apiPort,
                wsPort,
                hasSession: true,
                filePath
            });
            // Expose to non-react modules (e.g., services) for convenience
            try {
                // @ts-ignore
                (window).projectSession = { apiPort, wsPort, filePath };
            } catch (e) { }
        } else {
            console.log('[ProjectSession] No session ports found (Welcome Mode)');
            try {
                // @ts-ignore
                delete (window).projectSession;
            } catch (e) { }
        }

        setIsConfigured(true);
    }, []);

    // Listen for global system:reload messages (e.g. from File Watcher)
    useEffect(() => {
        if (!session.hasSession || !session.wsPort) return;

        const url = `ws://localhost:${session.wsPort}/ws/editor-content`;
        console.log(`[ProjectSession] Connecting to system watcher: ${url}`);

        const ws = new WebSocket(url);

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'system:reload') {
                    console.warn('[ProjectSession] External change detected. Reloading application...');
                    window.location.reload();
                }
            } catch (err) {
                // Ignore parse errors
            }
        };

        ws.onopen = () => {
            // Optional: send hello or heartbeat
            ws.send(JSON.stringify({ type: 'hello', clientId: 'renderer-system-watcher' }));
        };

        ws.onerror = (err) => {
            console.error('[ProjectSession] System watcher error:', err);
        };

        return () => {
            ws.close();
        };
    }, [session.hasSession, session.wsPort]);

    useEffect(() => {
        if (!window.checkpointIPC?.onQuiesce || !window.checkpointIPC?.onResume) return;

        const offQuiesce = window.checkpointIPC.onQuiesce(() => setSyncPaused(true));
        const offResume = window.checkpointIPC.onResume(() => setSyncPaused(false));

        return () => {
            offQuiesce();
            offResume();
        };
    }, []);

    if (!isConfigured) {
        return <div className="flex h-screen w-screen items-center justify-center bg-surface-50">Loading...</div>;
    }

    // If we have no session, we still render children (App), but the context will have hasSession=false.
    // This allows the App to render the WelcomeScreen inside its own layout (e.g. in the middle pane).
    // if (!session.hasSession) {
    //     return <WelcomeScreen />;
    // }

    return (
        <ProjectSessionContext.Provider value={session}>
            {children}
        </ProjectSessionContext.Provider>
    );
}

export function useProjectSession() {
    const ctx = useContext(ProjectSessionContext);
    if (!ctx) {
        // It's okay to use this outside of a rigorous session if we are defensive, 
        // but ideally it should be inside.
        return { hasSession: false, apiPort: null, wsPort: null, filePath: null };
    }
    return ctx;
}
