import { useMemo, useState } from 'react';
import { actions as storeActions, RUNS_MODEL_NAME } from '../lib/store';
import { getAction } from '../lib/actions';
import type { AppState } from '../lib/types';

interface Props {
  state: AppState;
}

interface RunRow {
  rowIndex: number;
  cardId: string;
  actionType: string;
  startedAt: string;
  durationMs: number;
  status: string;
  output: string;
  error: string;
}

export function RunsPanel({ state }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  const runs = useMemo(() => {
    const model = state.datamodels.find((m) => m.isSystem && m.name === RUNS_MODEL_NAME);
    if (!model) return [] as RunRow[];
    const byName = Object.fromEntries(model.fields.map((f) => [f.name, f.id]));
    const list: RunRow[] = model.rows.map((r, i) => ({
      rowIndex: i,
      cardId: String(r[byName.cardId] ?? ''),
      actionType: String(r[byName.actionType] ?? ''),
      startedAt: String(r[byName.startedAt] ?? ''),
      durationMs: Number(r[byName.durationMs] ?? 0),
      status: String(r[byName.status] ?? ''),
      output: String(r[byName.output] ?? ''),
      error: String(r[byName.error] ?? ''),
    }));
    // Newest first; runs are appended in execution order.
    return list.reverse();
  }, [state.datamodels]);

  const cardTitleById = useMemo(() => {
    const map = new Map<string, { title: string; canvasId: string; canvasName: string }>();
    for (const c of state.canvases) {
      for (const card of c.cards) {
        map.set(card.id, { title: card.title, canvasId: c.id, canvasName: c.name });
      }
    }
    return map;
  }, [state.canvases]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return runs;
    return runs.filter((r) => {
      const card = cardTitleById.get(r.cardId);
      return (
        r.actionType.toLowerCase().includes(f) ||
        r.status.toLowerCase().includes(f) ||
        r.output.toLowerCase().includes(f) ||
        r.error.toLowerCase().includes(f) ||
        card?.title.toLowerCase().includes(f)
      );
    });
  }, [runs, filter, cardTitleById]);

  const stats = useMemo(() => {
    let ok = 0;
    let err = 0;
    for (const r of runs) {
      if (r.status === 'ok') ok++;
      else if (r.status === 'error') err++;
    }
    return { total: runs.length, ok, err };
  }, [runs]);

  const jumpToCard = (cardId: string) => {
    const ctx = cardTitleById.get(cardId);
    if (!ctx) return;
    storeActions.selectCanvas(ctx.canvasId);
    storeActions.setView('canvas');
    storeActions.setSelectedCard(cardId);
  };

  return (
    <aside className="runs-panel" data-testid="runs-panel">
      <div className="inspector-header">
        <span className="inspector-kind-badge">runs</span>
        <button
          className="icon-btn"
          title="close"
          onClick={() => storeActions.setRunsPanel(false)}
          data-testid="runs-panel-close"
        >
          ×
        </button>
      </div>

      <div className="runs-stats">
        <span data-testid="runs-stat-total">{stats.total} total</span>
        <span className="runs-stat-ok">{stats.ok} ok</span>
        <span className="runs-stat-err">{stats.err} err</span>
      </div>

      <input
        className="runs-filter"
        placeholder="filter by card, status, output…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        data-testid="runs-filter"
      />

      <ul className="runs-list" data-testid="runs-list">
        {filtered.length === 0 && <li className="inspector-empty">no runs yet</li>}
        {filtered.map((r) => {
          const open = expanded === r.rowIndex;
          const card = cardTitleById.get(r.cardId);
          const action = getAction(r.actionType);
          const timeOnly = r.startedAt.slice(11, 19);
          const dateOnly = r.startedAt.slice(0, 10);
          return (
            <li
              key={r.rowIndex}
              className={`runs-item ${open ? 'open' : ''}`}
              data-testid={`runs-item-${r.rowIndex}`}
            >
              <button
                className="runs-item-head"
                onClick={() => setExpanded(open ? null : r.rowIndex)}
              >
                <span className={`run-dot ${r.status}`} />
                <span className="runs-item-kind">{action?.label ?? r.actionType}</span>
                <span className="runs-item-card">{card?.title ?? '(deleted)'}</span>
                <span className="runs-item-dur">{r.durationMs}ms</span>
                <span className="runs-item-time">{timeOnly}</span>
              </button>
              {open && (
                <div className="runs-item-details" data-testid={`runs-detail-${r.rowIndex}`}>
                  <Detail label="started" value={`${dateOnly} ${timeOnly}`} />
                  <Detail label="status" value={r.status} />
                  <Detail label="duration" value={`${r.durationMs} ms`} />
                  {card && (
                    <Detail
                      label="card"
                      value={
                        <button
                          className="link"
                          onClick={() => jumpToCard(r.cardId)}
                          data-testid={`runs-jump-${r.rowIndex}`}
                        >
                          {card.title} · {card.canvasName}
                        </button>
                      }
                    />
                  )}
                  {r.error && <Detail label="error" value={<pre>{r.error}</pre>} />}
                  {r.output && (
                    <Detail
                      label="output"
                      value={<pre>{tryPretty(r.output)}</pre>}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="runs-detail-row">
      <span className="runs-detail-label">{label}</span>
      <div className="runs-detail-value">{value}</div>
    </div>
  );
}

function tryPretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
