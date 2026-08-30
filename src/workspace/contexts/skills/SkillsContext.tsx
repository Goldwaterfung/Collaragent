import {
    createContext, useCallback, useContext, useEffect,
    useMemo, useState, type ReactNode,
} from 'react';
import type { SkillEntry } from '@shared/ipc/skills/types';

type SkillsContextValue = {
    skills: SkillEntry[];
    activeSkillPath: string | null;
    setActiveSkillPath: (path: string | null) => void;
    isLoading: boolean;
    refreshSkills: () => Promise<void>;
    createSkill: (sourcePath: string, name: string) => Promise<string>; // returns skillMdPath
    deleteSkill: (skillDirPath: string) => Promise<void>;
};

const SkillsContext = createContext<SkillsContextValue | null>(null);

export function SkillsProvider({ children }: { children: ReactNode }) {
    const [skills, setSkills] = useState<SkillEntry[]>([]);
    const [activeSkillPath, setActiveSkillPath] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const fetchSkills = useCallback(async () => {
        setIsLoading(true);
        try {
            // No sources arg: the handler uses the app config's sources
            const res = await window.skillsIPC.list({});
            setSkills(res.skills);
        } catch (err) {
            console.error('Failed to list skills:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSkills();
    }, [fetchSkills]);

    const createSkill = useCallback(async (sourcePath: string, name: string) => {
        const res = await window.skillsIPC.create({ sourcePath, name });
        if (!res.success) throw new Error('Failed to create skill');
        await fetchSkills();
        return res.skillMdPath;
    }, [fetchSkills]);

    const deleteSkill = useCallback(async (skillDirPath: string) => {
        await window.skillsIPC.delete({ skillDirPath });
        if (activeSkillPath?.startsWith(skillDirPath)) {
            setActiveSkillPath(null);
        }
        await fetchSkills();
    }, [activeSkillPath, fetchSkills]);

    const value = useMemo<SkillsContextValue>(() => ({
        skills,
        activeSkillPath,
        setActiveSkillPath,
        isLoading,
        refreshSkills: fetchSkills,
        createSkill,
        deleteSkill,
    }), [skills, activeSkillPath, isLoading, fetchSkills, createSkill, deleteSkill]);

    return <SkillsContext.Provider value={value}>{children}</SkillsContext.Provider>;
}

export function useSkillsContext(): SkillsContextValue {
    const ctx = useContext(SkillsContext);
    if (!ctx) throw new Error('useSkillsContext must be used within SkillsProvider');
    return ctx;
}
