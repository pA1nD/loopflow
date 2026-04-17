// One-shot seeder: launches Electron headlessly, resets the persisted
// state, builds the last30days example via window.__loopflow.seedExample,
// then exits. The next time `npm run dev` starts, the app loads the
// seeded state from localStorage.
//
// Usage:  node scripts/seed.mjs

import { _electron as electron } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const app = await electron.launch({
  args: [repoRoot],
  cwd: repoRoot,
  env: {
    ...process.env,
    LOOPFLOW_HEADLESS: '1',
  },
});

const page = await app.firstWindow();
await page.waitForSelector('[data-testid="titlebar"]');
await page.evaluate(() => window.__loopflow?.seedExample?.('last30days'));
// Give the renderer a tick to commit localStorage.
await page.waitForTimeout(500);

const summary = await page.evaluate(() => {
  const raw = localStorage.getItem('loopflow:state:v1');
  if (!raw) return null;
  const s = JSON.parse(raw);
  return {
    canvases: s.canvases?.length ?? 0,
    firstCanvas: s.canvases?.[0]?.name,
    cards: s.canvases?.[0]?.cards?.length ?? 0,
    edges: s.canvases?.[0]?.edges?.length ?? 0,
    datamodels: s.datamodels?.map((m) => m.name) ?? [],
  };
});

console.log('seeded:', JSON.stringify(summary, null, 2));
await app.close();
