export const AGENT_CHAT = "agent:chat";
export const AGENT_STREAM = "agent:stream";
export const AGENT_ABORT = "agent:abort";
export const AGENT_GET_HISTORY = "agent:get-history";

export const agentStreamChannel = (streamId: string) => `${AGENT_STREAM}:${streamId}`;
export const agentStreamEndChannel = (streamId: string) => `${AGENT_STREAM}:${streamId}:end`;
export const agentStreamErrorChannel = (streamId: string) => `${AGENT_STREAM}:${streamId}:error`;
