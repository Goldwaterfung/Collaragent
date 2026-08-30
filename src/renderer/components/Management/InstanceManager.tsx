import { useState, useMemo, Fragment, useEffect, useRef } from 'react';
import { useInstanceContext } from '@workspace/contexts/instance/InstanceContext';
import { CanvasIcon } from '../../assets/icons/CanvasIcon';
import { DocumentIcon } from '../../assets/icons/DocumentIcon';
import { TrashIcon } from '../../assets/icons/TrashIcon';
import { PlusIcon } from '../../assets/icons/PlusIcon';
import { ExportIcon } from '../../assets/icons/ExportIcon';
import { instanceService } from '@shared/services/InstanceService';
import { useProjectSession } from '@workspace/contexts/project/ProjectSession';
import { exportInstanceToDocx } from '@workspace/editor/utils/docxExportUtils';

function CreateInstanceModal({
    isOpen,
    onClose,
    onConfirm,
    type,
    projectId
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (name: string, projectId?: string) => void;
    type: 'canvas' | 'document';
    projectId?: string;
}) {
    const [name, setName] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onConfirm(name.trim(), projectId);
            setName('');
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px] p-4">
            <div className="bg-surface-50 border border-surface-200 rounded-xl shadow-2xl w-full max-w-sm p-5 overflow-hidden flex flex-col pt-4 animate-in fade-in zoom-in duration-200">
                <h3 className="text-sm font-bold text-(--ev-c-text-1) mb-4 px-1 uppercase tracking-wide">
                    Name {type === 'canvas' ? 'Canvas' : 'Document'}
                </h3>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <input
                        autoFocus
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter name..."
                        className="w-full px-3 py-2 bg-surface-100 border border-surface-200 rounded-lg focus:outline-none text-(--ev-c-text-1) placeholder-(--ev-c-text-3) text-sm"
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-medium text-(--ev-c-text-2) hover:bg-surface-100 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className="px-4 py-2 text-xs font-bold bg-primary text-(--ev-c-black) rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                        >
                            Confirm
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function CreateProjectModal({
    isOpen,
    onClose,
    onConfirm
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (name: string) => void;
}) {
    const [name, setName] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onConfirm(name.trim());
            setName('');
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px] p-4">
            <div className="bg-surface-50 border border-surface-200 rounded-xl shadow-2xl w-full max-w-sm p-5 overflow-hidden flex flex-col pt-4 animate-in fade-in zoom-in duration-200">
                <h3 className="text-sm font-bold text-(--ev-c-text-1) mb-4 px-1 uppercase tracking-wide">
                    New Project
                </h3>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <input
                        autoFocus
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Project Name..."
                        className="w-full px-3 py-2 bg-surface-100 border border-surface-200 rounded-lg focus:outline-none text-(--ev-c-text-1) placeholder-(--ev-c-text-3) text-sm"
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-medium text-(--ev-c-text-2) hover:bg-surface-100 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className="px-4 py-2 text-xs font-bold bg-primary text-(--ev-c-black) rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                        >
                            Create
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function ContextMenu({ x, y, onClose, onDelete, onExport, type, name, depth, menuRef, selectedCount }: {
    x: number;
    y: number;
    onClose: () => void;
    onDelete: () => void;
    onExport?: () => void;
    type: 'canvas' | 'document';
    name: string;
    depth: number;
    menuRef: React.RefObject<HTMLDivElement | null>;
    selectedCount: number;
}) {
    return (
        <div
            ref={menuRef}
            className="fixed z-100 bg-surface-50 border border-surface-200 rounded-lg shadow-xl py-1 min-w-[140px] animate-in fade-in zoom-in duration-100"
            style={{ left: x, top: y }}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="px-3 py-1.5 border-b border-surface-100">
                <div className="text-[10px] uppercase font-bold text-(--ev-c-text-3) tracking-wider truncate max-w-[120px]">
                    {selectedCount > 1 ? `${selectedCount} items selected` : name}
                </div>
            </div>
            {type === 'document' && selectedCount === 1 && onExport && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onExport();
                        onClose();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-(--ev-c-text-2) hover:bg-surface-100 transition-colors text-left"
                >
                    <ExportIcon width={14} height={14} />
                    <span>Export to DOCX</span>
                </button>
            )}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                    onClose();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors text-left"
            >
                <TrashIcon width={14} height={14} />
                <span>Delete {selectedCount > 1 ? `${selectedCount} Items` : (depth > 0 ? 'Node' : (type === 'canvas' ? 'Canvas' : 'Document'))}</span>
            </button>
        </div>
    );
}

interface ProjectSectionProps {
    pid: string;
    name: string;
    group: { canvases: any[], documents: any[] };
    isExpanded: boolean;
    onToggle: (pid: string) => void;
    onOpenCreateModal: (type: 'canvas' | 'document', pid: string) => void;
    onDeleteProject: (pid: string) => void;
    renderInstanceItem: (summary: any, type: 'canvas' | 'document') => React.ReactNode;
    onImportMarkdown: (pid: string, name: string, content: string) => Promise<void>;
    isImportingGlobal?: boolean;
    onInstanceSelect?: () => void;
    onPromote?: (id: string) => void;
}

function ProjectSection({
    pid,
    name,
    group,
    isExpanded,
    onToggle,
    onOpenCreateModal,
    onDeleteProject,
    renderInstanceItem,
    onImportMarkdown,
    isImportingGlobal,
    onPromote
}: ProjectSectionProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isPromoteDragOver, setIsPromoteDragOver] = useState(false);
    const isEmpty = group.canvases.length === 0 && group.documents.length === 0;

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const items = Array.from(e.dataTransfer.items);
        const hasFile = items.some(item => item.kind === 'file');

        if (hasFile) {
            setIsDragOver(true);
            e.dataTransfer.dropEffect = 'copy';
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const instanceId = e.dataTransfer.getData("application/x-collar-instance-id");
        if (instanceId && onPromote) {
            onPromote(instanceId);
            return;
        }

        const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.md'));
        if (files.length === 0) return;

        for (const file of files) {
            const docName = file.name.replace(/\.md$/i, '');
            const content = await file.text();
            try {
                await onImportMarkdown(pid, docName, content);
            } catch (err) {
                console.error(`Failed to import file: ${file.name}`, err);
            }
        }
    };

    return (
        <div
            className={`flex flex-col mb-1 relative rounded-lg transition-all duration-200 ${isDragOver ? 'bg-primary/5 ring-2 ring-primary/20 shadow-sm' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div
                className="group flex items-center justify-between p-2 hover:bg-surface-100 cursor-pointer transition-colors rounded-lg mx-1"
                onClick={() => onToggle(pid)}
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`text-[10px] text-(--ev-c-text-3) transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    <h3 className="font-bold text-[11px] text-(--ev-c-text-1) uppercase tracking-tight truncate">{name}</h3>
                    {isEmpty && <span className="text-[10px] text-(--ev-c-text-3) italic font-normal">Empty</span>}
                    {isDragOver && <span className="text-[9px] font-bold text-primary ml-2 animate-pulse">DROP HERE</span>}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => { e.stopPropagation(); onOpenCreateModal('canvas', pid); }}
                        className="p-1 hover:bg-surface-200 rounded-md text-(--ev-c-text-2) flex items-center justify-center transform hover:scale-110 transition-transform"
                        title="Add Canvas"
                    >
                        <CanvasIcon width={14} height={14} />
                    </button>

                    <button
                        onClick={(e) => { e.stopPropagation(); onOpenCreateModal('document', pid); }}
                        className="p-1 hover:bg-surface-200 rounded-md text-(--ev-c-text-2) flex items-center justify-center transform hover:scale-110 transition-transform"
                        title="Add Document"
                    >
                        <DocumentIcon width={14} height={14} />
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Delete project and all its instances?')) onDeleteProject(pid);
                        }}
                        className="p-1 hover:bg-surface-200 rounded-md text-(--ev-c-text-3) hover:text-red-500 flex items-center justify-center transition-colors"
                        title="Delete Project"
                    >
                        <TrashIcon width={14} height={14} />
                    </button>
                </div>
            </div>

            {isExpanded && !isEmpty && (
                <div className="pl-3 pr-2 pb-2 mt-1 relative">
                    <div className="absolute left-[13px] top-0 bottom-2 w-px bg-surface-200" />
                    <div className="space-y-3 pl-3">
                        {group.canvases.length > 0 && (
                            <div>
                                <div className="text-[9px] font-bold text-(--ev-c-text-3) uppercase mb-1 px-2 tracking-wider">Canvases</div>
                                {group.canvases.map(s => renderInstanceItem(s, 'canvas'))}
                            </div>
                        )}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setIsPromoteDragOver(true); }}
                            onDragLeave={() => setIsPromoteDragOver(false)}
                            onDrop={(e) => { setIsPromoteDragOver(false); handleDrop(e); }}
                            className={`rounded-lg transition-colors pb-1 ${isPromoteDragOver ? 'bg-primary/10 ring-1 ring-primary/20' : ''}`}
                        >
                            <div className="text-[9px] font-bold text-(--ev-c-text-3) uppercase mb-1 px-2 tracking-wider flex justify-between items-center">
                                <span>Documents</span>
                                {isPromoteDragOver && <span className="text-[8px] animate-pulse">MOVE TO LIBRARY</span>}
                            </div>
                            {group.documents.length > 0 ? (
                                group.documents.map(s => renderInstanceItem(s, 'document'))
                            ) : (
                                !isPromoteDragOver && <div className="text-[9px] text-(--ev-c-text-3) px-2 italic">Drag nodes here to promote</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Project-specific importing overlay */}
            {isImportingGlobal && isDragOver && (
                <div className="absolute inset-0 z-10 bg-surface-50/60 backdrop-blur-[1px] flex items-center justify-center rounded-lg pointer-events-none">
                    <span className="text-[10px] font-bold text-primary">IMPORTING...</span>
                </div>
            )}
        </div>
    );
}

export function InstanceManager({ onSelect }: { onSelect?: () => void }) {
    const { apiPort } = useProjectSession();
    // Typecast context to any to access activeProjectId and future importMarkdownAsDocument
    const ctx = useInstanceContext() as any;
    const {
        instanceSummaries,
        instanceId,
        setInstanceId,
        createInstance,
        deleteInstances,
        projects,
        createProject,
        deleteProject
    } = ctx;

    const [isCreating, setIsCreating] = useState(false);
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [createType, setCreateType] = useState<'canvas' | 'document'>('canvas');
    // Renamed local state to avoid conflict with context's activeProjectId
    const [modalProjectId, setModalProjectId] = useState<string | undefined>();
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
    const [expandedCanvases, setExpandedCanvases] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, id: string, name: string, type: 'canvas' | 'document', depth: number } | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastId, setLastId] = useState<string | null>(null);

    // Drag and drop state
    const [isImporting, setIsImporting] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClose = (e: MouseEvent) => {
            // Close if clicking outside the context menu
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };

        // Use capture phase to ensure we catch clicks even if they stop propagation (like expansion arrows)
        window.addEventListener('mousedown', handleClose, true);
        window.addEventListener('contextmenu', handleClose, true);

        return () => {
            window.removeEventListener('mousedown', handleClose, true);
            window.removeEventListener('contextmenu', handleClose, true);
        };
    }, []);

    // Sync selection with active instance when it changes externally (e.g. from Workspace tabs)
    useEffect(() => {
        if (instanceId && !selectedIds.has(instanceId)) {
            setSelectedIds(new Set([instanceId]));
            setLastId(instanceId);
        }
    }, [instanceId, selectedIds]);

    const groupedInstances = useMemo(() => {
        const groups: Record<string, { canvases: any[], documents: any[], nodesByCanvasId: Record<string, any[]> }> = {};

        projects.forEach(p => {
            groups[p.id] = { canvases: [], documents: [], nodesByCanvasId: {} };
        });

        instanceSummaries.forEach(summary => {
            const pid = summary.projectId;
            if (pid && groups[pid]) {
                const isHidden = summary.metadata?.isHidden === true;
                const parentCanvasId = summary.metadata?.parentCanvasId;

                // Index hidden nodes by their parent canvas
                if (isHidden && parentCanvasId) {
                    if (!groups[pid].nodesByCanvasId[parentCanvasId]) {
                        groups[pid].nodesByCanvasId[parentCanvasId] = [];
                    }
                    groups[pid].nodesByCanvasId[parentCanvasId].push(summary);
                    return;
                }

                if (summary.type === 'canvas') {
                    groups[pid].canvases.push(summary);
                } else if (!isHidden) {
                    groups[pid].documents.push(summary);
                }
            }
        });

        return groups;
    }, [instanceSummaries, projects]);

    const flatVisibleInstanceIds = useMemo(() => {
        const ids: string[] = [];
        projects.forEach(p => {
            // We assume projects are "visible" if they are in the projects list
            // If we have a mechanism to collapse projects, we should check it here (expandedProjects)
            const group = groupedInstances[p.id];
            if (!group) return;

            group.canvases.forEach(c => {
                ids.push(c.instanceId);
                if (expandedCanvases.has(c.instanceId)) {
                    (group.nodesByCanvasId[c.instanceId] || []).forEach(n => ids.push(n.instanceId));
                }
            });
            group.documents.forEach(d => ids.push(d.instanceId));
        });
        return ids;
    }, [projects, groupedInstances, expandedCanvases]);

    const handleSelect = (e: React.MouseEvent, id: string) => {
        const isCmd = e.metaKey || e.ctrlKey;
        const isShift = e.shiftKey;

        if (isShift && lastId) {
            const start = flatVisibleInstanceIds.indexOf(lastId);
            const end = flatVisibleInstanceIds.indexOf(id);
            if (start !== -1 && end !== -1) {
                const range = flatVisibleInstanceIds.slice(Math.min(start, end), Math.max(start, end) + 1);
                setSelectedIds(prev => {
                    const next = isCmd ? new Set(prev) : new Set<string>();
                    range.forEach(rid => next.add(rid));
                    return next;
                });
            }
        } else if (isCmd) {
            setSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            });
            setLastId(id);
        } else {
            setSelectedIds(new Set([id]));
            setLastId(id);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, id: string, type: 'canvas' | 'document', name: string, depth: number) => {
        e.preventDefault();
        e.stopPropagation();

        // If clicking on something not selected, clear selection and select this one
        if (!selectedIds.has(id)) {
            setSelectedIds(new Set([id]));
            setLastId(id);
        }

        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            id,
            name,
            type,
            depth
        });
    };

    const handleCreate = (name: string, projectId?: string) => {
        if (!projectId) return;
        createInstance(name, createType, projectId, { isHidden: false });
    };

    const handleCreateProject = async (name: string) => {
        try {
            await createProject(name);
        } catch (e) {
            console.error('Failed to create project', e);
        }
    };

    const openCreateModal = (type: 'canvas' | 'document', projectId?: string) => {
        setCreateType(type);
        setModalProjectId(projectId);
        setIsCreating(true);
    };

    const handleImportMarkdown = async (pid: string, name: string, content: string) => {
        setIsImporting(true);
        try {
            await ctx.importMarkdownAsDocument(name, content, pid);
        } catch (err) {
            console.error("Failed to import markdown document:", err);
        } finally {
            setIsImporting(false);
        }
    };

    const handlePromote = async (id: string) => {
        try {
            await ctx.renameInstance(id, (instanceSummaries.find(s => s.instanceId === id)?.name || '')); // Force refresh
            const metadata = { ...(instanceSummaries.find(s => s.instanceId === id)?.metadata || {}), isHidden: false, parentCanvasId: null };
            await instanceService.update(id, { metadata });
            await ctx.refreshInstanceIds();
        } catch (err) {
            console.error("Failed to promote instance:", err);
        }
    };

    const toggleProject = (id: string) => {
        setExpandedProjects(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const renderInstanceItem = (summary: any, type: 'canvas' | 'document', depth = 0) => {
        const id = summary.instanceId;
        const displayName = summary.name || id;
        const isExpanded = expandedCanvases.has(id);
        const hasChildren = type === 'canvas' && (groupedInstances[summary.projectId]?.nodesByCanvasId[id]?.length > 0);
        const isSelected = selectedIds.has(id);

        return (
            <div key={id} className="mb-0.5">
                <div
                    className={`
                        group flex justify-between items-center px-3 py-1.5 rounded-lg cursor-pointer text-xs transition-all
                        ${(id === instanceId || contextMenu?.id === id || isSelected)
                            ? 'bg-surface-200 text-(--ev-c-text-1) font-medium shadow-sm'
                            : 'hover:bg-surface-100 text-(--ev-c-text-2) hover:text-(--ev-c-text-1)'
                        }
                    `}
                    style={{ paddingLeft: `${depth * 12 + 12}px` }}
                    title={displayName}
                    onClick={(e) => {
                        handleSelect(e, id);
                        setInstanceId(id);
                        if (onSelect) onSelect();
                    }}
                    onContextMenu={(e) => handleContextMenu(e, id, type, displayName, depth)}
                    draggable
                    onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-collar-instance-id", id);
                        e.dataTransfer.setData("application/x-collar-instance-type", type);
                    }}
                >
                    <div className="flex items-center gap-2 truncate flex-1 leading-none">
                        {type === 'canvas' && hasChildren && (
                            <span
                                className={`text-[10px] text-(--ev-c-text-3) transition-transform duration-200 p-0.5 -ml-0.5 hover:text-(--ev-c-text-1) shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedCanvases(prev => {
                                        const next = new Set(prev);
                                        if (next.has(id)) next.delete(id);
                                        else next.add(id);
                                        return next;
                                    });
                                }}
                                title={isExpanded ? "Collapse" : "Expand"}
                            >
                                ▶
                            </span>
                        )}
                        <span className={`opacity-70 ${(id === instanceId || contextMenu?.id === id) ? 'text-(--ev-c-black)' : ''}`}>
                            {type === 'canvas' ? <CanvasIcon width={14} height={14} /> : <DocumentIcon width={14} height={14} />}
                        </span>
                        <span className="truncate pt-0.5">{displayName}</span>
                    </div>
                </div>
                {type === 'canvas' && isExpanded && (
                    <div className="mt-0.5">
                        {groupedInstances[summary.projectId]?.nodesByCanvasId[id]?.map(node => renderInstanceItem(node, 'document', depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <Fragment>
            <div
                className="flex flex-col h-full bg-surface-50 border-r border-surface-200 w-full overflow-hidden relative"
            >
                <div className="px-3 py-3 flex justify-between items-center mb-1">
                    <h2 className="font-bold text-xs text-(--ev-c-text-1) uppercase tracking-widest pl-1">Workspace</h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={async () => {
                                try {
                                    await (window as any).fileIPC.exportWorkspace();
                                } catch (e) {
                                    console.error("Export failed", e);
                                }
                            }}
                            className="p-1 text-(--ev-c-text-2) hover:text-(--ev-c-black) hover:bg-surface-200 rounded-md transition-colors"
                            title="Export Workspace Archive"
                        >
                            <ExportIcon width={16} height={16} />
                        </button>
                        <button
                            onClick={() => setIsCreatingProject(true)}
                            className="p-1 text-(--ev-c-text-2) hover:text-(--ev-c-black) hover:bg-surface-200 rounded-md transition-colors"
                            title="New Project"
                        >
                            <PlusIcon width={16} height={16} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar px-1 pb-2">
                    {projects.map(p => (
                        <ProjectSection
                            key={p.id}
                            pid={p.id}
                            name={p.name}
                            group={groupedInstances[p.id] || { canvases: [], documents: [] }}
                            isExpanded={expandedProjects.has(p.id)}
                            onToggle={toggleProject}
                            onOpenCreateModal={openCreateModal}
                            onDeleteProject={deleteProject}
                            renderInstanceItem={renderInstanceItem}
                            onImportMarkdown={handleImportMarkdown}
                            isImportingGlobal={isImporting}
                            onPromote={handlePromote}
                        />
                    ))}

                    <div className="my-2 border-t border-surface-200 mx-2 opacity-50" />
                    {/* SkillsPanel removed */}
                </div>
            </div>

            <CreateInstanceModal
                isOpen={isCreating}
                onClose={() => setIsCreating(false)}
                onConfirm={handleCreate}
                type={createType}
                projectId={modalProjectId}
            />

            <CreateProjectModal
                isOpen={isCreatingProject}
                onClose={() => setIsCreatingProject(false)}
                onConfirm={handleCreateProject}
            />

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    name={contextMenu.name}
                    type={contextMenu.type}
                    depth={contextMenu.depth}
                    menuRef={menuRef}
                    selectedCount={selectedIds.size}
                    onClose={() => setContextMenu(null)}
                    onExport={() => {
                        if (apiPort) {
                            exportInstanceToDocx(contextMenu.id, contextMenu.name, apiPort);
                        }
                    }}
                    onDelete={async () => {
                        const count = selectedIds.size;
                        const targets = count > 1 ? Array.from(selectedIds) : [contextMenu.id];
                        const message = count > 1
                            ? `Are you sure you want to delete ${count} selected items?`
                            : `Are you sure you want to delete this ${contextMenu.depth > 0 ? 'node' : contextMenu.type}?`;

                        if (confirm(message)) {
                            await deleteInstances(targets);
                            setSelectedIds(new Set());
                        }
                    }}
                />
            )}
        </Fragment>
    );
}
