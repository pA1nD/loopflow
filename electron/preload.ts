import { contextBridge, ipcRenderer } from 'electron';
import { readFileSync, existsSync } from 'node:fs';

interface LlmRequest {
  prompt: string;
  skill?: string;
  envVars?: Record<string, string>;
  schema?: string;
  sessionId?: string;
}

type TermPayload = { id: string; chunk: string };
type TermClearPayload = { id: string };

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
    write: (data: unknown) => ipcRenderer.invoke('storage:write', data),
  },
  llm: (req: LlmRequest) => ipcRenderer.invoke('llm:call', req),
  terminal: {
    getBuffer: (id: string): Promise<string> =>
      ipcRenderer.invoke('loopflow:term:get-buffer', id),
    clear: (id: string): Promise<void> => ipcRenderer.invoke('loopflow:term:clear', id),
    onData: (cb: (p: TermPayload) => void) => {
      const h = (_e: unknown, p: TermPayload) => cb(p);
      ipcRenderer.on('loopflow:term:data', h);
      return () => ipcRenderer.removeListener('loopflow:term:data', h);
    },
    onClear: (cb: (p: TermClearPayload) => void) => {
      const h = (_e: unknown, p: TermClearPayload) => cb(p);
      ipcRenderer.on('loopflow:term:clear', h);
      return () => ipcRenderer.removeListener('loopflow:term:clear', h);
    },
  },
});
