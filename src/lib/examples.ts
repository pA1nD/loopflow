// Pre-canned example flows. Construct state by calling the same store
// actions the UI uses so persistence, IDs, etc. are indistinguishable
// from what a human would build.

import { actions, getState } from './store';

export function seedLast30DaysExample(): void {
  const canvas = actions.createCanvas('research loop');

  // Target datamodel — fields match the default LLM schema so rows land
  // cleanly without a separate mapping step.
  const findings = actions.createDatamodelFromRows('findings', [
    { topic: '', finding: '', source: '', score: 0 },
  ]);

  // Jump back to canvas view after creating the datamodel.
  actions.setView('canvas');
  actions.selectCanvas(canvas.id);

  const trigger = actions.addCard(canvas.id, {
    kind: 'interval-trigger',
    title: 'every hour',
    x: 120,
    y: 200,
    params: { intervalSeconds: 3600, enabled: false },
  });

  const llm = actions.addCard(canvas.id, {
    kind: 'llm',
    title: 'last 30 days',
    x: 120 + 180 + 48,
    y: 200,
    params: {
      prompt:
        'Research "react 19" and list the 3-5 most notable findings from the last 30 days. ' +
        'For each item, include a clear title in `finding`, the original `source` (reddit / x / hn / blog / web), ' +
        'and a relevance `score` between 0 and 1. Always set `topic` to "react 19".',
      skill: 'last30days',
      envVars: '',
    },
  });
  actions.setCardStorage(canvas.id, llm.id, {
    mode: 'existing',
    datamodelId: findings.id,
  });

  actions.addEdge(canvas.id, trigger.id, llm.id);
  actions.setSelectedCard(llm.id);

  // Sanity-check so a failed seed surfaces in the caller's console.
  const s = getState();
  const live = s.canvases.find((c) => c.id === canvas.id);
  if (!live || live.cards.length !== 2 || live.edges.length !== 1) {
    console.warn('seedLast30DaysExample: unexpected canvas shape', live);
  }
}
