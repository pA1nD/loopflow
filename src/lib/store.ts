import { useEffect, useSyncExternalStore } from 'react';
import type {
  AppState,
  Canvas,
  Card,
  Datamodel,
  Edge,
  Field,
  FieldType,
} from './types';

const STORAGE_KEY = 'loopflow:state:v1';

export const RUNS_MODEL_NAME = 'runs';

function emptyState(): AppState {
  return {
    canvases: [],
    activeCanvasId: null,
    datamodels: [],
    activeDatamodelId: null,
    view: 'canvas',
    selectedCardId: null,
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return { ...emptyState(), ...parsed };
  } catch {
    return emptyState();
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function commit(next: AppState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): AppState {
  return state;
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getState(): AppState {
  return state;
}

export function useStorageSync() {
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        state = load();
        notify();
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
}

// ---------- mutations ----------

const id = () => Math.random().toString(36).slice(2, 10);

const RUNS_SCHEMA: Field[] = [
  { id: 'cardId', name: 'cardId', type: 'string' },
  { id: 'actionType', name: 'actionType', type: 'string' },
  { id: 'startedAt', name: 'startedAt', type: 'string' },
  { id: 'durationMs', name: 'durationMs', type: 'number' },
  { id: 'status', name: 'status', type: 'string' },
  { id: 'output', name: 'output', type: 'string' },
  { id: 'error', name: 'error', type: 'string' },
];

function ensureRunsModel(s: AppState): AppState {
  const existing = s.datamodels.find((m) => m.isSystem && m.name === RUNS_MODEL_NAME);
  if (existing) return s;
  const runsModel: Datamodel = {
    id: id(),
    name: RUNS_MODEL_NAME,
    fields: RUNS_SCHEMA,
    rows: [],
    isSystem: true,
  };
  return { ...s, datamodels: [...s.datamodels, runsModel] };
}

export const actions = {
  setView(view: AppState['view']) {
    commit({ ...state, view });
  },
  setSelectedCard(cardId: string | null) {
    commit({ ...state, selectedCardId: cardId });
  },

  // Canvas
  createCanvas(name = 'untitled flow'): Canvas {
    const canvas: Canvas = { id: id(), name, cards: [], edges: [] };
    commit({
      ...state,
      canvases: [...state.canvases, canvas],
      activeCanvasId: canvas.id,
      view: 'canvas',
      selectedCardId: null,
    });
    return canvas;
  },
  selectCanvas(canvasId: string) {
    commit({
      ...state,
      activeCanvasId: canvasId,
      view: 'canvas',
      selectedCardId: null,
    });
  },
  renameCanvas(canvasId: string, name: string) {
    commit({
      ...state,
      canvases: state.canvases.map((c) => (c.id === canvasId ? { ...c, name } : c)),
    });
  },
  deleteCanvas(canvasId: string) {
    const canvases = state.canvases.filter((c) => c.id !== canvasId);
    commit({
      ...state,
      canvases,
      activeCanvasId:
        state.activeCanvasId === canvasId ? canvases[0]?.id ?? null : state.activeCanvasId,
    });
  },

  addCard(canvasId: string, partial: Partial<Card> = {}): Card {
    const card: Card = {
      id: id(),
      kind: partial.kind ?? 'prompt',
      title: partial.title ?? 'untitled',
      body: partial.body ?? '',
      x: partial.x ?? 80 + Math.random() * 200,
      y: partial.y ?? 80 + Math.random() * 200,
      params: partial.params ?? {},
    };
    commit({
      ...state,
      canvases: state.canvases.map((c) =>
        c.id === canvasId ? { ...c, cards: [...c.cards, card] } : c,
      ),
    });
    return card;
  },
  updateCard(canvasId: string, cardId: string, patch: Partial<Card>) {
    commit({
      ...state,
      canvases: state.canvases.map((c) =>
        c.id === canvasId
          ? {
              ...c,
              cards: c.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
            }
          : c,
      ),
    });
  },
  updateCardParam(canvasId: string, cardId: string, name: string, value: unknown) {
    commit({
      ...state,
      canvases: state.canvases.map((c) =>
        c.id === canvasId
          ? {
              ...c,
              cards: c.cards.map((card) =>
                card.id === cardId
                  ? { ...card, params: { ...(card.params ?? {}), [name]: value } }
                  : card,
              ),
            }
          : c,
      ),
    });
  },
  deleteCard(canvasId: string, cardId: string) {
    commit({
      ...state,
      selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
      canvases: state.canvases.map((c) =>
        c.id === canvasId
          ? {
              ...c,
              cards: c.cards.filter((card) => card.id !== cardId),
              edges: c.edges.filter((e) => e.from !== cardId && e.to !== cardId),
            }
          : c,
      ),
    });
  },

  addEdge(canvasId: string, from: string, to: string): Edge | null {
    if (from === to) return null;
    const canvas = state.canvases.find((c) => c.id === canvasId);
    if (!canvas) return null;
    if (canvas.edges.some((e) => e.from === from && e.to === to)) return null;
    const edge: Edge = { id: id(), from, to };
    commit({
      ...state,
      canvases: state.canvases.map((c) =>
        c.id === canvasId ? { ...c, edges: [...c.edges, edge] } : c,
      ),
    });
    return edge;
  },
  deleteEdge(canvasId: string, edgeId: string) {
    commit({
      ...state,
      canvases: state.canvases.map((c) =>
        c.id === canvasId ? { ...c, edges: c.edges.filter((e) => e.id !== edgeId) } : c,
      ),
    });
  },

  // Datastore
  ensureSystemModels() {
    const next = ensureRunsModel(state);
    if (next !== state) commit(next);
  },
  createDatamodel(name = 'untitled model'): Datamodel {
    const model: Datamodel = { id: id(), name, fields: [], rows: [] };
    commit({
      ...state,
      datamodels: [...state.datamodels, model],
      activeDatamodelId: model.id,
      view: 'datastore',
    });
    return model;
  },
  selectDatamodel(modelId: string) {
    commit({ ...state, activeDatamodelId: modelId, view: 'datastore' });
  },
  renameDatamodel(modelId: string, name: string) {
    commit({
      ...state,
      datamodels: state.datamodels.map((m) => (m.id === modelId ? { ...m, name } : m)),
    });
  },
  deleteDatamodel(modelId: string) {
    const target = state.datamodels.find((m) => m.id === modelId);
    if (target?.isSystem) return; // system models are protected
    const datamodels = state.datamodels.filter((m) => m.id !== modelId);
    commit({
      ...state,
      datamodels,
      activeDatamodelId:
        state.activeDatamodelId === modelId
          ? datamodels[0]?.id ?? null
          : state.activeDatamodelId,
    });
  },

  addField(modelId: string, name = 'field', type: FieldType = 'string'): Field {
    const field: Field = { id: id(), name, type };
    commit({
      ...state,
      datamodels: state.datamodels.map((m) =>
        m.id === modelId ? { ...m, fields: [...m.fields, field] } : m,
      ),
    });
    return field;
  },
  updateField(modelId: string, fieldId: string, patch: Partial<Field>) {
    commit({
      ...state,
      datamodels: state.datamodels.map((m) =>
        m.id === modelId
          ? {
              ...m,
              fields: m.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
            }
          : m,
      ),
    });
  },
  deleteField(modelId: string, fieldId: string) {
    commit({
      ...state,
      datamodels: state.datamodels.map((m) =>
        m.id === modelId
          ? {
              ...m,
              fields: m.fields.filter((f) => f.id !== fieldId),
              rows: m.rows.map((row) => {
                const next = { ...row };
                delete next[fieldId];
                return next;
              }),
            }
          : m,
      ),
    });
  },

  addRow(modelId: string): void {
    commit({
      ...state,
      datamodels: state.datamodels.map((m) =>
        m.id === modelId ? { ...m, rows: [...m.rows, {}] } : m,
      ),
    });
  },
  updateCell(modelId: string, rowIndex: number, fieldId: string, value: unknown): void {
    commit({
      ...state,
      datamodels: state.datamodels.map((m) =>
        m.id === modelId
          ? {
              ...m,
              rows: m.rows.map((row, i) =>
                i === rowIndex ? { ...row, [fieldId]: value } : row,
              ),
            }
          : m,
      ),
    });
  },
  deleteRow(modelId: string, rowIndex: number): void {
    commit({
      ...state,
      datamodels: state.datamodels.map((m) =>
        m.id === modelId ? { ...m, rows: m.rows.filter((_, i) => i !== rowIndex) } : m,
      ),
    });
  },

  // Append a row using field NAMES rather than ids. Fields not present on
  // the datamodel are silently dropped — the datamodel's schema is the
  // source of truth for what gets persisted.
  appendRowByFieldName(modelId: string, values: Record<string, unknown>): void {
    const model = state.datamodels.find((m) => m.id === modelId);
    if (!model) return;
    const row: Record<string, unknown> = {};
    for (const field of model.fields) {
      if (field.name in values) row[field.id] = values[field.name];
    }
    commit({
      ...state,
      datamodels: state.datamodels.map((m) =>
        m.id === modelId ? { ...m, rows: [...m.rows, row] } : m,
      ),
    });
  },
};

// Test helper — wipes persisted state. Used by e2e harness via window.__loopflow.
export function _resetForTests() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  state = emptyState();
  notify();
}
