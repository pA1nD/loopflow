import { useMemo } from 'react';
import { actions as storeActions } from '../lib/store';
import { runFromCard } from '../lib/runtime';
import { getAction, type ParamDef } from '../lib/actions';
import { RUNS_MODEL_NAME } from '../lib/store';
import { formatMs, formatRelative, formatLocalDateTime } from '../lib/format';
import type {
  AppState,
  Card,
  CardStorage,
  Datamodel,
  Field,
  FieldType,
} from '../lib/types';

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date'];
const fid = () => Math.random().toString(36).slice(2, 10);

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
        <DataSection state={state} canvasId={canvas.id} card={card} />
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

// Card-level data persistence config: write rows to no datamodel,
// to a selected one, or to a new one defined here.
function DataSection({
  state,
  canvasId,
  card,
}: {
  state: AppState;
  canvasId: string;
  card: Card;
}) {
  const storage: CardStorage = card.storage ?? { mode: 'none' };
  const userModels = state.datamodels.filter((m) => !m.isSystem);

  const setMode = (mode: CardStorage['mode']) => {
    if (mode === storage.mode) return;
    let next: CardStorage;
    if (mode === 'none') next = { mode: 'none' };
    else if (mode === 'existing') {
      next = {
        mode: 'existing',
        datamodelId:
          storage.mode === 'existing' ? storage.datamodelId : userModels[0]?.id ?? '',
      };
    } else {
      // Reuse previous shape if the user toggled back into 'new'.
      next =
        storage.mode === 'new'
          ? storage
          : {
              mode: 'new',
              name: card.title || 'output',
              fields: [
                { id: fid(), name: 'topic', type: 'string' },
                { id: fid(), name: 'finding', type: 'string' },
              ],
            };
    }
    storeActions.setCardStorage(canvasId, card.id, next);
  };

  const update = (next: CardStorage) =>
    storeActions.setCardStorage(canvasId, card.id, next);

  return (
    <div className="data-section" data-testid="data-section">
      <div className="inspector-label">data</div>

      <div className="data-mode" role="tablist">
        <button
          className={`data-mode-btn ${storage.mode === 'none' ? 'active' : ''}`}
          onClick={() => setMode('none')}
          data-testid="data-mode-none"
        >
          none
        </button>
        <button
          className={`data-mode-btn ${storage.mode === 'existing' ? 'active' : ''}`}
          onClick={() => setMode('existing')}
          data-testid="data-mode-existing"
          disabled={userModels.length === 0 && storage.mode !== 'existing'}
        >
          existing
        </button>
        <button
          className={`data-mode-btn ${storage.mode === 'new' ? 'active' : ''}`}
          onClick={() => setMode('new')}
          data-testid="data-mode-new"
        >
          new
        </button>
      </div>

      {storage.mode === 'existing' && (
        <label className="inspector-field">
          <span>target datamodel</span>
          <select
            value={storage.datamodelId}
            onChange={(e) => update({ mode: 'existing', datamodelId: e.target.value })}
            data-testid="data-existing-select"
          >
            {userModels.length === 0 && <option value="">— no datamodels —</option>}
            {userModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.fields.length} fields)
              </option>
            ))}
          </select>
        </label>
      )}

      {storage.mode === 'new' && (
        <NewModelEditor
          storage={storage}
          onChange={update}
          datamodels={state.datamodels}
        />
      )}
    </div>
  );
}

function NewModelEditor({
  storage,
  onChange,
  datamodels,
}: {
  storage: Extract<CardStorage, { mode: 'new' }>;
  onChange: (next: CardStorage) => void;
  datamodels: Datamodel[];
}) {
  const created = storage.createdId
    ? datamodels.find((m) => m.id === storage.createdId)
    : undefined;

  const setName = (name: string) => onChange({ ...storage, name });
  const setFields = (fields: Field[]) => onChange({ ...storage, fields });

  const addField = () =>
    setFields([...storage.fields, { id: fid(), name: `field${storage.fields.length + 1}`, type: 'string' }]);
  const updateField = (i: number, patch: Partial<Field>) =>
    setFields(storage.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const removeField = (i: number) => setFields(storage.fields.filter((_, idx) => idx !== i));

  return (
    <div className="data-new" data-testid="data-new-editor">
      <label className="inspector-field">
        <span>new datamodel name</span>
        <input
          type="text"
          value={storage.name}
          onChange={(e) => setName(e.target.value)}
          data-testid="data-new-name"
          placeholder="findings"
        />
      </label>

      <div className="inspector-label" style={{ marginTop: 4 }}>
        fields
      </div>
      <ul className="data-fields">
        {storage.fields.map((f, i) => (
          <li key={f.id} className="data-field">
            <input
              className="data-field-name"
              type="text"
              value={f.name}
              onChange={(e) => updateField(i, { name: e.target.value })}
              data-testid={`data-new-field-name-${i}`}
            />
            <select
              className="data-field-type"
              value={f.type}
              onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
              data-testid={`data-new-field-type-${i}`}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              className="icon-btn"
              title="remove field"
              onClick={() => removeField(i)}
              data-testid={`data-new-field-del-${i}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button className="ghost data-add-field" onClick={addField} data-testid="data-new-add-field">
        + field
      </button>

      {created && (
        <div className="data-new-created">
          first run created → <strong>{created.name}</strong> ({created.rows.length} rows)
        </div>
      )}
    </div>
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
