// End-to-end validation: drive the running app over CDP to fire the LLM
// node in the seeded research-loop canvas, then poll until rows appear
// in the target datamodel.
//
// Assumes `npm run dev:debug` is already running.

import { evalInPage } from './inspect.mjs';

const snap1 = await evalInPage(`{
  const s = window.__loopflow.getState();
  const canvas = s.canvases[0];
  const llm = canvas.cards.find(c => c.kind === 'llm');
  const findings = s.datamodels.find(m => m.name === 'findings');
  return {
    canvasId: canvas.id,
    llmId: llm.id,
    findingsId: findings.id,
    beforeRows: findings.rows.length,
    beforeRuns: s.datamodels.find(m => m.name === 'runs').rows.length,
  };
}`);
console.log('before:', snap1);

console.log('triggering runFromCard (this talks to claude -p; ~15-30s)...');
// Kick off the run, don't await — we want to poll progress.
await evalInPage(`{
  window.__loopflowRunPromise = window.__loopflow
    .runFromCard(${JSON.stringify(snap1.canvasId)}, ${JSON.stringify(snap1.llmId)})
    .then(() => ({ status: 'ok' }))
    .catch((e) => ({ status: 'error', message: String(e && e.message || e) }));
  return 'started';
}`);

const start = Date.now();
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const snap = await evalInPage(`{
    const s = window.__loopflow.getState();
    const findings = s.datamodels.find(m => m.name === 'findings');
    const runs = s.datamodels.find(m => m.name === 'runs');
    const latest = runs.rows[runs.rows.length - 1] || null;
    const sid = runs.fields.find(f => f.name === 'status').id;
    return {
      rows: findings.rows.length,
      runs: runs.rows.length,
      latestRun: latest,
      lastRunStatus: latest ? latest[sid] : null,
    };
  }`);
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`t+${elapsed}s  rows=${snap.rows}  runs=${snap.runs}  lastStatus=${snap.lastRunStatus}`);
  if (snap.rows > 0) break;
  if (snap.lastRunStatus === 'error') {
    console.error('last run recorded as error:', snap.latestRun);
    break;
  }
}

const outcome = await evalInPage(`{
  const r = await window.__loopflowRunPromise;
  const s = window.__loopflow.getState();
  const findings = s.datamodels.find(m => m.name === 'findings');
  const byName = Object.fromEntries(findings.fields.map(f => [f.id, f.name]));
  const rows = findings.rows.map(row =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [byName[k] || k, v]))
  );
  return { runResolution: r, rowCount: findings.rows.length, rows };
}`);

console.log('\nrun resolution:', outcome.runResolution);
console.log('row count:', outcome.rowCount);
console.log('rows:');
for (const row of outcome.rows) console.log(' ', JSON.stringify(row));
