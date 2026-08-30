import React from 'react';
import { ClipboardIcon } from '../../assets/icons/ClipboardIcon';
import { ChevronDownIcon } from '../../assets/icons/ChevronDownIcon';
import { CheckIcon } from '../../assets/icons/CheckIcon';

interface TodoItemProps {
    status: string;
    content: string;
}

interface TodoCardProps {
    todos: TodoItemProps[];
    className?: string;
}

export const TodoCard: React.FC<TodoCardProps> = ({ todos, className = '' }) => {
    const [isExpanded, setIsExpanded] = React.useState(true);

    if (!todos || todos.length === 0) return null;

    return (
        <div className={`bg-surface-50/95 border-t border-surface-200 backdrop-blur-sm p-3 ${className}`}>
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full font-medium text-gray-800 mb-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wide hover:opacity-80 transition-opacity"
            >
                <div className="flex items-center gap-2">
                    <ClipboardIcon className="w-3.5 h-3.5 text-gray-500" />
                    Current Plan
                </div>
                <ChevronDownIcon
                    className={`w-4 h-4 text-gray-400 transform transition-transform duration-200 ${isExpanded ? '' : 'rotate-180'}`}
                />
            </button>

            {isExpanded && (
                <div className="flex flex-col gap-1.5 max-h-[120px] overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-200">
                    {todos.map((todo, idx) => (
                        <TodoItem key={idx} todo={todo} />
                    ))}
                </div>
            )}
        </div>
    );
};

function TodoItem({ todo }: { todo: TodoItemProps }) {
    const isCompleted = todo.status === 'completed';
    const isInProgress = todo.status === 'in_progress';

    return (
        <div className="flex items-start gap-2 text-[11px]">
            <div className={`
                mt-0.5 w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center transition-colors
                ${isCompleted ? 'bg-green-500 border-green-600' : isInProgress ? 'bg-blue-50 border-blue-400' : 'bg-white border-gray-300'}
            `}>
                {isCompleted && (
                    <CheckIcon className="w-2 h-2 text-white" />
                )}
                {isInProgress && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
            </div>
            <span className={`leading-4 transition-colors ${isCompleted ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                {todo.content}
            </span>
        </div>
    );
}
