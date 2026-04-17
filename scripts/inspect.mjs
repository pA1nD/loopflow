// Raw CDP (Chrome DevTools Protocol) client. Talks WebSocket directly to
// the running Electron dev app (launched with `npm run dev:debug`) and
// evaluates a JS expression against the renderer.
//
// Usage:
//   node scripts/inspect.mjs '<expression>'
//
//   node scripts/inspect.mjs 'window.__loopflow.getState()'
//   node scripts/inspect.mjs 'window.__loopflow.seedExample()'
//   node scripts/inspect.mjs 'window.__loopflow.runFromCard("cid","mid")'

const PORT = process.env.LOOPFLOW_DEBUG_PORT || '9222';
const TIMEOUT_MS = Number(process.env.LOOPFLOW_CDP_TIMEOUT_MS || 120_000);

// Only run as CLI when invoked directly — other scripts import evalInPage.
import { fileURLToPath } from 'node:url';
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  const expr = process.argv.slice(2).join(' ');
  if (!expr) {
    console.error('usage: node scripts/inspect.mjs "<expression>"');
    process.exit(2);
  }
  const res = await evalInPage(expr);
  console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
}

export async function evalInPage(expression, { port = PORT, timeout = TIMEOUT_MS } = {}) {
  const targets = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target on the CDP endpoint');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let idCounter = 0;
  const pending = new Map();

  ws.addEventListener('message', (evt) => {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('cdp ws error')), { once: true });
  });

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++idCounter;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  // Runtime.evaluate with awaitPromise so async expressions (runFromCard,
  // etc.) resolve before we look at the return value. The caller either
  // passes an expression (e.g. `window.foo`) or a braced block that
  // returns a value (e.g. `{ const x = 1; return x; }`).
  const wrapped = expression.trim().startsWith('{')
    ? `(async () => ${expression})()`
    : `(async () => (${expression}))()`;
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: wrapped,
    awaitPromise: true,
    returnByValue: true,
    timeout,
  });

  ws.close();

  if (exceptionDetails) {
    const txt = exceptionDetails.exception?.description || exceptionDetails.text;
    throw new Error(`cdp eval threw: ${txt}`);
  }
  return result?.value;
}
