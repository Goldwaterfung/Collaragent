export interface ToolCall {
    id: string;
    name: string;
    args: any;
    result?: any;
    status?: 'pending' | 'completed' | 'error';
}
