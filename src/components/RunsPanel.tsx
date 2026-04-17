import { useMemo, useState } from 'react';
import { actions as storeActions, RUNS_MODEL_NAME } from '../lib/store';
import { getAction } from '../lib/actions';
import type { AppState } from '../lib/types';

interface Props {
  state: AppState;
}

interface Step {
  rowIndex: number;
  flowId: string;
  cardId: string;
  actionType: string;
  startedAt: string;
  durationMs: number;
  status: string;
  output: string;
  error: string;
}

interface Flow {
  flowId: string;
  steps: Step[]; // chronological
  startedAt: string;
  status: 'ok' | 'error' | 'unknown';
  totalMs: number; // sum of step durations
  spanMs: number; // wall-clock span from first start to last finish
  rootCardId: string;
}

export function RunsPanel({ state }: Props) {
  const [openFlowId, setOpenFlowId] = useState<string | null>(null);
  const [openStepIndex, setOpenStepIndex] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  const steps = useMemo(() => {
    const model = state.datamodels.find((m) => m.isSystem && m.name === RUNS_MODEL_NAME);
    if (!model) return [] as Step[];
    const byName = Object.fromEntries(model.fields.map((f) => [f.name, f.id]));
    return model.rows.map((r, i) => ({
      rowIndex: i,
      flowId: String(r[byName.flowId] ?? `legacy-${i}`),
      cardId: String(r[byName.cardId] ?? ''),
      actionType: String(r[byName.actionType] ?? ''),
      startedAt: String(r[byName.startedAt] ?? ''),
      durationMs: Number(r[byName.durationMs] ?? 0),
      status: String(r[byName.status] ?? ''),
      output: String(r[byName.output] ?? ''),
      error: String(r[byName.error] ?? ''),
    }));
  }, [state.datamodels]);

  const cardById = useMemo(() => {
    const map = new Map<string, { title: string; canvasId: string; canvasName: string }>();
    for (const c of state.canvases) {
      for (const card of c.cards) {
        map.set(card.id, { title: card.title, canvasId: c.id, canvasName: c.name });
      }
    }
    return map;
  }, [state.canvases]);

  const flows: Flow[] = useMemo(() => {
    const groups = new Map<string, Step[]>();
    for (const s of steps) {
      if (!groups.has(s.flowId)) groups.set(s.flowId, []);
      groups.get(s.flowId)!.push(s);
    }
    const list: Flow[] = [];
    for (const [flowId, group] of groups) {
      const sorted = [...group].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const firstMs = Date.parse(first.startedAt);
      const lastMs = Date.parse(last.startedAt) + last.durationMs;
      const hasError = sorted.some((s) => s.status === 'error');
      list.push({
        flowId,
        steps: sorted,
        startedAt: first.startedAt,
        status: hasError ? 'error' : sorted.every((s) => s.status === 'ok') ? 'ok' : 'unknown',
        totalMs: sorted.reduce((n, s) => n + s.durationMs, 0),
        spanMs: Number.isFinite(lastMs - firstMs) ? lastMs - firstMs : 0,
        rootCardId: first.cardId,
      });
    }
    // Newest flow first.
    list.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return list;
  }, [steps]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return flows;
    return flows.filter((flow) => {
      const root = cardById.get(flow.rootCardId);
      if (root?.title.toLowerCase().includes(f)) return true;
      if (flow.status.includes(f)) return true;
      return flow.steps.some(
        (s) =>
          s.actionType.toLowerCase().includes(f) ||
          s.status.toLowerCase().includes(f) ||
          s.output.toLowerCase().includes(f) ||
          s.error.toLowerCase().includes(f) ||
          cardById.get(s.cardId)?.title.toLowerCase().includes(f),
      );
    });
  }, [flows, filter, cardById]);

  const stats = useMemo(() => {
    let ok = 0;
    let err = 0;
    for (const f of flows) {
      if (f.status === 'ok') ok++;
      else if (f.status === 'error') err++;
    }
    return { total: flows.length, ok, err };
  }, [flows]);

  const jumpToCard = (cardId: string) => {
    const ctx = cardById.get(cardId);
    if (!ctx) return;
    storeActions.selectCanvas(ctx.canvasId);
    storeActions.setView('canvas');
    storeActions.setSelectedCard(cardId);
  };

  const toggleFlow = (flowId: string) => {
    setOpenFlowId((cur) => (cur === flowId ? null : flowId));
    setOpenStepIndex(null);
  };

  return (
    <aside className="runs-panel" data-testid="runs-panel">
      <div className="inspector-header">
        <span className="inspector-kind-badge">flows</span>
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
        <span data-testid="runs-stat-total">{stats.total} flows</span>
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
        {filtered.length === 0 && <li className="inspector-empty">no flows yet</li>}
        {filtered.map((flow) => {
          const open = openFlowId === flow.flowId;
          const root = cardById.get(flow.rootCardId);
          const timeOnly = flow.startedAt.slice(11, 19);
          return (
            <li
              key={flow.flowId}
              className={`flow-item ${open ? 'open' : ''}`}
              data-testid={`flow-${flow.flowId}`}
            >
              <button
                className="flow-head"
                onClick={() => toggleFlow(flow.flowId)}
                data-testid={`flow-head-${flow.flowId}`}
              >
                <span className={`run-dot ${flow.status}`} />
                <span className="flow-root">{root?.title ?? '(deleted)'}</span>
                <span className="flow-count">{flow.steps.length} step{flow.steps.length === 1 ? '' : 's'}</span>
                <span className="flow-dur">{formatMs(flow.spanMs || flow.totalMs)}</span>
                <span className="flow-time">{timeOnly}</span>
                <span className="flow-caret">{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <ol className="flow-steps" data-testid={`flow-steps-${flow.flowId}`}>
                  {flow.steps.map((s, i) => {
                    const stepOpen = openStepIndex === s.rowIndex;
                    const card = cardById.get(s.cardId);
                    const action = getAction(s.actionType);
                    const tOnly = s.startedAt.slice(11, 19);
                    return (
                      <li
                        key={s.rowIndex}
                        className={`step-item ${stepOpen ? 'open' : ''}`}
                        data-testid={`step-${s.rowIndex}`}
                      >
                        <button
                          className="step-head"
                          onClick={() => setOpenStepIndex(stepOpen ? null : s.rowIndex)}
                        >
                          <span className="step-index">{i + 1}</span>
                          <span className={`run-dot ${s.status}`} />
                          <span className="step-kind">{action?.label ?? s.actionType}</span>
                          <span className="step-card">{card?.title ?? '(deleted)'}</span>
                          <span className="step-dur">{s.durationMs}ms</span>
                          <span className="step-time">{tOnly}</span>
                        </button>
                        {stepOpen && (
                          <div className="step-details" data-testid={`step-detail-${s.rowIndex}`}>
                            <Detail label="started" value={`${s.startedAt.slice(0, 10)} ${tOnly}`} />
                            <Detail label="status" value={s.status} />
                            <Detail label="duration" value={`${s.durationMs} ms`} />
                            {card && (
                              <Detail
                                label="card"
                                value={
                                  <button
                                    className="link"
                                    onClick={() => jumpToCard(s.cardId)}
                                    data-testid={`step-jump-${s.rowIndex}`}
                                  >
                                    {card.title} · {card.canvasName}
                                  </button>
                                }
                              />
                            )}
                            {s.error && <Detail label="error" value={<pre>{s.error}</pre>} />}
                            {s.output && (
                              <Detail label="output" value={<pre>{tryPretty(s.output)}</pre>} />
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
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

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
