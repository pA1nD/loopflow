import { actions } from '../lib/store';
import type { AppState } from '../lib/types';

interface Props {
  state: AppState;
}

export function Titlebar({ state }: Props) {
  const runsOpen = state.runsPanel;
  return (
    <header className="titlebar" data-testid="titlebar">
      <div className="titlebar-spacer" />
      <div className="titlebar-content" data-testid="titlebar-content">
        {state.view === 'canvas' ? <CanvasTitle state={state} /> : <DatastoreTitle state={state} />}
      </div>
      <div className="titlebar-actions">
        <button
          className={`titlebar-icon ${runsOpen ? 'active' : ''}`}
          onClick={() => actions.setRunsPanel(!runsOpen)}
          data-testid="runs-toggle"
          title="runs"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
          <span>runs</span>
        </button>
      </div>
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
