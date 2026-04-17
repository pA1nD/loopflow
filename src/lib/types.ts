// Core JSON-backed model for the app.

// Open-ended string — the concrete options live in the action registry
// (src/lib/actions.ts). Kept as a type alias for readability.
export type CardKind = string;

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  body?: string;
  x: number;
  y: number;
  // Per-node action parameters. Shape is determined by the action type's
  // paramsSchema — validated at the edge (inspector) rather than at the type
  // level so new actions can ship without widening the Card interface.
  params?: Record<string, unknown>;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
}

export interface Canvas {
  id: string;
  name: string;
  cards: Card[];
  edges: Edge[];
}

export type FieldType = 'string' | 'number' | 'boolean' | 'date';

export interface Field {
  id: string;
  name: string;
  type: FieldType;
}

export interface Datamodel {
  id: string;
  name: string;
  fields: Field[];
  rows: Record<string, unknown>[];
  // System models are owned by the runtime (e.g. `runs`) and cannot be
  // deleted through the UI.
  isSystem?: boolean;
}

export interface AppState {
  canvases: Canvas[];
  activeCanvasId: string | null;
  datamodels: Datamodel[];
  activeDatamodelId: string | null;
  view: 'canvas' | 'datastore';
  selectedCardId: string | null;
}
