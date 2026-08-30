import {
    DockviewReact,
    DockviewReadyEvent,
    IDockviewPanelProps,
    DockviewApi,
} from 'dockview-react';
import { useEffect, useState, useRef } from 'react';
import { Canvas } from '@workspace/canvas/components/Canvas';
import Cards from '@workspace/editor/components/CardEditor';
import { SkillEditor } from '@workspace/editor/components/SkillEditor';
import '@workspace/editor/style/style.css'
import { useInstanceContext, InstanceScope } from '@workspace/contexts/instance/InstanceContext';
import { useSkillsContext } from '@workspace/contexts/skills/SkillsContext';
import { CanvasProvider } from '@workspace/canvas/store';

const CanvasComponent = (props: IDockviewPanelProps) => {
    // Determine instance ID from panel ID
    const instanceId = props.api.id;

    return (
        <InstanceScope instanceId={instanceId}>
            <CanvasProvider>
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Canvas />
                </div>
            </CanvasProvider>
        </InstanceScope>
    );
};

const DocumentComponent = (props: IDockviewPanelProps) => {
    const instanceId = props.api.id;
    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Cards instanceId={instanceId} />
        </div>
    );
};

const SkillComponent = (props: IDockviewPanelProps) => {
    const skillMdPath = props.api.id;
    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#fff' }}>
            <SkillEditor skillMdPath={skillMdPath} />
        </div>
    );
};

const components = {
    canvas: CanvasComponent,
    document: DocumentComponent,
    skill: SkillComponent,
};

export const Workspace = (props: { theme?: string }) => {
    const { instanceId, setInstanceId, unsetInstanceId, instanceIds, openInstanceIds, instanceSummaries, isLoaded, setOpenInstanceIds } = useInstanceContext();
    const { skills, activeSkillPath, setActiveSkillPath } = useSkillsContext();
    const [api, setApi] = useState<DockviewApi | null>(null);
    const paramsRef = useRef({
        instanceId, instanceIds, openInstanceIds, instanceSummaries,
        skills, activeSkillPath, setActiveSkillPath, setInstanceId, unsetInstanceId, setOpenInstanceIds
    });

    // Keep ref updated for event handlers/callbacks that might be stale
    paramsRef.current = {
        instanceId, instanceIds, openInstanceIds, instanceSummaries,
        skills, activeSkillPath, setActiveSkillPath, setInstanceId, unsetInstanceId, setOpenInstanceIds
    };

    const isSkillId = (id: string) => paramsRef.current.skills.some(s => s.skillMdPath === id) || id.endsWith('SKILL.md');

    // Helper to look up instance type from summaries or skills
    const getInstanceType = (id: string): 'canvas' | 'document' | 'skill' => {
        if (isSkillId(id)) return 'skill';
        const summary = paramsRef.current.instanceSummaries.find(s => s.instanceId === id);
        return summary?.type === 'canvas' ? 'canvas' : 'document';
    };

    const getInstanceName = (id: string): string => {
        const skill = paramsRef.current.skills.find(s => s.skillMdPath === id);
        if (skill) return skill.name;

        const summary = paramsRef.current.instanceSummaries.find(s => s.instanceId === id);
        return summary?.name || id;
    };

    const onReady = (event: DockviewReadyEvent) => {
        setApi(event.api);

        const updateOpenPanels = () => {
            const panelIds = event.api.panels.map(panel => panel.id);
            paramsRef.current.setOpenInstanceIds(panelIds);
        };

        // Sync active panel change back to context
        event.api.onDidActivePanelChange((e) => {
            const panelId = e?.panel?.id;
            if (panelId) {
                if (isSkillId(panelId)) {
                    if (panelId !== paramsRef.current.activeSkillPath) {
                        paramsRef.current.setActiveSkillPath(panelId);
                    }
                    paramsRef.current.unsetInstanceId();
                } else {
                    if (panelId !== paramsRef.current.instanceId) {
                        paramsRef.current.setInstanceId(panelId);
                    }
                    paramsRef.current.setActiveSkillPath(null);
                }
            } else {
                paramsRef.current.unsetInstanceId();
                paramsRef.current.setActiveSkillPath(null);
            }
            updateOpenPanels();
        });

        event.api.onDidAddPanel(() => {
            updateOpenPanels();
        });

        event.api.onDidRemovePanel((panel) => {
            const removedId = panel.api.id;
            updateOpenPanels();

            if (paramsRef.current.instanceId === removedId || paramsRef.current.activeSkillPath === removedId) {
                const remainingIds = event.api.panels.map((item) => item.id);
                if (remainingIds.length > 0) {
                    if (isSkillId(remainingIds[0])) {
                        paramsRef.current.setActiveSkillPath(remainingIds[0]);
                        paramsRef.current.unsetInstanceId();
                    } else {
                        paramsRef.current.setInstanceId(remainingIds[0]);
                        paramsRef.current.setActiveSkillPath(null);
                    }
                } else {
                    paramsRef.current.unsetInstanceId();
                    paramsRef.current.setActiveSkillPath(null);
                }
            }
        });

        // Initialize with current instance if loaded
        const currentId = paramsRef.current.instanceId || paramsRef.current.activeSkillPath;
        if (currentId && isLoaded) {
            const instanceType = getInstanceType(currentId);
            event.api.addPanel({
                id: currentId,
                component: instanceType,
                title: getInstanceName(currentId),
                renderer: 'always',
            });
        }

        updateOpenPanels();
    };

    // Unified Sync Effect: Context -> Dockview (Open/Activate/Close)
    useEffect(() => {
        if (!api || !isLoaded) return;

        const nextOpenInstanceIds = openInstanceIds.filter((id) =>
            instanceIds.includes(id) || skills.some(s => s.skillMdPath === id) || id.endsWith('SKILL.md')
        );

        if (nextOpenInstanceIds.length !== openInstanceIds.length) {
            setOpenInstanceIds(nextOpenInstanceIds);
            return;
        }

        if (instanceId && !openInstanceIds.includes(instanceId)) {
            setOpenInstanceIds([...openInstanceIds, instanceId]);
            return;
        }

        if (activeSkillPath && !openInstanceIds.includes(activeSkillPath)) {
            setOpenInstanceIds([...openInstanceIds, activeSkillPath]);
            return;
        }

        const panels = api.panels;
        const openSet = new Set(openInstanceIds);

        openInstanceIds.forEach((id) => {
            if (!api.getPanel(id)) {
                const instanceType = getInstanceType(id);
                api.addPanel({
                    id,
                    component: instanceType,
                    title: getInstanceName(id),
                    renderer: 'always',
                });
            }
        });

        panels.forEach((panel) => {
            if (!openSet.has(panel.id)) {
                panel.api.close();
            }
        });

        const activeTarget = activeSkillPath || instanceId;
        if (activeTarget) {
            const panel = api.getPanel(activeTarget);
            if (panel && activePanelId(api) !== activeTarget) {
                panel.api.setActive();
            }
        }
    }, [api, instanceId, activeSkillPath, instanceIds, openInstanceIds, isLoaded, instanceSummaries, skills, setOpenInstanceIds]);

    const activePanelId = (dockApi: DockviewApi) => {
        return dockApi.activePanel?.id;
    }

    return (
        <div className="w-full h-full dockview-container">
            <DockviewReact
                className={`${props.theme || 'dockview-theme-custom'}`}
                onReady={onReady}
                components={components}
                disableFloatingGroups={true}
            />
        </div>
    );
};
