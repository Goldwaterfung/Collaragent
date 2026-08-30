import { useState } from 'react';
import { useSkillsContext } from '../../../workspace/contexts/skills/SkillsContext';
import { SkillIcon } from '../../assets/icons/SkillIcon';
import { PlusIcon } from '../../assets/icons/PlusIcon';

import { CreateSkillModal } from './CreateSkillModal';

export function SkillsPanel() {
    const {
        skills, activeSkillPath, setActiveSkillPath,
        isLoading, createSkill, deleteSkill,
    } = useSkillsContext();

    const [isExpanded, setIsExpanded] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [source, setSource] = useState<string>('');

    // --- Create flow ---
    const handleOpenCreate = async () => {
        // Step 1: get configured source
        try {
            const configRes = await window.configIPC.get({});
            const src = configRes.config.middleware?.skills?.source ?? '';
            if (!src) {
                alert('Please configure a Skills source directory in Settings → Middleware first.');
                return;
            }
            setSource(src);
            setIsCreating(true);
        } catch (err) {
            console.error('Failed to get config:', err);
            alert('Could not check source. Please check settings.');
        }
    };

    const handleConfirmCreate = async (sourcePath: string, name: string) => {
        try {
            const skillMdPath = await createSkill(sourcePath, name);
            setActiveSkillPath(skillMdPath);
            setIsCreating(false);
        } catch (err) {
            console.error('Failed to create skill', err);
            // Re-throw so modal can display error
            throw err;
        }
    };

    return (
        <div className="flex flex-col mb-1 relative rounded-lg">
            {/* Section Header */}
            <div
                className="group flex items-center justify-between p-2 hover:bg-surface-100 cursor-pointer rounded-lg mx-1"
                onClick={() => setIsExpanded(p => !p)}
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`text-[10px] text-(--ev-c-text-3) transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    <h3 className="font-bold text-[11px] text-(--ev-c-text-1) uppercase tracking-tight truncate">
                        Skills
                    </h3>
                    {isLoading && (
                        <span className="text-[9px] text-(--ev-c-text-3) italic">loading...</span>
                    )}
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); handleOpenCreate(); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface-200 rounded-md text-(--ev-c-text-2) transition-opacity"
                    title="New Skill"
                >
                    <PlusIcon width={12} height={12} />
                </button>
            </div>

            {/* Skill Items */}
            {isExpanded && (
                <div className="pl-3 pr-2 pb-2 mt-1 relative">
                    <div className="absolute left-[13px] top-0 bottom-2 w-px bg-surface-200" />
                    <div className="space-y-0.5 pl-3">
                        {skills.length === 0 && !isLoading && (
                            <p className="text-[10px] italic text-(--ev-c-text-3) px-2">
                                No skills yet. Configure a source in Settings.
                            </p>
                        )}
                        {skills.map((skill) => (
                            <div
                                key={skill.skillMdPath}
                                onClick={() => setActiveSkillPath(skill.skillMdPath)}
                                className={`group flex justify-between items-center px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-all ${activeSkillPath === skill.skillMdPath
                                    ? 'bg-surface-200 text-(--ev-c-text-1) font-medium'
                                    : 'hover:bg-surface-100 text-(--ev-c-text-2)'
                                    }`}
                                title={skill.description}
                            >
                                <div className="flex items-center gap-2 truncate flex-1">
                                    <SkillIcon width={13} height={13} />
                                    <span className="truncate pt-0.5">{skill.name}</span>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm(`Delete skill "${skill.name}" and its directory?`)) {
                                            deleteSkill(skill.skillDirPath);
                                        }
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface-300 rounded-md text-[10px] text-(--ev-c-text-3) hover:text-red-500"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isCreating && (
                <CreateSkillModal
                    isOpen={isCreating}
                    onClose={() => setIsCreating(false)}
                    onConfirm={handleConfirmCreate}
                    source={source}
                />
            )}
        </div>
    );
}
