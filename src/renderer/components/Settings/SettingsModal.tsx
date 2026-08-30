import React from 'react';
import { Settings } from './Settings';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-surface-50 w-full h-full max-w-2xl max-h-[90%] rounded-xl shadow-2xl overflow-hidden flex flex-col relative">
                <div className="flex items-center justify-between p-4 border-b border-surface-200">
                    <h3 className="text-lg font-bold">Settings</h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-surface-200 rounded-full transition-colors cursor-pointer"
                        aria-label="Close Settings"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div className="flex-1 overflow-hidden">
                    <Settings />
                </div>
            </div>
        </div>
    );
};
