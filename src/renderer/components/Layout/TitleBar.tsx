import { useProjectSession } from '@workspace/contexts/project/ProjectSession';
import { useEffect, useState } from 'react';

export function TitleBar(): React.JSX.Element {
    const { hasSession, filePath } = useProjectSession();
    const [title, setTitle] = useState('COLLAR AGENT');

    useEffect(() => {
        if (hasSession && filePath) {
            // Extract filename from path (cross-platform split)
            const fileName = filePath.split(/[/\\]/).pop();
            setTitle(fileName || 'COLLAR AGENT');
        } else {
            setTitle('COLLAR AGENT');
        }
    }, [hasSession, filePath]);

    return (
        <div
            className="h-9 bg-surface-50 flex items-center justify-center border-b border-surface-200 select-none w-full relative z-50"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            <div className="text-xs text-gray-500 font-medium tracking-wide">
                {title}
            </div>
        </div>
    );
}
