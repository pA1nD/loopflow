import { useEffect } from 'react';
import { actions, useAppState, useStorageSync, _resetForTests } from './lib/store';
import {
  runFromCard,
  tick,
  startScheduler,
  stopScheduler,
  _resetSchedulerState,
} from './lib/runtime';
import { Sidebar } from './components/Sidebar';
import { Titlebar } from './components/Titlebar';
import { Inspector } from './components/Inspector';
import { CanvasView } from './views/CanvasView';
import { DatastoreView } from './views/DatastoreView';
import { seedLast30DaysExample } from './lib/examples';

declare global {
  interface Window {
    __loopflow?: {
      reset: () => void;
      getState: () => unknown;
      runFromCard: (canvasId: string, cardId: string) => Promise<void>;
      tick: (now?: number) => Promise<void>;
      seedExample: (name?: 'last30days') => void;
    };
  }
}

export function App() {
  useStorageSync();
  const state = useAppState();

  // One-time setup: ensure system datamodels exist + run the scheduler while
  // the window is open. Also wire up the test hook for Playwright.
  useEffect(() => {
    actions.ensureSystemModels();
    startScheduler(1000);
    window.__loopflow = {
      reset: () => {
        _resetForTests();
        _resetSchedulerState();
        actions.ensureSystemModels();
      },
      getState: () => JSON.parse(localStorage.getItem('loopflow:state:v1') ?? 'null'),
      runFromCard: (canvasId, cardId) => runFromCard(canvasId, cardId),
      tick: (now) => tick(now),
      seedExample: (name = 'last30days') => {
        _resetForTests();
        _resetSchedulerState();
        actions.ensureSystemModels();
        if (name === 'last30days') seedLast30DaysExample();
      },
    };
    return () => stopScheduler();
  }, []);

  return (
    <div className="app">
      <Titlebar state={state} />
      <div className="body">
        <Sidebar state={state} />
        <main className="main">
          {state.view === 'canvas' ? <CanvasView state={state} /> : <DatastoreView state={state} />}
        </main>
        {state.view === 'canvas' && state.selectedCardId && <Inspector state={state} />}
      </div>
    </div>
  );
}
