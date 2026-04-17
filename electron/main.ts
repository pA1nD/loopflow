import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const HEADLESS = process.env.LOOPFLOW_HEADLESS === '1';

// Optional CDP (Chrome DevTools Protocol) endpoint so tools like Playwright
// or raw fetch can drive / inspect the running app. Enabled when
// LOOPFLOW_DEBUG_PORT is set. Must be registered BEFORE app.whenReady().
const DEBUG_PORT = process.env.LOOPFLOW_DEBUG_PORT;
if (DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', DEBUG_PORT);
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

// JSON-on-disk state. One line to pass to the preload (so it can sync-read
// it before the renderer boots), one ipcMain handler for writes.
// LOOPFLOW_STATE_FILE is honored as an override (tests point at a temp
// file so they don't clobber the user's real state).
const DEFAULT_STATE_DIR = path.join(os.homedir(), '.loopflow');
const STATE_FILE =
  process.env.LOOPFLOW_STATE_FILE || path.join(DEFAULT_STATE_DIR, 'state.json');
try {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
} catch {
  /* ignore */
}

ipcMain.handle('storage:write', async (_event, payload: unknown) => {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2));
  await rename(tmp, STATE_FILE); // atomic replace
  return { ok: true };
});

// ---------- terminal sessions ----------
// One in-memory session per canvas. We tee stdout/stderr of the existing
// llm:call spawn into the session, plus a synthetic header/footer so the
// renderer can see the exact command, its output, and the exit code as it
// happens. No PTY: the claude command runs in the same pipe mode as
// before, which keeps the structured JSON parse working.

interface TerminalSession {
  id: string;
  buffer: string;
}

const TERM_BUFFER_CAP = 512 * 1024; // 512KB per session; oldest bytes dropped
const sessions = new Map<string, TerminalSession>();

function getSession(id: string): TerminalSession {
  let s = sessions.get(id);
  if (!s) {
    s = { id, buffer: '' };
    sessions.set(id, s);
  }
  return s;
}

function appendSession(id: string, chunk: string) {
  const s = getSession(id);
  s.buffer += chunk;
  if (s.buffer.length > TERM_BUFFER_CAP) {
    s.buffer = s.buffer.slice(-TERM_BUFFER_CAP);
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('loopflow:term:data', { id, chunk });
  }
}

ipcMain.handle('loopflow:term:get-buffer', (_e, id: string) => getSession(id).buffer);
ipcMain.handle('loopflow:term:clear', (_e, id: string) => {
  const s = getSession(id);
  s.buffer = '';
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('loopflow:term:clear', { id });
  }
});

// Small ANSI helpers for the synthetic header/footer. xterm.js renders
// these natively, so we don't need an ANSI parser — we just emit codes.
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// ---------- generic exec + terminal reporter ----------
// Any action that shells out (claude today, scripts/docker later) goes
// through runExec. The terminal receives a truthful, copy-pastable
// reproduction: cwd change, exported env vars, properly shell-quoted
// argv, and a heredoc for stdin. That way whatever the user sees in the
// terminal panel is literally what they can paste into their shell.

interface ExecSpec {
  cmd: string[]; // argv[0] is the binary; rest are arguments, unquoted
  cwd?: string;
  env?: Record<string, string>; // ADDITIONAL env — inherited shell env is assumed
  stdin?: string; // if set, fed to the process and rendered as a heredoc
  timeoutMs?: number;
  sessionId?: string; // terminal session (typically canvasId)
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// POSIX single-quote shell quoting. Safe chars stay bare; everything else
// is wrapped in '…', and embedded single quotes become '\'' (end-quote,
// escaped quote, reopen-quote).
function shellQuote(s: string): string {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

function emitExecHeader(sid: string, spec: ExecSpec) {
  // Always emit cwd so the terminal line is reproducible without the user
  // having to guess which directory the process ran in.
  const cwd = spec.cwd ?? process.cwd();
  appendSession(sid, `${DIM}$ cd ${shellQuote(cwd)}${RESET}\r\n`);
  for (const [k, v] of Object.entries(spec.env ?? {})) {
    appendSession(sid, `${DIM}$ export ${k}=${shellQuote(v)}${RESET}\r\n`);
  }
  const [bin, ...rest] = spec.cmd;
  const head =
    `${BOLD}${CYAN}${shellQuote(bin)}${RESET}${DIM}` +
    (rest.length ? ' ' + rest.map(shellQuote).join(' ') : '');
  if (spec.stdin !== undefined) {
    appendSession(sid, `${DIM}$ ${head} <<'LOOPFLOW-STDIN'${RESET}\r\n`);
    appendSession(sid, spec.stdin);
    if (!spec.stdin.endsWith('\n')) appendSession(sid, '\r\n');
    appendSession(sid, `${DIM}LOOPFLOW-STDIN${RESET}\r\n`);
  } else {
    appendSession(sid, `${DIM}$ ${head}${RESET}\r\n`);
  }
}

function emitExecFooter(sid: string, exitCode: number, durationMs: number) {
  const accent = exitCode === 0 ? DIM : `${RED}`;
  appendSession(
    sid,
    `\r\n${accent}[exit ${exitCode} · ${durationMs}ms]${RESET}\r\n\r\n`,
  );
}

async function runExec(spec: ExecSpec): Promise<ExecResult> {
  const sid = spec.sessionId;
  const startedAt = Date.now();
  if (sid) emitExecHeader(sid, spec);

  return await new Promise<ExecResult>((resolve, reject) => {
    const [cmd, ...args] = spec.cmd;
    const env = { ...process.env, ...(spec.env ?? {}) };
    const proc = spawn(cmd, args, {
      env,
      cwd: spec.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeoutMs = spec.timeoutMs ?? 180_000;
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      if (sid)
        appendSession(sid, `${RED}[timeout after ${timeoutMs / 1000}s — SIGTERM sent]${RESET}\r\n`);
      reject(new Error(`exec timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    proc.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (sid) appendSession(sid, s);
    });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      // dim stderr so it visually separates from stdout in the terminal
      if (sid) appendSession(sid, `${DIM}${s}${RESET}`);
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      if (sid) appendSession(sid, `${RED}[spawn error: ${e.message}]${RESET}\r\n`);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? -1;
      const durationMs = Date.now() - startedAt;
      if (sid) emitExecFooter(sid, exitCode, durationMs);
      resolve({ stdout, stderr, exitCode, durationMs });
    });
    if (spec.stdin !== undefined) {
      proc.stdin.write(spec.stdin);
      proc.stdin.end();
    }
  });
}

function createWindow() {
  // Expose the state path + headless flag to the preload via process env
  // so preload can sync-read the file before the renderer starts.
  process.env.LOOPFLOW_STATE_FILE = STATE_FILE;
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
      // Sandbox must be off so the preload can sync-read the state file
      // via node:fs before the renderer boots. We still keep context
      // isolation on and expose only the narrow bridge (storage, llm).
      sandbox: false,
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
  // Optional session id (the canvas the card lives on). When present, the
  // spawn's stdout/stderr is teed into this terminal session so the
  // renderer can display the live execution.
  sessionId?: string;
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
  const composed = composePrompt(req.prompt, req.skill);

  const result = await runExec({
    cmd: [bin, ...args],
    env: req.envVars, // only the user-specified vars; inherited env matches their shell
    stdin: composed,
    sessionId: req.sessionId,
    timeoutMs: 180_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `claude -p exited with code ${result.exitCode}.\n` +
        `stderr: ${result.stderr.slice(0, 1000)}\n` +
        `stdout: ${result.stdout.slice(0, 1000)}`,
    );
  }
  try {
    const payload = JSON.parse(result.stdout);
    if (payload.is_error) {
      throw new Error(`claude error: ${payload.result ?? 'unknown'}`);
    }
    return {
      text: typeof payload.result === 'string' ? payload.result : '',
      parsed: payload.structured_output,
      meta: {
        durationMs: payload.duration_ms,
        sessionId: payload.session_id,
        costUsd: payload.total_cost_usd,
      },
    };
  } catch (e) {
    throw new Error(
      `failed to parse claude output: ${(e as Error).message}\nstdout (head): ${result.stdout.slice(0, 500)}`,
    );
  }
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
