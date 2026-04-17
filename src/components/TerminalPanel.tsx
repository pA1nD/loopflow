import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { actions } from '../lib/store';
import type { AppState } from '../lib/types';

interface Props {
  state: AppState;
}

export function TerminalPanel({ state }: Props) {
  const canvasId = state.activeCanvasId;
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canvasId) return;

    const term = new Terminal({
      fontFamily:
        "'Cascadia Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
      scrollback: 5000,
      theme: {
        background: '#fbfaf7',
        foreground: '#1c1c1e',
        cursor: '#1c1c1e',
        cursorAccent: '#fbfaf7',
        selectionBackground: '#d9e0ef',
        black: '#1c1c1e',
        red: '#c0392b',
        green: '#4fa04f',
        yellow: '#b58b00',
        blue: '#3b6ab3',
        magenta: '#9b4dca',
        cyan: '#3b8a8a',
        white: '#e6e4df',
        brightBlack: '#8b857d',
        brightRed: '#d04848',
        brightGreen: '#5fb85f',
        brightYellow: '#c49b1b',
        brightBlue: '#4d7fc8',
        brightMagenta: '#b060d8',
        brightCyan: '#4ba0a0',
        brightWhite: '#ffffff',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const bridge = window.loopflow?.terminal;
    let offData: (() => void) | undefined;
    let offClear: (() => void) | undefined;

    if (bridge) {
      bridge.getBuffer(canvasId).then((buf) => {
        if (buf) term.write(buf);
      });
      offData = bridge.onData((p) => {
        if (p.id === canvasId) term.write(p.chunk);
      });
      offClear = bridge.onClear((p) => {
        if (p.id === canvasId) term.clear();
      });
    }

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* host removed */
      }
    });
    ro.observe(host);

    return () => {
      offData?.();
      offClear?.();
      ro.disconnect();
      term.dispose();
    };
  }, [canvasId]);

  return (
    <aside className="terminal-panel" data-testid="terminal-panel">
      <div className="terminal-panel-header">
        <span className="inspector-label">terminal</span>
        <div className="terminal-panel-actions">
          <button
            className="icon-btn"
            title="clear"
            onClick={() => {
              if (canvasId) window.loopflow?.terminal?.clear(canvasId);
            }}
            data-testid="terminal-clear"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
          <button
            className="icon-btn"
            title="close"
            onClick={() => actions.setTerminalPanel(false)}
            data-testid="terminal-close"
          >
            ×
          </button>
        </div>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </aside>
  );
}
