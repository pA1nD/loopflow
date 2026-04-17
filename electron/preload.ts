import { contextBridge, ipcRenderer } from 'electron';

interface LlmRequest {
  prompt: string;
  skill?: string;
  envVars?: Record<string, string>;
  schema?: string;
}

contextBridge.exposeInMainWorld('loopflow', {
  env: {
    headless: process.env.LOOPFLOW_HEADLESS === '1',
  },
  llm: (req: LlmRequest) => ipcRenderer.invoke('llm:call', req),
});
