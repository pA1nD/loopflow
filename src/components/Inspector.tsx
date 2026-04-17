import { useMemo } from 'react';
import { actions as storeActions } from '../lib/store';
import { runFromCard } from '../lib/runtime';
import { getAction, type ParamDef } from '../lib/actions';
import { RUNS_MODEL_NAME } from '../lib/store';
import { formatMs, formatRelative, formatLocalDateTime } from '../lib/format';
import type { AppState, Card, Datamodel } from '../lib/types';

interface Props {
  state: AppState;
}

export function Inspector({ state }: Props) {
  const canvas = state.canvases.find((c) => c.id === state.activeCanvasId);
  const card = canvas?.cards.find((c) => c.id === state.selectedCardId) ?? null;
  if (!canvas || !card) return null;

  const action = getAction(card.kind);

  return (
    <aside className="inspector" data-testid="inspector">
      <div className="inspector-header">
        <span className="inspector-kind-badge" data-testid="inspector-kind">
          {action?.label ?? card.kind}
        </span>
        <button
          className="icon-btn"
          title="close"
          onClick={() => storeActions.setSelectedCard(null)}
          data-testid="inspector-close"
        >
          ×
        </button>
      </div>

      <input
        className="inspector-title"
        value={card.title}
        placeholder="untitled"
        onChange={(e) =>
          storeActions.updateCard(canvas.id, card.id, { title: e.target.value })
        }
        data-testid="inspector-title"
      />

      {action?.description && <p className="inspector-desc">{action.description}</p>}

      {action?.params && action.params.length > 0 && (
        <>
          <div className="inspector-label">params</div>
          <div className="inspector-form" data-testid="inspector-form">
            {action.params.map((p) => (
              <ParamRow
                key={p.name}
                param={p}
                value={card.params?.[p.name]}
                datamodels={state.datamodels}
                onChange={(v) =>
                  storeActions.updateCardParam(canvas.id, card.id, p.name, v)
                }
              />
            ))}
          </div>
        </>
      )}

      {action?.run && (
        <button
          className="primary inspector-run"
          onClick={() => {
            runFromCard(canvas.id, card.id).catch((e) => console.error(e));
          }}
          data-testid="inspector-run"
        >
          run now
        </button>
      )}

      <RecentRuns state={state} card={card} />
    </aside>
  );
}

interface ParamRowProps {
  param: ParamDef;
  value: unknown;
  datamodels: Datamodel[];
  onChange: (v: unknown) => void;
}

function ParamRow({ param, value, datamodels, onChange }: ParamRowProps) {
  const label = param.label ?? param.name;
  const tid = `param-${param.name}`;
  const current = value === undefined ? param.default : value;

  if (param.type === 'boolean') {
    return (
      <label className="inspector-field inspector-field-inline">
        <input
          type="checkbox"
          checked={Boolean(current)}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={tid}
        />
        <span>{label}</span>
      </label>
    );
  }

  if (param.type === 'number') {
    return (
      <label className="inspector-field">
        <span>{label}</span>
        <input
          type="number"
          value={current === undefined || current === null ? '' : String(current)}
          placeholder={param.placeholder}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          data-testid={tid}
        />
      </label>
    );
  }

  if (param.type === 'text') {
    return (
      <label className="inspector-field">
        <span>{label}</span>
        <textarea
          rows={4}
          value={typeof current === 'string' ? current : ''}
          placeholder={param.placeholder}
          onChange={(e) => onChange(e.target.value)}
          data-testid={tid}
        />
      </label>
    );
  }

  if (param.type === 'datamodel') {
    const available = datamodels.filter((m) => !m.isSystem);
    return (
      <label className="inspector-field">
        <span>{label}</span>
        <select
          value={typeof current === 'string' ? current : ''}
          onChange={(e) => onChange(e.target.value || null)}
          data-testid={tid}
        >
          <option value="">— select —</option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="inspector-field">
      <span>{label}</span>
      <input
        type="text"
        value={typeof current === 'string' ? current : ''}
        placeholder={param.placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={tid}
      />
    </label>
  );
}

function RecentRuns({ state, card }: { state: AppState; card: Card }) {
  const runs = useMemo(() => {
    const model = state.datamodels.find((m) => m.isSystem && m.name === RUNS_MODEL_NAME);
    if (!model) return [] as Array<{ startedAt: string; durationMs: number; status: string }>;
    const byName = Object.fromEntries(model.fields.map((f) => [f.name, f.id]));
    return model.rows
      .filter((r) => r[byName.cardId] === card.id)
      .slice(-5)
      .reverse()
      .map((r) => ({
        startedAt: String(r[byName.startedAt] ?? ''),
        durationMs: Number(r[byName.durationMs] ?? 0),
        status: String(r[byName.status] ?? ''),
      }));
  }, [state.datamodels, card.id]);

  return (
    <div className="inspector-runs" data-testid="inspector-runs">
      <div className="inspector-label">recent runs</div>
      {runs.length === 0 ? (
        <div className="inspector-empty">no runs yet</div>
      ) : (
        <ul>
          {runs.map((r, i) => (
            <li key={i} className={`run-item run-${r.status}`} data-testid={`run-item-${i}`}>
              <span className={`run-dot ${r.status}`} />
              <span className="run-time" title={formatLocalDateTime(r.startedAt)}>
                {formatRelative(r.startedAt)}
              </span>
              <span className="run-dur">{formatMs(r.durationMs)}</span>
              <span className="run-status">{r.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
