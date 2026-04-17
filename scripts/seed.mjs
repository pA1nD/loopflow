// Seed ~/.loopflow/state.json with the last30days research loop example.
// No Electron needed — state is a plain JSON file that the app reads on
// startup via the preload. Run anytime:
//
//   node scripts/seed.mjs
//
// You can also open ~/.loopflow/state.json in any editor to tweak the
// setup by hand.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateDir = path.join(os.homedir(), '.loopflow');
const stateFile = path.join(stateDir, 'state.json');
fs.mkdirSync(stateDir, { recursive: true });

const id = () => Math.random().toString(36).slice(2, 10);

const triggerId = id();
const llmId = id();
const canvasId = id();
const findingsId = id();
const runsId = id();

const fieldIds = {
  topic: id(),
  finding: id(),
  source: id(),
  score: id(),
  // runs schema
  cardId: 'cardId',
  actionType: 'actionType',
  startedAt: 'startedAt',
  durationMs: 'durationMs',
  status: 'status',
  output: 'output',
  error: 'error',
};

const state = {
  view: 'canvas',
  activeCanvasId: canvasId,
  activeDatamodelId: null,
  selectedCardId: llmId,
  canvases: [
    {
      id: canvasId,
      name: 'research loop',
      cards: [
        {
          id: triggerId,
          kind: 'interval-trigger',
          title: 'every hour',
          body: '',
          x: 120,
          y: 200,
          params: { intervalSeconds: 3600, enabled: false },
        },
        {
          id: llmId,
          kind: 'llm',
          title: 'last 30 days',
          body: '',
          x: 120 + 180 + 48,
          y: 200,
          params: {
            prompt:
              'Research "react 19" and list the 3-5 most notable findings from the last 30 days. ' +
              'For each item, include a clear title in `finding`, the original `source` (reddit / x / hn / blog / web), ' +
              'and a relevance `score` between 0 and 1. Always set `topic` to "react 19".',
            skill: 'last30days',
            envVars: '',
            datamodelId: findingsId,
            datamodelName: 'findings',
          },
        },
      ],
      edges: [{ id: id(), from: triggerId, to: llmId }],
    },
  ],
  datamodels: [
    {
      id: runsId,
      name: 'runs',
      isSystem: true,
      fields: [
        { id: 'flowId', name: 'flowId', type: 'string' },
        { id: fieldIds.cardId, name: 'cardId', type: 'string' },
        { id: fieldIds.actionType, name: 'actionType', type: 'string' },
        { id: fieldIds.startedAt, name: 'startedAt', type: 'string' },
        { id: fieldIds.durationMs, name: 'durationMs', type: 'number' },
        { id: fieldIds.status, name: 'status', type: 'string' },
        { id: fieldIds.output, name: 'output', type: 'string' },
        { id: fieldIds.error, name: 'error', type: 'string' },
      ],
      rows: [],
    },
    {
      id: findingsId,
      name: 'findings',
      fields: [
        { id: fieldIds.topic, name: 'topic', type: 'string' },
        { id: fieldIds.finding, name: 'finding', type: 'string' },
        { id: fieldIds.source, name: 'source', type: 'string' },
        { id: fieldIds.score, name: 'score', type: 'number' },
      ],
      rows: [],
    },
  ],
};

fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
console.log('wrote', stateFile);
console.log(
  `  canvas "research loop" with ${state.canvases[0].cards.length} cards, ${state.canvases[0].edges.length} edge`,
);
console.log(`  datamodels: ${state.datamodels.map((m) => m.name).join(', ')}`);
