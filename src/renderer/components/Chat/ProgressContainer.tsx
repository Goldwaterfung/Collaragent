import React from 'react';

interface ProgressContainerProps {
    children: React.ReactNode;
    inProgressTodos: any[];
}

export const ProgressContainer: React.FC<ProgressContainerProps> = ({ children, inProgressTodos }) => {
    if (inProgressTodos.length === 0) return <>{children}</>;

    return (
        <div className="py-2">
            <div className="progress-container relative border border-surface-200 bg-surface-100/40 rounded-xl p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex flex-col gap-1.5 mb-3">
                    {inProgressTodos.map((todo, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                            <div className="relative">
                                <div className="w-2 h-2 rounded-full bg-primary animate-ping absolute opacity-75" />
                                <div className="w-2 h-2 rounded-full bg-primary relative" />
                            </div>
                            <span className="text-[11px] font-bold text-gray-800 uppercase tracking-wider">
                                Progress: {todo.content}
                            </span>
                        </div>
                    ))}
                </div>
                <div className="relative z-10">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default ProgressContainer;
