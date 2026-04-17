// Connect to a running Electron dev instance over CDP (the renderer's
// window object becomes addressable), then run a piece of JS against it.
//
// Usage:
//   node scripts/inspect.mjs 'window.__loopflow.getState()'
//   node scripts/inspect.mjs 'window.__loopflow.seedExample()'
//   node scripts/inspect.mjs 'document.title'
//
// Launch the app with `npm run dev:debug` first so the port is open.

import { chromium } from 'playwright';

const port = process.env.LOOPFLOW_DEBUG_PORT || '9222';
const js = process.argv.slice(2).join(' ');
if (!js) {
  console.error('usage: node scripts/inspect.mjs "<expression>"');
  process.exit(2);
}

const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
try {
  const ctxs = browser.contexts();
  const pages = ctxs.flatMap((c) => c.pages());
  if (pages.length === 0) throw new Error('no pages attached to CDP endpoint');
  const page = pages[0];
  const result = await page.evaluate((expr) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (0, eval)(expr);
    return Promise.resolve(val).then((v) => {
      try {
        return JSON.parse(JSON.stringify(v));
      } catch {
        return String(v);
      }
    });
  }, js);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
