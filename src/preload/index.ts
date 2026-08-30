import { contextBridge, ipcRenderer } from 'electron'
import crypto from 'crypto'
import { electronAPI } from '@electron-toolkit/preload'
import * as ConfigChannels from '../shared/ipc/config/channels'
import * as AgentChannels from '../shared/ipc/agent/channels'
import * as CheckpointChannels from '../shared/ipc/checkpoints/channels'
import * as SkillsChannels from '../shared/ipc/skills/channels'


// Custom APIs for renderer
const api = {}

// Config IPC Handlers
const configIPC = {
  get: (req?: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_GET, req),
  save: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_SAVE, req),
  addSubagent: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_ADD_SUBAGENT, req),
  updateSubagent: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_UPDATE_SUBAGENT, req),
  deleteSubagent: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_DELETE_SUBAGENT, req),
  toggleTool: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_TOGGLE_TOOL, req),
  setModel: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_SET_MODEL, req),
  getModels: (req?: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_GET_MODELS, req),
  addMCPServer: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_ADD_MCP_SERVER, req),
  updateMCPServer: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_UPDATE_MCP_SERVER, req),
  deleteMCPServer: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_DELETE_MCP_SERVER, req),
  toggleMCPServer: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_TOGGLE_MCP_SERVER, req),
  setToolApiKey: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_SET_TOOL_API_KEY, req),
  checkKey: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_CHECK_KEY, req),
  fetchMCPTools: (req: any) => ipcRenderer.invoke(ConfigChannels.CONFIG_FETCH_MCP_TOOLS, req)
}

// Agent IPC Handlers
const agentIPC = {
  invoke: (req: any) => ipcRenderer.invoke(AgentChannels.AGENT_CHAT, req),
  stop: (req: any) => ipcRenderer.invoke(AgentChannels.AGENT_ABORT, req),
  stream: async function* (req: any) {
    // Generate a threadId if one isn't provided to ensure we can filter events (optional logic, but beneficial)
    // However, for now we mirror the main process logic: pass what we have.
    
    // We create a temporary listener setup
    const responseQueue: any[] = [];
    let signalData: ((val?: any) => void) | null = null;
    let signalError: ((err: any) => void) | null = null;
    let isFinished = false;

    const chunkHandler = (_: any, data: any) => {
        // We could filter by threadId here if we wanted to enforce strictness
         responseQueue.push({ type: 'chunk', data });
         if (signalData) signalData();
    };

    const endHandler = (_: any, data: any) => {
         responseQueue.push({ type: 'end', data });
         if (signalData) signalData();
    };
    
    const errorHandler = (_: any, data: any) => {
         if (signalError) signalError(new Error(data.error));
         isFinished = true;
    };

    const streamId = req.streamId || crypto.randomUUID();
    req.streamId = streamId;
    if (!req.clientSentAt) req.clientSentAt = Date.now();
    const chunkChannel = AgentChannels.agentStreamChannel(streamId);
    const endChannel = AgentChannels.agentStreamEndChannel(streamId);
    const errorChannel = AgentChannels.agentStreamErrorChannel(streamId);

    ipcRenderer.on(chunkChannel, chunkHandler);
    ipcRenderer.on(endChannel, endHandler);
    ipcRenderer.on(errorChannel, errorHandler);

    // Start
    ipcRenderer.send(AgentChannels.AGENT_STREAM, req);

    try {
        while (true) {
            if (responseQueue.length > 0) {
                const item = responseQueue.shift();
                if (item.type === 'end') {
                    isFinished = true;
                    return;
                }
                if (item.type === 'chunk') {
                    yield item.data;
                }
            } else {
                if (isFinished) return;
                // Wait for next event
                await new Promise<void>((resolve, reject) => {
                    signalData = () => {
                        signalData = null;
                        signalError = null;
                        resolve();
                    };
                    signalError = (err) => {
                        signalData = null;
                        signalError = null;
                        reject(err);
                    }
                });
            }
        }
    } finally {
        // Cleanup listeners
        ipcRenderer.removeListener(chunkChannel, chunkHandler);
        ipcRenderer.removeListener(endChannel, endHandler);
        ipcRenderer.removeListener(errorChannel, errorHandler);
    }
  }
}

const checkpointIPC = {
  create: (req: any) => ipcRenderer.invoke(CheckpointChannels.CHECKPOINT_CREATE, req),
  restore: (req: any) => ipcRenderer.invoke(CheckpointChannels.CHECKPOINT_RESTORE, req),
  list: (req: any) => ipcRenderer.invoke(CheckpointChannels.CHECKPOINT_LIST, req),
  cancel: (req?: any) => ipcRenderer.invoke(CheckpointChannels.CHECKPOINT_CANCEL, req),
  onQuiesce: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on(CheckpointChannels.CHECKPOINT_QUIESCE, listener);
    return () => ipcRenderer.removeListener(CheckpointChannels.CHECKPOINT_QUIESCE, listener);
  },
  onResume: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on(CheckpointChannels.CHECKPOINT_RESUME, listener);
    return () => ipcRenderer.removeListener(CheckpointChannels.CHECKPOINT_RESUME, listener);
  }
}



const fileIPC = {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  createFile: () => ipcRenderer.invoke('dialog:createFile'),
  getRecentFiles: () => ipcRenderer.invoke('file:getRecent'),
  openWorkspace: (path: string) => ipcRenderer.invoke('file:openPath', path),
  exportWorkspace: () => ipcRenderer.invoke('dialog:exportWorkspace'),
  onExportStarted: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('export:started', listener)
    return () => ipcRenderer.removeListener('export:started', listener)
  },
  onExportEnded: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('export:ended', listener)
    return () => ipcRenderer.removeListener('export:ended', listener)
  },
  onImportStarted: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('import:started', listener)
    return () => ipcRenderer.removeListener('import:started', listener)
  },
  onImportEnded: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('import:ended', listener)
    return () => ipcRenderer.removeListener('import:ended', listener)
  }
}

const skillsIPC = {
  list: (req: any) => ipcRenderer.invoke(SkillsChannels.SKILLS_LIST, req),
  readFile: (req: any) => ipcRenderer.invoke(SkillsChannels.SKILLS_READ_FILE, req),
  writeFile: (req: any) => ipcRenderer.invoke(SkillsChannels.SKILLS_WRITE_FILE, req),
  create: (req: any) => ipcRenderer.invoke(SkillsChannels.SKILLS_CREATE, req),
  delete: (req: any) => ipcRenderer.invoke(SkillsChannels.SKILLS_DELETE, req),
  pickDirectory: () => ipcRenderer.invoke(SkillsChannels.SKILLS_PICK_DIRECTORY)
}


if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('configIPC', configIPC)
    contextBridge.exposeInMainWorld('agentIPC', agentIPC)
    contextBridge.exposeInMainWorld('checkpointIPC', checkpointIPC)
    contextBridge.exposeInMainWorld('fileIPC', fileIPC)
    contextBridge.exposeInMainWorld('skillsIPC', skillsIPC)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore
  window.configIPC = configIPC
  // @ts-ignore
  window.agentIPC = agentIPC
  // @ts-ignore
  window.checkpointIPC = checkpointIPC
  // @ts-ignore
  window.fileIPC = fileIPC
  // @ts-ignore
  window.skillsIPC = skillsIPC
}
