import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actions, RUNS_MODEL_NAME } from '../lib/store';
import { getAction } from '../lib/actions';
import type { AppState, Canvas, Card } from '../lib/types';

interface Props {
  state: AppState;
}

const CARD_W = 180;
const CARD_H = 88;
const GRID = 24;
const GAP = 48;
const ROW_GAP = 24;
const MIN_CONTENT_W = 2400;
const MIN_CONTENT_H = 1400;
const PAD = 400;

const snap = (v: number) => Math.round(v / GRID) * GRID;

function findOpenSlot(
  cards: Card[],
  anchorX: number,
  anchorY: number,
  maxX: number,
): { x: number; y: number } {
  const step = CARD_W + GAP;
  const rowStep = CARD_H + ROW_GAP;
  const collides = (x: number, y: number) =>
    cards.some(
      (c) =>
        x < c.x + CARD_W &&
        x + CARD_W > c.x &&
        y < c.y + CARD_H &&
        y + CARD_H > c.y,
    );
  for (let row = 0; row < 20; row++) {
    const y = snap(anchorY + row * rowStep);
    for (let col = 0; col < 20; col++) {
      const x = snap(anchorX + col * step);
      if (x + CARD_W > maxX - 16 && col > 0) break;
      if (!collides(x, y)) return { x, y };
    }
  }
  return { x: snap(anchorX), y: snap(anchorY + 20 * rowStep) };
}

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
  return <CanvasStage canvas={canvas} state={state} />;
}

interface DragState {
  cardId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface ConnectState {
  fromCardId: string;
  cursorX: number;
  cursorY: number;
}

function CanvasStage({ canvas, state }: { canvas: Canvas; state: AppState }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  const cardById = useCallback(
    (id: string) => canvas.cards.find((c) => c.id === id),
    [canvas.cards],
  );

  // Latest-run map (cardId -> { status, durationMs }) derived from the
  // system runs datamodel. Used to color the card's status dot.
  const lastRunByCard = useMemo(() => {
    const runs = state.datamodels.find((m) => m.isSystem && m.name === RUNS_MODEL_NAME);
    if (!runs) return new Map<string, string>();
    const cardIdField = runs.fields.find((f) => f.name === 'cardId')?.id;
    const statusField = runs.fields.find((f) => f.name === 'status')?.id;
    if (!cardIdField || !statusField) return new Map();
    const map = new Map<string, string>();
    for (const row of runs.rows) {
      map.set(String(row[cardIdField]), String(row[statusField]));
    }
    return map;
  }, [state.datamodels]);

  const extent = useMemo(() => {
    const maxX = canvas.cards.reduce((m, c) => Math.max(m, c.x + CARD_W), 0);
    const maxY = canvas.cards.reduce((m, c) => Math.max(m, c.y + CARD_H), 0);
    return {
      width: Math.max(MIN_CONTENT_W, maxX + PAD),
      height: Math.max(MIN_CONTENT_H, maxY + PAD),
    };
  }, [canvas.cards]);

  useEffect(() => {
    if (!drag && !connect) return;
    const content = contentRef.current;
    if (!content) return;
    const onMove = (e: MouseEvent) => {
      const rect = content.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (drag) {
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return; // click, not drag
        actions.updateCard(canvas.id, drag.cardId, {
          x: Math.max(0, snap(drag.originX + dx)),
          y: Math.max(0, snap(drag.originY + dy)),
        });
        if (!drag.moved) setDrag({ ...drag, moved: true });
      } else if (connect) {
        setConnect({ ...connect, cursorX: x, cursorY: y });
      }
    };
    const onUp = (e: MouseEvent) => {
      if (drag && !drag.moved) {
        // pure click — select the card (already selected on mousedown) and do nothing else
      }
      if (connect) {
        const rect = content.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const cardEl = el?.closest('[data-card-id]') as HTMLElement | null;
        const targetId = cardEl?.dataset.cardId;
        if (targetId && targetId !== connect.fromCardId) {
          actions.addEdge(canvas.id, connect.fromCardId, targetId);
        } else if (!targetId) {
          const desiredX = snap(localX - CARD_W / 2);
          const desiredY = snap(localY - CARD_H / 2);
          const slot = findOpenSlot(canvas.cards, desiredX, desiredY, rect.width);
          const placeX =
            Math.abs(slot.x - desiredX) + Math.abs(slot.y - desiredY) < GRID * 3
              ? desiredX
              : slot.x;
          const placeY =
            Math.abs(slot.x - desiredX) + Math.abs(slot.y - desiredY) < GRID * 3
              ? desiredY
              : slot.y;
          const newCard = actions.addCard(canvas.id, {
            x: Math.max(0, placeX),
            y: Math.max(0, placeY),
            kind: 'prompt',
          });
          actions.addEdge(canvas.id, connect.fromCardId, newCard.id);
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
  }, [drag, connect, canvas.id, canvas.cards]);

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

  const selectCard = (cardId: string) => {
    actions.setSelectedCard(cardId);
    setSelectedEdge(null);
  };

  const startDrag = (card: Card, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    const content = contentRef.current;
    if (!content) return;
    const rect = content.getBoundingClientRect();
    setDrag({
      cardId: card.id,
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      originX: card.x,
      originY: card.y,
      moved: false,
    });
  };

  const startConnect = (card: Card, e: React.MouseEvent) => {
    e.stopPropagation();
    const content = contentRef.current;
    if (!content) return;
    const rect = content.getBoundingClientRect();
    setConnect({
      fromCardId: card.id,
      cursorX: e.clientX - rect.left,
      cursorY: e.clientY - rect.top,
    });
  };

  const addCard = () => {
    const scroll = scrollRef.current;
    const scrollX = scroll?.scrollLeft ?? 0;
    const scrollY = scroll?.scrollTop ?? 0;
    const anchorX =
      canvas.cards.length === 0 ? snap(scrollX + 80) : Math.min(...canvas.cards.map((c) => c.x));
    const anchorY =
      canvas.cards.length === 0 ? snap(scrollY + 80) : Math.min(...canvas.cards.map((c) => c.y));
    const slot = findOpenSlot(canvas.cards, anchorX, anchorY, extent.width);
    const newCard = actions.addCard(canvas.id, slot);
    actions.setSelectedCard(newCard.id);
  };

  return (
    <div
      className={`canvas-scroll ${connect ? 'is-connecting' : ''}`}
      ref={scrollRef}
      data-testid="canvas-stage"
      onMouseDown={(e) => {
        if (e.target === scrollRef.current || e.target === contentRef.current) {
          actions.setSelectedCard(null);
          setSelectedEdge(null);
        }
      }}
    >
      <div
        className="canvas-content"
        ref={contentRef}
        style={{ width: extent.width, height: extent.height }}
        data-testid="canvas-content"
      >
        <svg
          className="canvas-svg"
          width={extent.width}
          height={extent.height}
          viewBox={`0 0 ${extent.width} ${extent.height}`}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#8a8a8e" />
            </marker>
            <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
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
                <g>
                  <path
                    className="edge edge-preview"
                    d={bezier(x1, y1, connect.cursorX, connect.cursorY)}
                  />
                  <circle className="ghost-card" cx={connect.cursorX} cy={connect.cursorY} r={6} />
                </g>
              );
            })()}
        </svg>
        {canvas.cards.map((card) => {
          const action = getAction(card.kind);
          const selected = state.selectedCardId === card.id;
          const status = lastRunByCard.get(card.id) ?? '';
          return (
            <div
              key={card.id}
              className={`card ${selected ? 'selected' : ''} card-category-${action?.category ?? 'label'}`}
              data-card-id={card.id}
              data-testid={`card-${card.id}`}
              style={{
                transform: `translate(${card.x}px, ${card.y}px)`,
                width: CARD_W,
                height: CARD_H,
              }}
              // Capture phase fires before any descendant onMouseDown, so
              // clicking a form element inside the card still selects it
              // even though the input stops propagation for drag avoidance.
              onMouseDownCapture={() => selectCard(card.id)}
              onMouseDown={(e) => startDrag(card, e)}
            >
              <div className="card-port card-port-in" />
              <div className="card-header">
                <span className="card-kind-label" data-testid={`card-kind-${card.id}`}>
                  {action?.label ?? card.kind}
                </span>
                {status && <span className={`card-status card-status-${status}`} title={`last run: ${status}`} />}
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
              <CardSummary card={card} state={state} />
              <div
                className="card-port card-port-out"
                data-no-drag
                title="drag to connect or drop on empty canvas to spawn a new card"
                data-testid={`card-port-${card.id}`}
                onMouseDown={(e) => startConnect(card, e)}
              />
            </div>
          );
        })}
      </div>
      <button
        className="stage-fab"
        onClick={addCard}
        data-testid="add-card"
        title="add card"
      >
        + card
      </button>
      {canvas.cards.length === 0 && (
        <div className="canvas-hint">
          click <kbd>+ card</kbd> to add your first node
        </div>
      )}
    </div>
  );
}

function CardSummary({ card, state }: { card: Card; state: AppState }) {
  const action = getAction(card.kind);
  if (!action?.params?.length) return null;
  // Render one compact param preview — whichever non-empty param is most
  // identifying. Keeps the card readable at a glance.
  const preview = action.params
    .map((p) => {
      const raw = card.params?.[p.name];
      if (raw === undefined || raw === null || raw === '') return null;
      if (p.type === 'datamodel') {
        const m = state.datamodels.find((d) => d.id === raw);
        return m ? `→ ${m.name}` : null;
      }
      if (p.type === 'boolean') return raw ? p.label ?? p.name : null;
      return `${p.label ?? p.name}: ${String(raw)}`;
    })
    .find(Boolean);
  if (!preview) return null;
  return (
    <div className="card-summary" data-testid={`card-summary-${card.id}`}>
      {preview}
    </div>
  );
}

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
