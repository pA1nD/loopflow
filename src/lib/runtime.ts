// Graph runtime: invokes actions, propagates outputs downstream, records
// every execution into the `runs` system datamodel.

import { actions as storeActions, getState, RUNS_MODEL_NAME } from './store';
import { getAction } from './actions';
import type { Canvas, Card, CardStorage, Datamodel } from './types';

interface RunResult {
  status: 'ok' | 'error';
  output: unknown;
  error?: string;
}

async function runSingle(
  canvasId: string,
  card: Card,
  upstreamOutput: unknown,
  flowId: string,
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
  runningCards.add(card.id);
  bumpRuntime();
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
      storage: card.storage,
    });
  } catch (e) {
    status = 'error';
    error = e instanceof Error ? e.message : String(e);
  }

  // Card-level storage: kernel writes the rows. Actions just produce data.
  if (status === 'ok' && card.storage && card.storage.mode !== 'none') {
    try {
      writeCardOutput(canvasId, card, output);
    } catch (e) {
      status = 'error';
      error = `storage: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  runningCards.delete(card.id);
  bumpRuntime();
  const finishedAt = Date.now();

  // Record into the system runs datamodel.
  storeActions.ensureSystemModels();
  const runsModel = getState().datamodels.find(
    (m) => m.isSystem && m.name === RUNS_MODEL_NAME,
  );
  if (runsModel) {
    storeActions.appendRowByFieldName(runsModel.id, {
      flowId,
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

// ---------- card-level storage writer ----------

// Pull rows from a free-shape output: an array, an object with rows/findings/
// items/results, or a bare object (treated as a single row).
function rowsFrom(output: unknown): Array<Record<string, unknown>> {
  if (!output) return [];
  if (Array.isArray(output)) return output as Array<Record<string, unknown>>;
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    for (const key of ['rows', 'findings', 'items', 'results'] as const) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
    // Strip wrapper keys before treating it as a single row.
    const { topic, generatedAt, ...rest } = obj;
    void topic; void generatedAt;
    if (Object.keys(rest).length > 0) return [rest as Record<string, unknown>];
  }
  return [];
}

function writeCardOutput(canvasId: string, card: Card, output: unknown): void {
  const storage = card.storage as CardStorage;
  const rows = rowsFrom(output);
  if (rows.length === 0) return;

  let datamodelId: string | undefined;
  let model: Datamodel | undefined;

  if (storage.mode === 'existing') {
    datamodelId = storage.datamodelId;
    model = getState().datamodels.find((m) => m.id === datamodelId);
    if (!model) throw new Error(`datamodel ${datamodelId} not found`);
  } else if (storage.mode === 'new') {
    if (storage.createdId) {
      datamodelId = storage.createdId;
      model = getState().datamodels.find((m) => m.id === datamodelId);
      if (!model) {
        // Underlying datamodel was deleted — recreate from the configured fields.
        datamodelId = undefined;
        model = undefined;
      }
    }
    if (!datamodelId) {
      const created = storeActions.createDatamodelWithFields(
        storage.name?.trim() || 'output',
        storage.fields ?? [],
      );
      datamodelId = created.id;
      model = created;
      // Persist the createdId so subsequent runs append to the same model.
      storeActions.setCardStorage(canvasId, card.id, {
        ...storage,
        createdId: datamodelId,
      });
    }
  }

  if (!datamodelId) return;
  for (const row of rows) storeActions.appendRowByFieldName(datamodelId, row);
}

// Depth-first propagation along `edges`. Branches are run serially —
// concurrency can come later; the graph model needs it to be deterministic
// for now so the e2e suite can assert on final state.
// Each invocation (user clicks "run now" or the scheduler fires a trigger)
// starts a new flow with a shared id. Every node run performed as part of
// that walk stamps this id onto its row — the UI groups by flowId to
// display a collapsible "flow" row with its constituent steps.
const newFlowId = () => Math.random().toString(36).slice(2, 10);

export async function runFromCard(canvasId: string, cardId: string): Promise<void> {
  const canvas = getState().canvases.find((c) => c.id === canvasId);
  if (!canvas) return;
  const card = canvas.cards.find((c) => c.id === cardId);
  if (!card) return;
  const flowId = newFlowId();
  await walk(canvas, card, null, flowId);
}

async function walk(canvas: Canvas, card: Card, input: unknown, flowId: string): Promise<void> {
  const result = await runSingle(canvas.id, card, input, flowId);
  if (result.status === 'error') return;
  // Re-read canvas state in case the node mutated it (e.g. LLM action
  // auto-creating a datamodel + updating its own datamodelId param).
  const fresh = getState().canvases.find((c) => c.id === canvas.id);
  if (!fresh) return;
  const outgoing = fresh.edges.filter((e) => e.from === card.id);
  for (const edge of outgoing) {
    const next = fresh.cards.find((c) => c.id === edge.to);
    if (!next) continue;
    await walk(fresh, next, result.output, flowId);
  }
}

// ---------- scheduler ----------

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
const lastFiredAt = new Map<string, number>();

// ---------- observable runtime state ----------
// Cards that are currently executing (between start and finish of runSingle).
const runningCards = new Set<string>();
let runtimeVersion = 0;
const runtimeSubs = new Set<() => void>();
function bumpRuntime() {
  runtimeVersion++;
  for (const s of runtimeSubs) s();
}

export function subscribeRuntime(cb: () => void): () => void {
  runtimeSubs.add(cb);
  return () => runtimeSubs.delete(cb);
}

export function getRuntimeVersion(): number {
  return runtimeVersion;
}

export function isCardRunning(cardId: string): boolean {
  return runningCards.has(cardId);
}

export function getLastFiredAt(cardId: string): number | undefined {
  return lastFiredAt.get(cardId);
}

// Drop a card's scheduler memory so the next enable starts a fresh interval.
// Called from the UI when the user pauses a trigger — otherwise the disable
// only takes effect on the next scheduler tick, and a quick off/on toggle
// would appear to resume the old countdown.
export function resetTriggerTimer(cardId: string): void {
  if (lastFiredAt.delete(cardId)) bumpRuntime();
}

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
      if (!card.params?.enabled) {
        // Disabled: drop timer state so re-enabling restarts from zero
        // rather than resuming mid-interval.
        if (lastFiredAt.has(card.id)) {
          lastFiredAt.delete(card.id);
          bumpRuntime();
        }
        continue;
      }
      const intervalSec = Number(card.params.intervalSeconds ?? 3600);
      const last = lastFiredAt.get(card.id);
      // First tick after enabling: seed the timer so the first fire happens
      // AFTER one interval, not immediately on enable.
      if (last === undefined) {
        lastFiredAt.set(card.id, now);
        bumpRuntime();
        continue;
      }
      if (now - last >= intervalSec * 1000) {
        lastFiredAt.set(card.id, now);
        bumpRuntime();
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
