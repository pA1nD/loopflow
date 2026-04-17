// Action registry. Each action is a module with a typed param schema and a
// pure-ish run() function. The kernel only knows this interface; action
// bodies are intended to be replaceable (and eventually AI-authorable).

import type { Datamodel } from './types';

export type ParamType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'datamodel';

export interface ParamDef {
  name: string;
  type: ParamType;
  label?: string;
  placeholder?: string;
  default?: unknown;
}

export interface ActionContext {
  params: Record<string, unknown>;
  input: unknown;
  now: () => number;
  log: (msg: string) => void;
  getDatamodel: (id: string) => Datamodel | undefined;
  appendRow: (datamodelId: string, values: Record<string, unknown>) => void;
}

export type ActionCategory = 'trigger' | 'action' | 'sink' | 'label';

export interface ActionType {
  id: string;
  label: string;
  category: ActionCategory;
  description?: string;
  params?: ParamDef[];
  run?: (ctx: ActionContext) => Promise<unknown>;
}

// ------------------------------------------------------------------
// Built-in actions
// ------------------------------------------------------------------

const interval: ActionType = {
  id: 'interval-trigger',
  label: 'interval trigger',
  category: 'trigger',
  description: 'Fires on a fixed cadence while the app is open.',
  params: [
    { name: 'intervalSeconds', type: 'number', label: 'every (seconds)', default: 3600 },
    { name: 'enabled', type: 'boolean', label: 'enabled', default: false },
  ],
  run: async (ctx) => ({ triggeredAt: new Date(ctx.now()).toISOString() }),
};

const last30days: ActionType = {
  id: 'last30days',
  label: 'last 30 days',
  category: 'action',
  description: 'Research a topic across Reddit, X, HN (currently mocked).',
  params: [
    { name: 'topic', type: 'string', label: 'topic', placeholder: 'react 19' },
  ],
  run: async (ctx) => {
    const topic =
      (ctx.params.topic as string | undefined) ??
      (ctx.input as { topic?: string } | null)?.topic ??
      'unknown';
    // Mock — deterministic fixture. The real implementation will shell out to
    // python3 ~/.claude/skills/last30days/scripts/last30days.py <topic>
    // via an IPC bridge in a later increment.
    const findings = [
      { topic, finding: `${topic} hot take from r/programming`, source: 'reddit', score: 0.92 },
      { topic, finding: `${topic} thread on x.com`, source: 'x', score: 0.81 },
      { topic, finding: `${topic} top HN comment`, source: 'hn', score: 0.74 },
    ];
    ctx.log(`last30days: ${findings.length} findings for "${topic}"`);
    return { topic, findings, generatedAt: new Date(ctx.now()).toISOString() };
  },
};

const datastoreAppend: ActionType = {
  id: 'datastore-append',
  label: 'datastore append',
  category: 'sink',
  description: "Writes the upstream output to a datamodel's rows.",
  params: [{ name: 'datamodelId', type: 'datamodel', label: 'target datamodel' }],
  run: async (ctx) => {
    const datamodelId = ctx.params.datamodelId as string | undefined;
    if (!datamodelId) throw new Error('datastore-append: no datamodel selected');
    const model = ctx.getDatamodel(datamodelId);
    if (!model) throw new Error(`datastore-append: datamodel ${datamodelId} not found`);

    // Accept three input shapes: an array of rows, an object with a
    // `findings`/`rows`/`items` array, or a single object (single-row).
    const input = ctx.input as unknown;
    let rows: Record<string, unknown>[] = [];
    if (Array.isArray(input)) {
      rows = input as Record<string, unknown>[];
    } else if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      const arrKey = (['findings', 'rows', 'items'] as const).find(
        (k) => Array.isArray(obj[k]),
      );
      if (arrKey) rows = obj[arrKey] as Record<string, unknown>[];
      else rows = [obj];
    }

    for (const row of rows) ctx.appendRow(datamodelId, row);
    ctx.log(`datastore-append: wrote ${rows.length} row(s) to ${model.name}`);
    return { appended: rows.length, datamodelId };
  },
};

const labelOnly = (id: string): ActionType => ({ id, label: id, category: 'label' });

const registry: ActionType[] = [
  interval,
  last30days,
  datastoreAppend,
  labelOnly('prompt'),
  labelOnly('llm'),
  labelOnly('tool'),
  labelOnly('output'),
  labelOnly('note'),
];

const byId = new Map(registry.map((a) => [a.id, a]));

export const allActionTypes = registry;
export function getAction(id: string): ActionType | undefined {
  return byId.get(id);
}

export function actionLabel(id: string): string {
  return byId.get(id)?.label ?? id;
}
