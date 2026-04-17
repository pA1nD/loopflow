import { useEffect } from 'react';
import { actions, useAppState, useStorageSync, _resetForTests } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { CanvasView } from './views/CanvasView';
import { DatastoreView } from './views/DatastoreView';

declare global {
  interface Window {
    __loopflow?: {
      reset: () => void;
      getState: () => unknown;
    };
  }
}

export function App() {
  useStorageSync();
  const state = useAppState();

  // Test hook — only used by Playwright. Harmless in normal usage.
  useEffect(() => {
    window.__loopflow = {
      reset: _resetForTests,
      getState: () => JSON.parse(localStorage.getItem('loopflow:state:v1') ?? 'null'),
    };
  }, []);

  return (
    <div className="app">
      <header className="titlebar" data-testid="titlebar">
        <div className="titlebar-spacer" />
        <div className="titlebar-tabs">
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
        <div className="titlebar-spacer" />
      </header>
      <div className="body">
        <Sidebar state={state} />
        <main className="main">
          {state.view === 'canvas' ? <CanvasView state={state} /> : <DatastoreView state={state} />}
        </main>
      </div>
    </div>
  );
}
