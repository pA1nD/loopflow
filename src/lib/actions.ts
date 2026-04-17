// Action registry. Each action is a module with a typed param schema and a
// run() function. The kernel only knows this interface; action bodies are
// intended to be replaceable (and eventually AI-authorable).

import type { CardStorage, Datamodel, Field, FieldType } from './types';

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
  // Card-level storage config — actions read it to know what shape they
  // should produce, but the kernel handles writing.
  storage?: CardStorage;
}

export type ActionCategory = 'trigger' | 'action';

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
    'Wraps `claude -p`. Persistence is handled by the card\'s data settings — pick or define a datamodel below and the LLM is asked to produce its exact shape.',
  params: [
    {
      name: 'prompt',
      type: 'text',
      label: 'prompt',
      placeholder:
        'e.g. Research "react 19" using the last30days skill — return concrete findings.',
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
      placeholder: 'REDDIT_CLIENT_ID=...',
      help: 'Passed to the claude subprocess, one KEY=value per line.',
    },
  ],
  run: async (ctx) => {
    const prompt =
      (ctx.params.prompt as string | undefined) ??
      (() => {
        const topic = (ctx.input as { topic?: string } | null | undefined)?.topic;
        return topic ? `Research "${topic}"` : '';
      })();
    const skill = (ctx.params.skill as string | undefined) || undefined;
    const envVars = parseEnvVars(ctx.params.envVars as string | undefined);

    // The schema for claude -p is derived from the card's storage config.
    // No more separate schema param — the storage IS the schema.
    const fields = resolveStorageFields(ctx);
    const schema = fields.length > 0 ? buildSchemaFromFields(fields) : undefined;

    ctx.log(
      `llm: calling claude -p skill="${skill ?? ''}" fields=[${fields.map((f) => f.name).join(',')}]`,
    );
    const response = await invokeLlm({ prompt, skill, envVars, schema });

    let parsed = response.parsed;
    if (parsed === undefined) {
      try {
        parsed = JSON.parse(response.text);
      } catch {
        parsed = { response: response.text };
      }
    }
    return parsed;
  },
};

// Inspect the card's storage config and return the field schema we want
// claude to produce rows against. Returns [] when storage is 'none' (no
// schema constraint).
function resolveStorageFields(ctx: ActionContext): Array<{ name: string; type: FieldType }> {
  const s = ctx.storage;
  if (!s || s.mode === 'none') return [];
  if (s.mode === 'existing') {
    const m = ctx.getDatamodel(s.datamodelId);
    return m ? m.fields.map((f) => ({ name: f.name, type: f.type })) : [];
  }
  return s.fields.map((f) => ({ name: f.name, type: f.type }));
}

function buildSchemaFromFields(fields: Array<{ name: string; type: FieldType }>): string {
  const props: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    props[f.name] = jsonSchemaForType(f.type);
    required.push(f.name);
  }
  const schema = {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: props,
          required,
          additionalProperties: false,
        },
      },
    },
    required: ['rows'],
    additionalProperties: false,
  };
  return JSON.stringify(schema);
}

function jsonSchemaForType(t: FieldType): Record<string, unknown> {
  switch (t) {
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'string', format: 'date' };
    default:
      return { type: 'string' };
  }
}

const registry: ActionType[] = [interval, llm];

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
