import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const HEADLESS = process.env.LOOPFLOW_HEADLESS === '1';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#fafafa',
    titleBarStyle: 'hiddenInset',
    show: !HEADLESS,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: HEADLESS,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// ---------- LLM bridge ----------
// Real, not mocked: spawns the user's `claude` CLI in --print mode with a
// JSON schema so the output is structured + parseable. The cached path is
// resolved on the first call so we don't re-run `which` each time.

let resolvedClaudePath: string | null = null;

async function resolveClaudePath(): Promise<string> {
  if (resolvedClaudePath) return resolvedClaudePath;
  const override = process.env.LOOPFLOW_CLAUDE_BIN;
  const candidates = [
    override,
    process.env.HOME ? `${process.env.HOME}/.local/bin/claude` : undefined,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);
  for (const c of candidates) {
    if (existsSync(c)) {
      resolvedClaudePath = c;
      return c;
    }
  }
  // Fall back to the user's login shell so PATH additions (fnm, nvm, asdf,
  // ...) become visible to the spawned subprocess.
  return await new Promise<string>((resolve, reject) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const p = spawn(shell, ['-lic', 'command -v claude']);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => {
      const trimmed = out.trim().split('\n').pop() ?? '';
      if (code === 0 && trimmed && existsSync(trimmed)) {
        resolvedClaudePath = trimmed;
        resolve(trimmed);
      } else {
        reject(new Error(`claude CLI not found on PATH: ${err || 'no output'}`));
      }
    });
  });
}

interface LlmCall {
  prompt: string;
  skill?: string;
  envVars?: Record<string, string>;
  schema?: string;
}

function composePrompt(prompt: string, skill: string | undefined): string {
  const parts: string[] = [];
  parts.push(prompt?.trim() || 'Produce findings.');
  if (skill) parts.push(`Use the "${skill}" skill if applicable.`);
  parts.push('Respond with structured JSON matching the provided schema.');
  return parts.join('\n\n');
}

ipcMain.handle('llm:call', async (_event, req: LlmCall) => {
  const bin = await resolveClaudePath();
  const schema = req.schema?.trim() ? req.schema : undefined;
  const args = ['-p', '--output-format=json'];
  if (schema) args.push('--json-schema', schema);

  const env = { ...process.env, ...(req.envVars ?? {}) };
  const composed = composePrompt(req.prompt, req.skill);

  return await new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeoutMs = 180_000;
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`claude -p timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `claude -p exited with code ${code}.\nstderr: ${stderr.slice(0, 1000)}\nstdout: ${stdout.slice(0, 1000)}`,
          ),
        );
        return;
      }
      try {
        const payload = JSON.parse(stdout);
        if (payload.is_error) {
          reject(new Error(`claude error: ${payload.result ?? 'unknown'}`));
          return;
        }
        resolve({
          text: typeof payload.result === 'string' ? payload.result : '',
          parsed: payload.structured_output,
          meta: {
            durationMs: payload.duration_ms,
            sessionId: payload.session_id,
            costUsd: payload.total_cost_usd,
          },
        });
      } catch (e) {
        reject(
          new Error(
            `failed to parse claude output: ${(e as Error).message}\nstdout (head): ${stdout.slice(0, 500)}`,
          ),
        );
      }
    });
    proc.stdin.write(composed);
    proc.stdin.end();
  });
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
