import fs from 'node:fs';
const PORT = process.env.LOOPFLOW_DEBUG_PORT || '9222';
const out = process.argv[2] || '/tmp/loopflow.png';
const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', () => j(new Error('ws error')), { once: true });
});
let id = 0;
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const myId = ++id;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === myId) {
        ws.removeEventListener('message', h);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('wrote', out);
ws.close();
