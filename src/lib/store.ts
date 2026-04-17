import { useEffect, useSyncExternalStore } from 'react';
import type { AppState, Canvas, Card, Datamodel, Edge, Field, FieldType } from './types';

const STORAGE_KEY = 'loopflow:state:v1';

function emptyState(): AppState {
  return {
    canvases: [],
    activeCanvasId: null,
    datamodels: [],
    activeDatamodelId: null,
    view: 'canvas',
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

export function useStorageSync() {
  // Re-load if another window/tab modifies storage (Electron typically single-window, defensive).
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

export const actions = {
  setView(view: AppState['view']) {
    commit({ ...state, view });
  },

  // Canvas
  createCanvas(name = 'untitled flow'): Canvas {
    const canvas: Canvas = { id: id(), name, cards: [], edges: [] };
    commit({
      ...state,
      canvases: [...state.canvases, canvas],
      activeCanvasId: canvas.id,
      view: 'canvas',
    });
    return canvas;
  },
  selectCanvas(canvasId: string) {
    commit({ ...state, activeCanvasId: canvasId, view: 'canvas' });
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
  deleteCard(canvasId: string, cardId: string) {
    commit({
      ...state,
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
