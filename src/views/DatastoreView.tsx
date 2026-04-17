import { actions } from '../lib/store';
import type { AppState } from '../lib/types';

interface Props {
  state: AppState;
}

export function DatastoreView({ state }: Props) {
  const model = state.datamodels.find((m) => m.id === state.activeDatamodelId);
  if (!model) {
    return (
      <div className="placeholder" data-testid="datastore-placeholder">
        <div className="placeholder-inner">
          <h2>no data model selected</h2>
          <button className="primary" onClick={() => actions.createDatamodel()} data-testid="create-first-datamodel">
            create a data model
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="datastore-area" data-testid="datastore-area">
      <div className="canvas-header">
        <input
          className="canvas-name"
          value={model.name}
          onChange={(e) => actions.renameDatamodel(model.id, e.target.value)}
          data-testid="datamodel-name"
        />
        <span className="canvas-meta">
          {model.fields.length} fields · {model.rows.length} rows
        </span>
      </div>
      <div className="datastore-stage" data-testid="datastore-stage">
        coming next
      </div>
    </div>
  );
}
