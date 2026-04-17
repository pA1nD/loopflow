import { useSyncExternalStore } from 'react';
import { actions } from '../lib/store';
import { pluralize } from '../lib/format';
import { isCardRunning, subscribeRuntime, getRuntimeVersion } from '../lib/runtime';
import type { AppState } from '../lib/types';

interface Props {
  state: AppState;
}

export function Titlebar({ state }: Props) {
  const runsOpen = state.runsPanel;
  const termOpen = state.terminalPanel;
  useSyncExternalStore(subscribeRuntime, getRuntimeVersion, getRuntimeVersion);
  const anyRunning = state.canvases.some((c) => c.cards.some((card) => isCardRunning(card.id)));
  return (
    <header className="titlebar" data-testid="titlebar">
      <div className="titlebar-spacer" />
      <div className="titlebar-content" data-testid="titlebar-content">
        {state.view === 'canvas' ? <CanvasTitle state={state} /> : <DatastoreTitle state={state} />}
      </div>
      <div className="titlebar-actions">
        <button
          className={`titlebar-icon ${termOpen ? 'active' : ''} ${anyRunning ? 'running' : ''}`}
          onClick={() => actions.setTerminalPanel(!termOpen)}
          data-testid="terminal-toggle"
          title={anyRunning ? 'terminal — a card is running' : 'terminal'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span>terminal</span>
          {anyRunning && <span className="titlebar-running-dot" />}
        </button>
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
        {pluralize(canvas.cards.length, 'card')} · {pluralize(canvas.edges.length, 'edge')}
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
        {pluralize(model.fields.length, 'field')} · {pluralize(model.rows.length, 'row')}
      </span>
    </>
  );
}
