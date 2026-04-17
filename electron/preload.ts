// Exposes a narrow, privileged surface to the renderer. Kept intentionally
// small — the action kernel only has whatever is bridged here.
import { contextBridge } from 'electron';

const env = {
  mockLLM: process.env.LOOPFLOW_MOCK_LLM === '1',
  headless: process.env.LOOPFLOW_HEADLESS === '1',
};

contextBridge.exposeInMainWorld('loopflow', {
  env,
  // llm: wired in a later increment (real Anthropic SDK via ipcRenderer.invoke).
});
