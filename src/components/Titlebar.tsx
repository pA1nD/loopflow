import { actions } from '../lib/store';
import type { AppState } from '../lib/types';

interface Props {
  state: AppState;
}

export function Titlebar({ state }: Props) {
  return (
    <header className="titlebar" data-testid="titlebar">
      <div className="titlebar-spacer" />
      <div className="titlebar-content" data-testid="titlebar-content">
        {state.view === 'canvas' ? <CanvasTitle state={state} /> : <DatastoreTitle state={state} />}
      </div>
      <div className="titlebar-spacer" />
    </header>
  );
}

function CanvasTitle({ state }: Props) {
  const canvas = state.canvases.find((c) => c.id === state.activeCanvasId);
  if (!canvas) {
    return <span className="titlebar-empty">no canvas</span>;
  }
  return (
    <>
      <input
        className="titlebar-name"
        value={canvas.name}
        onChange={(e) => actions.renameCanvas(canvas.id, e.target.value)}
        data-testid="canvas-name"
      />
      <span className="titlebar-meta" data-testid="canvas-meta">
        {canvas.cards.length} cards · {canvas.edges.length} edges
      </span>
    </>
  );
}

function DatastoreTitle({ state }: Props) {
  const model = state.datamodels.find((m) => m.id === state.activeDatamodelId);
  if (!model) {
    return <span className="titlebar-empty">no data model</span>;
  }
  return (
    <>
      <input
        className="titlebar-name"
        value={model.name}
        onChange={(e) => actions.renameDatamodel(model.id, e.target.value)}
        data-testid="datamodel-name"
      />
      <span className="titlebar-meta" data-testid="datamodel-meta">
        {model.fields.length} fields · {model.rows.length} rows
      </span>
    </>
  );
}
