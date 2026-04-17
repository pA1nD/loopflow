// Graph runtime: invokes actions, propagates outputs downstream, records
// every execution into the `runs` system datamodel.

import { actions as storeActions, getState, RUNS_MODEL_NAME } from './store';
import { getAction } from './actions';
import type { Canvas, Card } from './types';

interface RunResult {
  status: 'ok' | 'error';
  output: unknown;
  error?: string;
}

async function runSingle(
  canvasId: string,
  card: Card,
  upstreamOutput: unknown,
): Promise<RunResult> {
  const action = getAction(card.kind);
  if (!action?.run) {
    // Nodes without a run fn (pure labels) are transparent — they pass their
    // upstream output through untouched so you can use them as comments or
    // placeholders in the middle of a chain.
    return { status: 'ok', output: upstreamOutput };
  }
  const startedAt = Date.now();
  let output: unknown = undefined;
  let error: string | undefined;
  let status: 'ok' | 'error' = 'ok';
  try {
    output = await action.run({
      canvasId,
      cardId: card.id,
      params: card.params ?? {},
      input: upstreamOutput,
      now: () => Date.now(),
      log: (msg) => console.info(`[${card.kind}] ${msg}`),
      getDatamodel: (modelId) => getState().datamodels.find((m) => m.id === modelId),
      findDatamodelByName: (name) => getState().datamodels.find((m) => m.name === name),
      appendRow: (modelId, values) => storeActions.appendRowByFieldName(modelId, values),
      createDatamodelFromRows: (name, rows) => storeActions.createDatamodelFromRows(name, rows),
      setOwnParam: (name, value) => storeActions.updateCardParam(canvasId, card.id, name, value),
    });
  } catch (e) {
    status = 'error';
    error = e instanceof Error ? e.message : String(e);
  }
  const finishedAt = Date.now();

  // Record into the system runs datamodel.
  storeActions.ensureSystemModels();
  const runsModel = getState().datamodels.find(
    (m) => m.isSystem && m.name === RUNS_MODEL_NAME,
  );
  if (runsModel) {
    storeActions.appendRowByFieldName(runsModel.id, {
      cardId: card.id,
      actionType: card.kind,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      status,
      output: output === undefined ? '' : safeStringify(output),
      error: error ?? '',
    });
  }

  return { status, output, error };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Depth-first propagation along `edges`. Branches are run serially —
// concurrency can come later; the graph model needs it to be deterministic
// for now so the e2e suite can assert on final state.
export async function runFromCard(canvasId: string, cardId: string): Promise<void> {
  const canvas = getState().canvases.find((c) => c.id === canvasId);
  if (!canvas) return;
  const card = canvas.cards.find((c) => c.id === cardId);
  if (!card) return;
  await walk(canvas, card, null);
}

async function walk(canvas: Canvas, card: Card, input: unknown): Promise<void> {
  const result = await runSingle(canvas.id, card, input);
  if (result.status === 'error') return; // stop this branch on error
  // Re-read canvas state in case the node mutated it (e.g. LLM action
  // auto-creating a datamodel + updating its own datamodelId param).
  const fresh = getState().canvases.find((c) => c.id === canvas.id);
  if (!fresh) return;
  const outgoing = fresh.edges.filter((e) => e.from === card.id);
  for (const edge of outgoing) {
    const next = fresh.cards.find((c) => c.id === edge.to);
    if (!next) continue;
    await walk(fresh, next, result.output);
  }
}

// ---------- scheduler ----------

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
const lastFiredAt = new Map<string, number>();

export function startScheduler(intervalMs = 1000) {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => tick(), intervalMs);
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

// Fire every enabled interval-trigger whose interval has elapsed. Exported
// so tests can drive the scheduler deterministically without waiting for
// real wall-clock time.
export async function tick(now = Date.now()): Promise<void> {
  const state = getState();
  for (const canvas of state.canvases) {
    for (const card of canvas.cards) {
      if (card.kind !== 'interval-trigger') continue;
      if (!card.params?.enabled) continue;
      const intervalSec = Number(card.params.intervalSeconds ?? 3600);
      const last = lastFiredAt.get(card.id);
      // First tick after enabling: seed the timer so the first fire happens
      // AFTER one interval, not immediately on enable.
      if (last === undefined) {
        lastFiredAt.set(card.id, now);
        continue;
      }
      if (now - last >= intervalSec * 1000) {
        lastFiredAt.set(card.id, now);
        try {
          await runFromCard(canvas.id, card.id);
        } catch (e) {
          console.error('scheduler run failed', e);
        }
      }
    }
  }
}

// Test helper — clear scheduler memory so an idempotent reset + tick still fires.
export function _resetSchedulerState() {
  lastFiredAt.clear();
}
