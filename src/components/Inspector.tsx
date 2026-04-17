import { useMemo } from 'react';
import { actions as storeActions } from '../lib/store';
import { runFromCard } from '../lib/runtime';
import { allActionTypes, getAction, type ParamDef } from '../lib/actions';
import { RUNS_MODEL_NAME } from '../lib/store';
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
        <span className="inspector-label">action</span>
        <button
          className="icon-btn"
          title="close"
          onClick={() => storeActions.setSelectedCard(null)}
          data-testid="inspector-close"
        >
          ×
        </button>
      </div>

      <select
        className="inspector-kind"
        value={card.kind}
        onChange={(e) =>
          storeActions.updateCard(canvas.id, card.id, { kind: e.target.value, params: {} })
        }
        data-testid="inspector-kind"
      >
        {allActionTypes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>

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
          rows={3}
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

  // default: string
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
  const cardRuns = useMemo(() => {
    const runs = state.datamodels.find((m) => m.isSystem && m.name === RUNS_MODEL_NAME);
    if (!runs) return [];
    const cardIdField = runs.fields.find((f) => f.name === 'cardId');
    if (!cardIdField) return [];
    return runs.rows
      .filter((r) => r[cardIdField.id] === card.id)
      .slice(-5)
      .reverse();
  }, [state.datamodels, card.id]);

  const runsModel = state.datamodels.find((m) => m.isSystem && m.name === RUNS_MODEL_NAME);
  const fieldId = (name: string) => runsModel?.fields.find((f) => f.name === name)?.id ?? name;

  return (
    <div className="inspector-runs" data-testid="inspector-runs">
      <div className="inspector-label">recent runs</div>
      {cardRuns.length === 0 ? (
        <div className="inspector-empty">no runs yet</div>
      ) : (
        <ul>
          {cardRuns.map((r, i) => {
            const status = String(r[fieldId('status')] ?? '');
            const duration = Number(r[fieldId('durationMs')] ?? 0);
            const startedAt = String(r[fieldId('startedAt')] ?? '');
            return (
              <li key={i} className={`run-item run-${status}`} data-testid={`run-item-${i}`}>
                <span className={`run-dot ${status}`} />
                <span className="run-time">{startedAt.slice(11, 19)}</span>
                <span className="run-dur">{duration}ms</span>
                <span className="run-status">{status}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
