import type { MessageAction } from '@shared/agents/types';

export type StreamErrorPresentation = {
	content: string;
	actions: MessageAction[];
};

export const getStreamErrorPresentation = (error: string): StreamErrorPresentation => {
	const lower = error.toLowerCase();
	if (lower.includes('graph_recursion_limit') || lower.includes('recursion limit')) {
		return {
			content: 'I used too many tools at once so I was stopped by the program. Would you like me to continue?',
			actions: [{ id: 'continue', label: 'Continue', input: 'Please continue' }]
		};
	}

	if (lower.includes('rate limit') || lower.includes('model_rate_limit') || lower.includes('429')) {
		return {
			content: 'Rate limit exceeded. Please try again later or switch models.',
			actions: []
		};
	}

	if (lower.includes('provider returned error') || lower.includes('timed out') || lower.includes('timeout') || lower.includes('524')) {
		return {
			content: 'Provider connection timed out. Would you try it again?',
			actions: [{ id: 'retry', label: 'Retry', input: 'Please retry' }]
		};
	}

	return {
		content: `Error: ${error}`,
		actions: []
	};
};
