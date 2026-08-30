import React from 'react';

interface CheckpointMarkerProps {
    bundleId: string;
    restoreContent?: string;
    disabled?: boolean;
    onRestore: (bundleId: string, restoreContent?: string) => void;
}

export const CheckpointMarker: React.FC<CheckpointMarkerProps> = ({
    bundleId,
    restoreContent,
    disabled,
    onRestore
}) => {
    return (
        <div className="flex items-center gap-3 text-[11px] text-black/50">
            <div className="flex-1 border-t border-dashed border-surface-200" />
            <button
                onClick={() => onRestore(bundleId, restoreContent)}
                disabled={disabled}
                className="px-2 py-0.5 rounded-full border border-surface-200 text-[11px] font-semibold text-black/70 hover:bg-surface-100 disabled:opacity-50"
            >
                Restore
            </button>
            <div className="flex-1 border-t border-dashed border-surface-200" />
        </div>
    );
};
