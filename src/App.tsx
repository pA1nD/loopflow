import { useEffect } from 'react';
import { actions, useAppState, useStorageSync, _resetForTests } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { Titlebar } from './components/Titlebar';
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

  useEffect(() => {
    window.__loopflow = {
      reset: _resetForTests,
      getState: () => JSON.parse(localStorage.getItem('loopflow:state:v1') ?? 'null'),
    };
  }, []);

  return (
    <div className="app">
      <Titlebar state={state} />
      <div className="body">
        <Sidebar state={state} />
        <main className="main">
          {state.view === 'canvas' ? <CanvasView state={state} /> : <DatastoreView state={state} />}
        </main>
      </div>
    </div>
  );
}

export { actions };
