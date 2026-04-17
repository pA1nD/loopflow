// Core JSON-backed model for the app.

export type CardKind =
  | 'prompt'
  | 'llm'
  | 'tool'
  | 'output'
  | 'note';

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  body?: string;
  x: number;
  y: number;
}

export interface Edge {
  id: string;
  from: string; // source card id
  to: string;   // target card id
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
  rows: Record<string, unknown>[]; // each row keyed by field id
}

export interface AppState {
  canvases: Canvas[];
  activeCanvasId: string | null;
  datamodels: Datamodel[];
  activeDatamodelId: string | null;
  view: 'canvas' | 'datastore';
}
