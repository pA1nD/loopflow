import { actions } from '../lib/store';
import type { AppState } from '../lib/types';

interface Props {
  state: AppState;
}

export function Sidebar({ state }: Props) {
  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="view-toggle" role="tablist">
        <button
          className={`tab ${state.view === 'canvas' ? 'active' : ''}`}
          onClick={() => actions.setView('canvas')}
          data-testid="nav-canvas"
        >
          canvas
        </button>
        <button
          className={`tab ${state.view === 'datastore' ? 'active' : ''}`}
          onClick={() => actions.setView('datastore')}
          data-testid="nav-datastore"
        >
          data
        </button>
      </div>
      {state.view === 'canvas' ? <CanvasList state={state} /> : <DatastoreList state={state} />}
    </aside>
  );
}

function CanvasList({ state }: Props) {
  return (
    <div className="sidebar-section" data-testid="sidebar-canvas">
      <div className="sidebar-header">
        <span className="sidebar-title">canvases</span>
        <button
          className="icon-btn"
          title="new canvas"
          onClick={() => actions.createCanvas()}
          data-testid="new-canvas"
        >
          +
        </button>
      </div>
      <ul className="sidebar-list">
        {state.canvases.length === 0 && <li className="sidebar-empty">no canvases yet</li>}
        {state.canvases.map((c) => (
          <li
            key={c.id}
            className={`sidebar-item ${c.id === state.activeCanvasId ? 'active' : ''}`}
            onClick={() => actions.selectCanvas(c.id)}
            data-testid={`canvas-item-${c.id}`}
          >
            <span className="dot" />
            <span className="sidebar-item-name">{c.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DatastoreList({ state }: Props) {
  return (
    <div className="sidebar-section" data-testid="sidebar-datastore">
      <div className="sidebar-header">
        <span className="sidebar-title">data models</span>
        <button
          className="icon-btn"
          title="new datamodel"
          onClick={() => actions.createDatamodel()}
          data-testid="new-datamodel"
        >
          +
        </button>
      </div>
      <ul className="sidebar-list">
        {state.datamodels.length === 0 && <li className="sidebar-empty">no models yet</li>}
        {state.datamodels.map((m) => (
          <li
            key={m.id}
            className={`sidebar-item ${m.id === state.activeDatamodelId ? 'active' : ''}`}
            onClick={() => actions.selectDatamodel(m.id)}
            data-testid={`datamodel-item-${m.id}`}
          >
            <span className="dot" />
            <span className="sidebar-item-name">{m.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
