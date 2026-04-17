import { useCallback, useEffect, useRef, useState } from 'react';
import { actions } from '../lib/store';
import type { AppState, Canvas, Card, CardKind } from '../lib/types';

interface Props {
  state: AppState;
}

const CARD_W = 180;
const CARD_H = 76;

const KIND_LABELS: Record<CardKind, string> = {
  prompt: 'prompt',
  llm: 'llm',
  tool: 'tool',
  output: 'output',
  note: 'note',
};

export function CanvasView({ state }: Props) {
  const canvas = state.canvases.find((c) => c.id === state.activeCanvasId);
  if (!canvas) {
    return (
      <div className="placeholder" data-testid="canvas-placeholder">
        <div className="placeholder-inner">
          <h2>no canvas selected</h2>
          <button
            className="primary"
            onClick={() => actions.createCanvas()}
            data-testid="create-first-canvas"
          >
            create a canvas
          </button>
        </div>
      </div>
    );
  }
  return <CanvasStage canvas={canvas} />;
}

interface DragState {
  cardId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

interface ConnectState {
  fromCardId: string;
  cursorX: number;
  cursorY: number;
}

function CanvasStage({ canvas }: { canvas: Canvas }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  const cardById = useCallback(
    (id: string) => canvas.cards.find((c) => c.id === id),
    [canvas.cards],
  );

  // Cursor tracking when dragging or connecting.
  useEffect(() => {
    if (!drag && !connect) return;
    const stage = stageRef.current;
    if (!stage) return;

    const onMove = (e: MouseEvent) => {
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (drag) {
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        actions.updateCard(canvas.id, drag.cardId, {
          x: Math.max(0, drag.originX + dx),
          y: Math.max(0, drag.originY + dy),
        });
      } else if (connect) {
        setConnect({ ...connect, cursorX: x, cursorY: y });
      }
    };

    const onUp = (e: MouseEvent) => {
      if (connect) {
        // Look for a card under the cursor (other than source).
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const cardEl = el?.closest('[data-card-id]') as HTMLElement | null;
        const targetId = cardEl?.dataset.cardId;
        if (targetId && targetId !== connect.fromCardId) {
          actions.addEdge(canvas.id, connect.fromCardId, targetId);
        }
        setConnect(null);
      }
      setDrag(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, connect, canvas.id]);

  // Delete selected edge with backspace/delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedEdge) {
        actions.deleteEdge(canvas.id, selectedEdge);
        setSelectedEdge(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedEdge, canvas.id]);

  const startDrag = (card: Card, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setDrag({
      cardId: card.id,
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      originX: card.x,
      originY: card.y,
    });
    setSelectedEdge(null);
  };

  const startConnect = (card: Card, e: React.MouseEvent) => {
    e.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setConnect({
      fromCardId: card.id,
      cursorX: e.clientX - rect.left,
      cursorY: e.clientY - rect.top,
    });
  };

  const addCard = () => {
    // Place new card with slight offset from the last so they don't stack invisibly.
    const last = canvas.cards[canvas.cards.length - 1];
    const x = last ? last.x + 40 : 120;
    const y = last ? last.y + 40 : 120;
    actions.addCard(canvas.id, { x, y });
  };

  return (
    <div className="canvas-area" data-testid="canvas-area">
      <div className="canvas-header">
        <input
          className="canvas-name"
          value={canvas.name}
          onChange={(e) => actions.renameCanvas(canvas.id, e.target.value)}
          data-testid="canvas-name"
        />
        <div className="canvas-actions">
          <button className="ghost" onClick={addCard} data-testid="add-card">
            + card
          </button>
          <span className="canvas-meta">
            {canvas.cards.length} cards · {canvas.edges.length} edges
          </span>
        </div>
      </div>
      <div
        className="canvas-stage"
        ref={stageRef}
        data-testid="canvas-stage"
        onMouseDown={() => setSelectedEdge(null)}
      >
        <svg className="canvas-svg">
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#8a8a8e" />
            </marker>
            <marker
              id="arrow-active"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#1c1c1e" />
            </marker>
          </defs>
          {canvas.edges.map((edge) => {
            const from = cardById(edge.from);
            const to = cardById(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + CARD_W;
            const y1 = from.y + CARD_H / 2;
            const x2 = to.x;
            const y2 = to.y + CARD_H / 2;
            const path = bezier(x1, y1, x2, y2);
            const active = selectedEdge === edge.id;
            return (
              <g
                key={edge.id}
                className="edge-group"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEdge(edge.id);
                }}
                data-testid={`edge-${edge.id}`}
                data-edge-from={edge.from}
                data-edge-to={edge.to}
              >
                <path className="edge-hit" d={path} />
                <path
                  className={`edge ${active ? 'active' : ''}`}
                  d={path}
                  markerEnd={active ? 'url(#arrow-active)' : 'url(#arrow)'}
                />
              </g>
            );
          })}
          {connect &&
            (() => {
              const from = cardById(connect.fromCardId);
              if (!from) return null;
              const x1 = from.x + CARD_W;
              const y1 = from.y + CARD_H / 2;
              return (
                <path
                  className="edge edge-preview"
                  d={bezier(x1, y1, connect.cursorX, connect.cursorY)}
                />
              );
            })()}
        </svg>
        {canvas.cards.map((card) => (
          <div
            key={card.id}
            className="card"
            data-card-id={card.id}
            data-testid={`card-${card.id}`}
            style={{
              transform: `translate(${card.x}px, ${card.y}px)`,
              width: CARD_W,
              height: CARD_H,
            }}
            onMouseDown={(e) => startDrag(card, e)}
          >
            <div className="card-port card-port-in" />
            <div className="card-header">
              <select
                className="card-kind"
                value={card.kind}
                data-no-drag
                onChange={(e) =>
                  actions.updateCard(canvas.id, card.id, {
                    kind: e.target.value as CardKind,
                  })
                }
                onMouseDown={(e) => e.stopPropagation()}
              >
                {Object.entries(KIND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                className="card-delete"
                data-no-drag
                title="delete card"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.deleteCard(canvas.id, card.id);
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                ×
              </button>
            </div>
            <input
              className="card-title"
              value={card.title}
              data-no-drag
              data-testid={`card-title-${card.id}`}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                actions.updateCard(canvas.id, card.id, { title: e.target.value })
              }
            />
            <div
              className="card-port card-port-out"
              data-no-drag
              title="drag to connect"
              data-testid={`card-port-${card.id}`}
              onMouseDown={(e) => startConnect(card, e)}
            />
          </div>
        ))}
        {canvas.cards.length === 0 && (
          <div className="canvas-hint">click <kbd>+ card</kbd> to add your first node</div>
        )}
      </div>
    </div>
  );
}

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
