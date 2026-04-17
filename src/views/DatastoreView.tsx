import { actions } from '../lib/store';
import type { AppState, Datamodel, Field, FieldType } from '../lib/types';

interface Props {
  state: AppState;
}

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date'];

export function DatastoreView({ state }: Props) {
  const model = state.datamodels.find((m) => m.id === state.activeDatamodelId);
  if (!model) {
    return (
      <div className="placeholder" data-testid="datastore-placeholder">
        <div className="placeholder-inner">
          <h2>no data model selected</h2>
          <button
            className="primary"
            onClick={() => actions.createDatamodel()}
            data-testid="create-first-datamodel"
          >
            create a data model
          </button>
        </div>
      </div>
    );
  }
  return <DatamodelEditor model={model} />;
}

function DatamodelEditor({ model }: { model: Datamodel }) {
  return (
    <div className="datastore-stage" data-testid="datastore-stage">
      <div className="stage-toolbar">
        <button
          className="ghost"
          onClick={() => actions.addField(model.id)}
          data-testid="add-field"
        >
          + field
        </button>
        <button
          className="ghost"
          onClick={() => actions.addRow(model.id)}
          disabled={model.fields.length === 0}
          data-testid="add-row"
        >
          + row
        </button>
      </div>

      {model.fields.length === 0 ? (
        <div className="datastore-empty">
          <p>add a field to define this data model.</p>
          <button
            className="primary"
            onClick={() => actions.addField(model.id)}
            data-testid="add-field-empty"
          >
            + field
          </button>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table" data-testid="data-table">
            <thead>
              <tr>
                <th className="row-num" />
                {model.fields.map((f) => (
                  <th key={f.id} data-testid={`field-header-${f.id}`}>
                    <FieldHeader model={model} field={f} />
                  </th>
                ))}
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {model.rows.length === 0 && (
                <tr>
                  <td className="row-num">·</td>
                  <td colSpan={model.fields.length + 1} className="muted">
                    no rows yet
                  </td>
                </tr>
              )}
              {model.rows.map((row, i) => (
                <tr key={i} data-testid={`row-${i}`}>
                  <td className="row-num">{i + 1}</td>
                  {model.fields.map((f) => (
                    <td key={f.id}>
                      <Cell
                        modelId={model.id}
                        rowIndex={i}
                        field={f}
                        value={row[f.id]}
                      />
                    </td>
                  ))}
                  <td className="col-actions">
                    <button
                      className="row-delete"
                      title="delete row"
                      onClick={() => actions.deleteRow(model.id, i)}
                      data-testid={`delete-row-${i}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FieldHeader({ model, field }: { model: Datamodel; field: Field }) {
  return (
    <div className="field-header">
      <input
        className="field-name"
        value={field.name}
        onChange={(e) => actions.updateField(model.id, field.id, { name: e.target.value })}
        data-testid={`field-name-${field.id}`}
      />
      <select
        className="field-type"
        value={field.type}
        onChange={(e) =>
          actions.updateField(model.id, field.id, { type: e.target.value as FieldType })
        }
        data-testid={`field-type-${field.id}`}
      >
        {FIELD_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        className="field-delete"
        title="delete field"
        onClick={() => actions.deleteField(model.id, field.id)}
        data-testid={`delete-field-${field.id}`}
      >
        ×
      </button>
    </div>
  );
}

function Cell({
  modelId,
  rowIndex,
  field,
  value,
}: {
  modelId: string;
  rowIndex: number;
  field: Field;
  value: unknown;
}) {
  const set = (v: unknown) => actions.updateCell(modelId, rowIndex, field.id, v);
  const testId = `cell-${rowIndex}-${field.id}`;
  switch (field.type) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => set(e.target.checked)}
          data-testid={testId}
        />
      );
    case 'number':
      return (
        <input
          className="cell-input"
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))}
          data-testid={testId}
        />
      );
    case 'date':
      return (
        <input
          className="cell-input"
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
          data-testid={testId}
        />
      );
    default:
      return (
        <input
          className="cell-input"
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => set(e.target.value)}
          data-testid={testId}
        />
      );
  }
}
