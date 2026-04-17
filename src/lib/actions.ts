// Action registry. Each action is a module with a typed param schema and a
// run() function. The kernel only knows this interface; action bodies are
// intended to be replaceable (and eventually AI-authorable).

import type { Datamodel, Field, FieldType } from './types';

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
  help?: string;
}

export interface ActionContext {
  canvasId: string;
  cardId: string;
  params: Record<string, unknown>;
  input: unknown;
  now: () => number;
  log: (msg: string) => void;
  getDatamodel: (id: string) => Datamodel | undefined;
  findDatamodelByName: (name: string) => Datamodel | undefined;
  appendRow: (datamodelId: string, values: Record<string, unknown>) => void;
  // Create a datamodel whose schema is inferred from a sample row.
  createDatamodelFromRows: (
    name: string,
    rows: Array<Record<string, unknown>>,
  ) => Datamodel;
  // Patches this card's own params (used when an action wants to remember
  // state across runs, e.g. "here is the datamodel I auto-created").
  setOwnParam: (name: string, value: unknown) => void;
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
// LLM bridge — always real. Talks to the main process which spawns
// `claude -p --output-format=json --json-schema <schema>`.
// ------------------------------------------------------------------

interface LlmRequest {
  prompt: string;
  skill?: string;
  envVars?: Record<string, string>;
  schema?: string;
}

interface LlmResponse {
  text: string;
  parsed?: unknown;
  meta?: { durationMs?: number; sessionId?: string; costUsd?: number };
}

declare global {
  interface Window {
    loopflow?: {
      llm?: (req: LlmRequest) => Promise<LlmResponse>;
      env?: { headless?: boolean; statePath?: string };
      storage?: {
        initialState?: unknown;
        write?: (data: unknown) => Promise<unknown>;
      };
    };
  }
}

// The default schema is suitable for research-style outputs (findings with
// a source and score). Users can override via the `schema` param on the
// llm action — anything valid for `--json-schema`.
const DEFAULT_LLM_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          finding: { type: 'string' },
          source: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['topic', 'finding', 'source', 'score'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} as const;

async function invokeLlm(req: LlmRequest): Promise<LlmResponse> {
  const bridge = typeof window !== 'undefined' ? window.loopflow?.llm : undefined;
  if (!bridge) {
    throw new Error(
      'llm bridge unavailable — the app must be launched via Electron ' +
        '(npm run dev or a built binary) so the preload can expose claude -p',
    );
  }
  return await bridge(req);
}

function parseEnvVars(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Extract a rows array from the LLM response shape. Accepts a top-level
// array, an object with `findings` / `rows` / `items`, or a single object
// (single-row output).
function extractRows(parsed: unknown): Array<Record<string, unknown>> {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['findings', 'rows', 'items', 'results'] as const) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
    // Treat the object itself as one row, dropping obvious container keys.
    const { topic, generatedAt, ...rest } = obj; // eslint-disable-line @typescript-eslint/no-unused-vars
    if (Object.keys(rest).length > 0) return [rest as Record<string, unknown>];
  }
  return [];
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

const llm: ActionType = {
  id: 'llm',
  label: 'llm',
  category: 'action',
  description:
    'Wraps `claude -p` with a JSON schema and appends the structured output to a datamodel (selected or auto-created).',
  params: [
    {
      name: 'prompt',
      type: 'text',
      label: 'prompt',
      placeholder:
        'e.g. Research "react 19" using the last30days skill — return 3 concrete findings.',
    },
    {
      name: 'skill',
      type: 'string',
      label: 'skill',
      placeholder: 'last30days',
      help: 'Optional skill identifier. Appended to the prompt as a hint.',
    },
    {
      name: 'envVars',
      type: 'text',
      label: 'env vars',
      placeholder: 'ANTHROPIC_API_KEY=...\nREDDIT_CLIENT_ID=...',
      help: 'Passed to the claude subprocess, one KEY=value per line.',
    },
    {
      name: 'schema',
      type: 'text',
      label: 'json schema',
      default: JSON.stringify(DEFAULT_LLM_SCHEMA, null, 2),
      help: 'Forwarded to --json-schema so claude enforces the output shape.',
    },
    {
      name: 'datamodelId',
      type: 'datamodel',
      label: 'target datamodel',
      help: 'Leave empty to auto-create one from the first response.',
    },
    {
      name: 'datamodelName',
      type: 'string',
      label: 'auto-create name',
      placeholder: 'findings',
      default: 'llm results',
      help: 'Used when no target datamodel is selected — the first run creates and remembers it.',
    },
  ],
  run: async (ctx) => {
    const prompt =
      (ctx.params.prompt as string | undefined) ??
      // fallback to upstream input.topic if prompt wasn't configured
      (() => {
        const topic = (ctx.input as { topic?: string } | null | undefined)?.topic;
        return topic ? `Research "${topic}"` : '';
      })();
    const skill = (ctx.params.skill as string | undefined) || undefined;
    const envVars = parseEnvVars(ctx.params.envVars as string | undefined);
    const schema =
      (ctx.params.schema as string | undefined)?.trim() ||
      JSON.stringify(DEFAULT_LLM_SCHEMA);

    ctx.log(`llm: calling claude -p skill="${skill ?? ''}" envKeys=[${Object.keys(envVars).join(',')}]`);
    const response = await invokeLlm({ prompt, skill, envVars, schema });

    let parsed = response.parsed;
    if (parsed === undefined) {
      try {
        parsed = JSON.parse(response.text);
      } catch {
        parsed = { response: response.text };
      }
    }
    const rows = extractRows(parsed);
    if (rows.length === 0) {
      ctx.log('llm: response produced no rows, nothing to append');
      return { rowsAppended: 0, response: parsed };
    }

    // Resolve target datamodel — either preconfigured, reusable by name, or
    // auto-created from the first row's keys.
    let datamodelId = (ctx.params.datamodelId as string | undefined) || undefined;
    if (datamodelId && !ctx.getDatamodel(datamodelId)) datamodelId = undefined;
    if (!datamodelId) {
      const wanted = (ctx.params.datamodelName as string | undefined)?.trim() || 'llm results';
      const existing = ctx.findDatamodelByName(wanted);
      const target = existing ?? ctx.createDatamodelFromRows(wanted, rows);
      datamodelId = target.id;
      ctx.setOwnParam('datamodelId', datamodelId);
      ctx.log(
        existing
          ? `llm: reusing existing datamodel "${wanted}"`
          : `llm: created datamodel "${wanted}" with ${target.fields.length} fields`,
      );
    }

    for (const row of rows) ctx.appendRow(datamodelId, row);
    ctx.log(`llm: appended ${rows.length} row(s)`);
    return { rowsAppended: rows.length, datamodelId };
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
    const rows = extractRows(ctx.input);
    for (const row of rows) ctx.appendRow(datamodelId, row);
    ctx.log(`datastore-append: wrote ${rows.length} row(s) to ${model.name}`);
    return { appended: rows.length, datamodelId };
  },
};

const labelOnly = (id: string): ActionType => ({ id, label: id, category: 'label' });

const registry: ActionType[] = [
  interval,
  llm,
  datastoreAppend,
  labelOnly('prompt'),
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

// Exported so the renderer can infer a datamodel schema from rows when the
// user asks an action to auto-create one.
export function inferFieldsFromRows(
  rows: Array<Record<string, unknown>>,
): Array<Omit<Field, 'id'>> {
  if (rows.length === 0) return [];
  const keys = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) keys.add(k);
  const out: Array<Omit<Field, 'id'>> = [];
  for (const k of keys) {
    const sampleValue = rows.find((r) => r[k] !== undefined && r[k] !== null)?.[k];
    const t = inferType(sampleValue);
    out.push({ name: k, type: t });
  }
  return out;
}

function inferType(v: unknown): FieldType {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'string';
}
