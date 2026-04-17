import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { actions, RUNS_MODEL_NAME } from '../lib/store';
import { getAction } from '../lib/actions';
import {
  isCardRunning,
  getLastFiredAt,
  subscribeRuntime,
  getRuntimeVersion,
} from '../lib/runtime';
import { formatCountdown, formatInterval } from '../lib/format';
import type { AppState, Canvas, Card } from '../lib/types';

interface Props {
  state: AppState;
}

const CARD_W = 220;
const CARD_H = 92;
const GRID = 24;
const GAP = 48;
const ROW_GAP = 24;
const MIN_CONTENT_W = 2400;
const MIN_CONTENT_H = 1400;
const PAD = 400;
// Pixel offset of the port dot centers, measured from each card corner.
// Kept in sync with `.card-port` positioning in styles.css.
const PORT_Y = 46;
const PORT_OUT_DX = 1;
const PORT_IN_DX = -1;

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

  // Latest-run map (cardId -> { status, startedAtMs }) derived from the
  // system runs datamodel. Used to color the card's status dot and briefly
  // pulse it when a run finished moments ago.
  const lastRunByCard = useMemo(() => {
    const runs = state.datamodels.find((m) => m.isSystem && m.name === RUNS_MODEL_NAME);
    if (!runs) return new Map<string, { status: string; startedAt: number }>();
    const cardIdField = runs.fields.find((f) => f.name === 'cardId')?.id;
    const statusField = runs.fields.find((f) => f.name === 'status')?.id;
    const startedAtField = runs.fields.find((f) => f.name === 'startedAt')?.id;
    if (!cardIdField || !statusField) return new Map();
    const map = new Map<string, { status: string; startedAt: number }>();
    for (const row of runs.rows) {
      const id = String(row[cardIdField]);
      const status = String(row[statusField]);
      const ts = startedAtField ? Date.parse(String(row[startedAtField])) : 0;
      map.set(id, { status, startedAt: Number.isFinite(ts) ? ts : 0 });
    }
    return map;
  }, [state.datamodels]);

  // Wall-clock tick so countdowns and "just ran" pulses refresh naturally.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // Subscribe to runtime (running set, scheduler lastFiredAt updates).
  useSyncExternalStore(subscribeRuntime, getRuntimeVersion, getRuntimeVersion);

  const extent = useMemo(() => {
    const maxX = canvas.cards.reduce((m, c) => Math.max(m, c.x + CARD_W), 0);
    const maxY = canvas.cards.reduce((m, c) => Math.max(m, c.y + CARD_H), 0);
    return {
      width: Math.max(MIN_CONTENT_W, maxX + PAD),
      height: Math.max(MIN_CONTENT_H, maxY + PAD),
    };
  }, [canvas.cards]);

  // Card drag (move cards around).
  useEffect(() => {
    if (!drag) return;
    const content = contentRef.current;
    if (!content) return;
    const onMove = (e: MouseEvent) => {
      const rect = content.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return; // click, not drag
      actions.updateCard(canvas.id, drag.cardId, {
        x: Math.max(0, snap(drag.originX + dx)),
        y: Math.max(0, snap(drag.originY + dy)),
      });
      if (!drag.moved) setDrag({ ...drag, moved: true });
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, canvas.id]);

  // Click-to-place connection: clicking a port enters "placing" mode (a
  // ghost card follows the cursor); the next click either connects to a
  // target card, drops a new llm card on empty canvas, or cancels if it
  // lands on the source card.
  useEffect(() => {
    if (!connect) return;
    const content = contentRef.current;
    if (!content) return;
    const onMove = (e: MouseEvent) => {
      const rect = content.getBoundingClientRect();
      setConnect((prev) =>
        prev ? { ...prev, cursorX: e.clientX - rect.left, cursorY: e.clientY - rect.top } : prev,
      );
    };
    const onClick = (e: MouseEvent) => {
      const rect = content.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cardEl = el?.closest('[data-card-id]') as HTMLElement | null;
      const targetId = cardEl?.dataset.cardId;
      if (targetId === connect.fromCardId) {
        setConnect(null);
        return;
      }
      if (targetId) {
        actions.addEdge(canvas.id, connect.fromCardId, targetId);
      } else {
        const desiredX = snap(localX - CARD_W / 2);
        const desiredY = snap(localY - CARD_H / 2);
        const slot = findOpenSlot(canvas.cards, desiredX, desiredY, rect.width);
        const close = Math.abs(slot.x - desiredX) + Math.abs(slot.y - desiredY) < GRID * 3;
        const placeX = close ? desiredX : slot.x;
        const placeY = close ? desiredY : slot.y;
        const newCard = actions.addCard(canvas.id, {
          x: Math.max(0, placeX),
          y: Math.max(0, placeY),
          kind: 'llm',
        });
        actions.addEdge(canvas.id, connect.fromCardId, newCard.id);
        actions.setSelectedCard(newCard.id);
      }
      setConnect(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConnect(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKey);
    // Defer the click listener past the current event loop tick so the
    // click that FINISHES the opening mousedown (which is how placing mode
    // is entered) does not immediately resolve it.
    let clickAttached = false;
    const attachDelay = setTimeout(() => {
      window.addEventListener('click', onClick);
      clickAttached = true;
    }, 0);
    return () => {
      clearTimeout(attachDelay);
      if (clickAttached) window.removeEventListener('click', onClick);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [connect, canvas.id, canvas.cards]);

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
    if (connect) return; // in placing mode the click should resolve, not drag
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
    const content = contentRef.current;
    if (!content) return;
    const rect = content.getBoundingClientRect();
    setConnect({
      fromCardId: card.id,
      cursorX: e.clientX - rect.left,
      cursorY: e.clientY - rect.top,
    });
  };

  const addCardOfKind = (kind: string, defaults: Record<string, unknown> = {}) => {
    const scroll = scrollRef.current;
    const scrollX = scroll?.scrollLeft ?? 0;
    const scrollY = scroll?.scrollTop ?? 0;
    const anchorX =
      canvas.cards.length === 0 ? snap(scrollX + 80) : Math.min(...canvas.cards.map((c) => c.x));
    const anchorY =
      canvas.cards.length === 0 ? snap(scrollY + 80) : Math.min(...canvas.cards.map((c) => c.y));
    const slot = findOpenSlot(canvas.cards, anchorX, anchorY, extent.width);
    const newCard = actions.addCard(canvas.id, {
      ...slot,
      kind,
      params: defaults,
    });
    actions.setSelectedCard(newCard.id);
  };

  return (
    <div className="canvas-area">
      <nav className="canvas-toolbar" data-testid="canvas-toolbar">
        <button
          className="toolbar-btn"
          onClick={() =>
            addCardOfKind('interval-trigger', { intervalSeconds: 3600, enabled: false })
          }
          data-testid="add-trigger"
          title="add trigger"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
          <span>trigger</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={() => addCardOfKind('llm')}
          data-testid="add-llm"
          title="add llm action"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 8h10" /><path d="M7 12h10" /><path d="M7 16h6" />
            <rect x="3" y="4" width="18" height="16" rx="3" />
          </svg>
          <span>llm</span>
        </button>
        <span className="toolbar-divider" />
        <button
          className="toolbar-btn"
          disabled
          data-testid="add-loop"
          title="loop — coming soon"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 2l4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="M7 22l-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
          </svg>
          <span>loop</span>
        </button>
        <button
          className="toolbar-btn"
          disabled
          data-testid="add-script"
          title="script — coming soon"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span>script</span>
        </button>
        <button
          className="toolbar-btn"
          disabled
          data-testid="add-docker"
          title="docker — coming soon"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="11" width="4" height="4" />
            <rect x="7" y="11" width="4" height="4" />
            <rect x="12" y="11" width="4" height="4" />
            <rect x="7" y="6" width="4" height="4" />
            <path d="M2 16c0 3 2 5 7 5h3c5 0 8-2 9-6" />
          </svg>
          <span>docker</span>
        </button>
      </nav>
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
            const x1 = from.x + CARD_W + PORT_OUT_DX;
            const y1 = from.y + PORT_Y;
            const x2 = to.x + PORT_IN_DX;
            const y2 = to.y + PORT_Y;
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
              const x1 = from.x + CARD_W + PORT_OUT_DX;
              const y1 = from.y + PORT_Y;
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
          const recent = lastRunByCard.get(card.id);
          const status = recent?.status ?? '';
          const justRan = !!recent && now - recent.startedAt < 3000;
          const running = isCardRunning(card.id);
          const isTrigger = card.kind === 'interval-trigger';
          return (
            <div
              key={card.id}
              className={`card ${selected ? 'selected' : ''} card-category-${action?.category ?? 'action'} ${running ? 'card-running' : ''}`}
              data-card-id={card.id}
              data-testid={`card-${card.id}`}
              style={{
                transform: `translate(${card.x}px, ${card.y}px)`,
                width: CARD_W,
                minHeight: CARD_H,
              }}
              onMouseDownCapture={() => selectCard(card.id)}
              onMouseDown={(e) => startDrag(card, e)}
            >
              {running && (
                <div className="card-running-badge" data-testid={`card-running-${card.id}`}>
                  <span className="running-spinner" />
                  <span>running</span>
                </div>
              )}
              <div className="card-port card-port-in" />
              <div className="card-header">
                <span className="card-kind-label" data-testid={`card-kind-${card.id}`}>
                  {action?.label ?? card.kind}
                </span>
                {status && !running && (
                  <span
                    className={`card-status card-status-${status} ${justRan ? 'card-status-pulse' : ''}`}
                    title={`last run: ${status}`}
                  />
                )}
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
              {isTrigger && (
                <TriggerRuntimePatch canvas={canvas} card={card} now={now} />
              )}
              <div
                className="card-port card-port-out"
                data-no-drag
                title="click to place a connected card"
                data-testid={`card-port-${card.id}`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  // mousedown (not click) because the port is small (10px)
                  // and a real mouse can drift a pixel between down/up, which
                  // fires click on the surrounding card instead of the port.
                  startConnect(card, e);
                }}
              />
            </div>
          );
        })}
      </div>
        {canvas.cards.length === 0 && (
          <div className="canvas-hint" data-testid="canvas-hint">
            <div className="canvas-hint-arrow">↑</div>
            <div className="canvas-hint-title">empty canvas</div>
            <div className="canvas-hint-body">
              pick a <kbd>trigger</kbd> or <kbd>llm</kbd> from the toolbar
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CardSummary({ card, state }: { card: Card; state: AppState }) {
  const action = getAction(card.kind);
  if (!action?.params?.length) return null;
  // Trigger cards get a more human summary in the main card body — the
  // runtime patch below handles the live countdown/toggle.
  if (card.kind === 'interval-trigger') {
    const sec = Number(card.params?.intervalSeconds ?? 0);
    if (!sec) return null;
    return (
      <div className="card-summary" data-testid={`card-summary-${card.id}`}>
        {formatInterval(sec)}
      </div>
    );
  }
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

// Runtime patch for interval-trigger cards: a visual "live" strip at the
// bottom of the card showing the on/off toggle and the countdown to the
// next fire. Styled distinctly from the configuration-y body above.
function TriggerRuntimePatch({
  canvas,
  card,
  now,
}: {
  canvas: Canvas;
  card: Card;
  now: number;
}) {
  const enabled = Boolean(card.params?.enabled);
  const intervalSec = Number(card.params?.intervalSeconds ?? 0);
  const lastFired = getLastFiredAt(card.id);
  const nextFireAt =
    enabled && intervalSec && lastFired ? lastFired + intervalSec * 1000 : null;
  const remainingMs = nextFireAt !== null ? nextFireAt - now : null;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    actions.updateCardParam(canvas.id, card.id, 'enabled', !enabled);
  };

  return (
    <div
      className={`card-runtime ${enabled ? 'on' : 'off'}`}
      data-no-drag
      data-testid={`card-runtime-${card.id}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        className={`toggle ${enabled ? 'on' : 'off'}`}
        onClick={toggle}
        data-no-drag
        data-testid={`card-toggle-${card.id}`}
        title={enabled ? 'active — click to pause' : 'paused — click to activate'}
        aria-pressed={enabled}
      >
        <span className="toggle-knob" />
      </button>
      <span className="runtime-next">
        {enabled
          ? remainingMs !== null
            ? `next in ${formatCountdown(remainingMs)}`
            : 'starting…'
          : 'paused'}
      </span>
    </div>
  );
}

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
