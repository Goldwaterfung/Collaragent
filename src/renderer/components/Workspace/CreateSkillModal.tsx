import { useState, useEffect } from 'react';

type CreateSkillModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (sourcePath: string, name: string) => Promise<void>;
    source: string;
};

export function CreateSkillModal({ isOpen, onClose, onConfirm, source }: CreateSkillModalProps) {
    const [name, setName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setName('');
            setError(null);
            setIsSubmitting(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (!source) {
            setError('No source directory configured.');
            return;
        }

        // Client-side validation for name (must be lowercase alphanumeric with hyphens)
        if (!/^[a-z0-9-]+$/.test(name.trim())) {
            setError('Name must be lowercase alphanumeric with single hyphens only (e.g. my-skill)');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            await onConfirm(source, name.trim());
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to create skill');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px] p-4">
            <div className="bg-surface-50 border border-surface-200 rounded-xl shadow-2xl w-full max-w-sm p-5 overflow-hidden flex flex-col pt-4 animate-in fade-in zoom-in duration-200">
                <h3 className="text-sm font-bold text-(--ev-c-text-1) mb-4 px-1 uppercase tracking-wide">
                    New Skill
                </h3>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {/* Source path (read-only display) */}
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-bold text-(--ev-c-text-3)">Source Directory</label>
                        <p className="px-2 py-1.5 bg-surface-100 border border-surface-200 rounded-lg text-[10px] font-mono text-(--ev-c-text-2) truncate">
                            {source}
                        </p>
                    </div>

                    {/* Name Input */}
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase font-bold text-(--ev-c-text-3)">Skill Name</label>
                        <input
                            autoFocus
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. responsive-design"
                            className="w-full px-3 py-2 bg-surface-100 border border-surface-200 rounded-lg focus:outline-none text-(--ev-c-text-1) placeholder-(--ev-c-text-3) text-sm"
                        />
                        <p className="text-[10px] text-(--ev-c-text-3)">
                            Creates a folder with this name inside the source directory.
                        </p>
                    </div>

                    {error && (
                        <div className="text-xs text-red-500 bg-red-50 p-2 rounded border border-red-100">
                            {error}
                        </div>
                    )}

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
                            disabled={!name.trim() || isSubmitting}
                            className="px-4 py-2 text-xs font-bold bg-(--color-primary) text-(--ev-c-black) rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-2"
                        >
                            {isSubmitting ? 'Creating...' : 'Create'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
