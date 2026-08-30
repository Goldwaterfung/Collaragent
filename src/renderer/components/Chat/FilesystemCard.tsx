import React from 'react';
import { ToolCall } from './types';

interface ExecuteArgs { command: string }
interface ReadFileArgs { file_path: string; offset?: number; limit?: number }
interface WriteFileArgs { file_path: string; content: string }
interface EditFileArgs { file_path: string; old_string: string; new_string: string }
interface ListArgs { path?: string }
interface GlobArgs { pattern: string; path?: string }
interface GrepArgs { pattern: string; path?: string; glob?: string | null }

type FSToolCall =
    | { id: string; name: 'execute'; args: ExecuteArgs; result?: string }
    | { id: string; name: 'read_file'; args: ReadFileArgs; result?: string }
    | { id: string; name: 'write_file'; args: WriteFileArgs; result?: any }
    | { id: string; name: 'edit_file'; args: EditFileArgs; result?: any }
    | { id: string; name: 'ls'; args: ListArgs; result?: string }
    | { id: string; name: 'glob'; args: GlobArgs; result?: string }
    | { id: string; name: 'grep'; args: GrepArgs; result?: string };

interface Props {
    tool: ToolCall;
}

export const FS_TOOL_NAMES = new Set([
    'execute',
    'read_file',
    'write_file',
    'edit_file',
    'ls',
    'glob',
    'grep'
]);

export function isFSTool(name?: string): boolean {
    return !!name && FS_TOOL_NAMES.has(name);
}

export const FilesystemCard: React.FC<Props> = ({ tool }) => {
    if (!isFSTool(tool.name)) return null;

    const fsTool = tool as unknown as FSToolCall;
    const isError = typeof fsTool.result === 'string' && fsTool.result.toLowerCase().includes('error');

    // Only render write/edit successfully when they are 'done' and might not have `result` initialized as string 
    // They usually return a status. So if no result, but it's done processing wait until execution finishes.
    if (!fsTool.result && fsTool.name !== 'write_file' && fsTool.name !== 'edit_file') {
        return null;
    }

    if (isError) {
        return (
            <div className="text-xs bg-red-50 border border-red-200 text-red-700 p-2.5 rounded-lg flex items-start gap-2">
                <span className="font-mono whitespace-pre-wrap wrap-break-word text-[11px]">{fsTool.result}</span>
            </div>
        );
    }

    switch (fsTool.name) {
        case 'execute':
            return (
                <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden flex flex-col">
                    <div className="bg-gray-800 px-3 py-1.5 flex items-center border-b border-gray-700">
                        <span className="text-gray-400 font-mono text-[10px]">{fsTool.args.command}</span>
                    </div>
                    {fsTool.result && (
                        <div className="p-3 max-h-64 overflow-y-auto overflow-x-auto text-[11px] font-mono text-gray-300 whitespace-pre">
                            {fsTool.result}
                        </div>
                    )}
                </div>
            );

        case 'read_file':
            return (
                <div className="bg-white border border-surface-200 rounded-lg overflow-hidden">
                    <div className="bg-surface-50 px-3 py-1.5 text-[11px] font-semibold text-gray-700 border-b border-surface-200 flex justify-between items-center">
                        <span className="truncate">{fsTool.args.file_path}</span>
                    </div>
                    {fsTool.result && (
                        <div className="p-3 max-h-60 overflow-y-auto overflow-x-auto text-[11px] font-mono text-gray-800 whitespace-pre">
                            {fsTool.result}
                        </div>
                    )}
                </div>
            );

        case 'grep':
            return (
                <div className="bg-white border border-surface-200 rounded-lg overflow-hidden">
                    <div className="bg-surface-50 px-3 py-1.5 text-[11px] font-semibold text-gray-700 border-b border-surface-200 flex flex-col">
                        <span>Search: {fsTool.args.pattern}</span>
                        <span className="text-[10px] text-gray-500 font-normal">in {fsTool.args.path || '/'}</span>
                    </div>
                    {fsTool.result && (
                        <div className="p-3 max-h-60 overflow-y-auto overflow-x-auto text-[11px] font-mono text-gray-800 whitespace-pre">
                            {fsTool.result}
                        </div>
                    )}
                </div>
            );

        case 'ls': {
            const items = typeof fsTool.result === 'string' ? fsTool.result.split('\n') : [];
            return (
                <div className="bg-white border border-surface-200 p-2 text-xs rounded-lg">
                    <div className="font-semibold text-gray-600 mb-2 px-1">{fsTool.args.path || '/'}</div>
                    {items.length > 0 && (
                        <ul className="space-y-1 max-h-48 overflow-y-auto pl-1">
                            {items.map((str, i) => (
                                <li key={i} className="font-mono text-[11px] text-gray-800 truncate">
                                    {str.replace('(directory)', '').trim()}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            );
        }

        case 'glob': {
            const items = typeof fsTool.result === 'string' ? fsTool.result.split('\n') : [];
            return (
                <div className="bg-white border border-surface-200 p-2 text-xs rounded-lg">
                    <div className="font-semibold text-gray-600 mb-2 text-[11px] px-1">
                        Glob: <span className="font-mono bg-surface-100 px-1 py-0.5 rounded ml-1 text-gray-800">{fsTool.args.pattern}</span>
                    </div>
                    {items.length > 0 && (
                        <ul className="space-y-1 max-h-48 overflow-y-auto pl-1">
                            {items.map((str, i) => (
                                <li key={i} className="font-mono text-[11px] text-gray-800 truncate">
                                    {str}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            );
        }

        case 'edit_file':
        case 'write_file':
            if (!fsTool.result && !tool.result) return null; // Wait for it to finish returning something

            // For editing and writing, the standard Langchain tool message logic is returned
            // Usually as `{ occurrences: X, filesUpdate: Y}` for state backends, or string for others.
            return (
                <div className="text-[11px] p-2 bg-green-50 border border-green-200 text-green-800 rounded-lg flex flex-col gap-1.5 overflow-hidden">
                    <div className="flex items-center gap-2">
                        <span className="font-medium whitespace-nowrap">{fsTool.name === 'edit_file' ? 'Edited' : 'Created'}:</span>
                        <span className="font-mono bg-green-100 px-1.5 py-0.5 rounded truncate text-gray-800">{fsTool.args.file_path}</span>
                    </div>
                </div>
            );

        default:
            return null;
    }
};

export default FilesystemCard;
