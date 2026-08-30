import { useEffect, useState } from 'react';

export function ProgressBar(): React.JSX.Element | null {
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [visible, setVisible] = useState(false);

    const isBusy = isExporting || isImporting;

    // Subscribe directly to IPC push events from the main process.
    // This is global: it works regardless of what triggered the operation
    // (sidebar button, app-close save, opening a file, etc.)
    useEffect(() => {
        const fileIPC = (window as any).fileIPC;
        if (!fileIPC) return;

        const disposers: (() => void)[] = [];

        if (fileIPC.onExportStarted && fileIPC.onExportEnded) {
            disposers.push(fileIPC.onExportStarted(() => setIsExporting(true)));
            disposers.push(fileIPC.onExportEnded(() => setIsExporting(false)));
        }

        if (fileIPC.onImportStarted && fileIPC.onImportEnded) {
            disposers.push(fileIPC.onImportStarted(() => setIsImporting(true)));
            disposers.push(fileIPC.onImportEnded(() => setIsImporting(false)));
        }

        return () => {
            disposers.forEach(dispose => dispose());
        };
    }, []);

    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (isBusy) {
            setVisible(true);
            setProgress(0);

            // Fast start, then slow down as it gets closer to 95%
            interval = setInterval(() => {
                setProgress((prev) => {
                    if (prev < 30) return prev + Math.random() * 10;
                    if (prev < 60) return prev + Math.random() * 5;
                    if (prev < 90) return prev + Math.random() * 2;
                    if (prev < 95) return prev + 0.1;
                    return prev;
                });
            }, 100);
        } else {
            // Finish the bar
            setProgress(100);
            // Hide after a short delay
            const timeout = setTimeout(() => {
                setVisible(false);
                setProgress(0);
            }, 300);
            return () => clearTimeout(timeout);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isBusy]);

    if (!visible) return null;

    return (
        <div className="absolute top-9 left-0 w-full h-[2px] z-60 pointer-events-none bg-transparent">
            <div
                className="h-full bg-accent transition-all duration-300 ease-out"
                style={{ width: `${progress}%`, boxShadow: '0 0 8px var(--color-accent-glow)' }}
            />
        </div>
    );
}
