import { contextBridge, ipcRenderer } from 'electron';
import { readFileSync, existsSync } from 'node:fs';

interface LlmRequest {
  prompt: string;
  skill?: string;
  envVars?: Record<string, string>;
  schema?: string;
}

const statePath = process.env.LOOPFLOW_STATE_FILE ?? '';

let initialState: unknown = null;
if (statePath && existsSync(statePath)) {
  try {
    initialState = JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch (e) {
    console.warn('loopflow: failed to parse state file', e);
  }
}

contextBridge.exposeInMainWorld('loopflow', {
  env: {
    headless: process.env.LOOPFLOW_HEADLESS === '1',
    statePath,
  },
  storage: {
    initialState,
    // Accepts the full state blob; main process writes atomically.
    write: (data: unknown) => ipcRenderer.invoke('storage:write', data),
  },
  llm: (req: LlmRequest) => ipcRenderer.invoke('llm:call', req),
});
