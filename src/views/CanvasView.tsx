import { actions } from '../lib/store';
import type { AppState } from '../lib/types';

interface Props {
  state: AppState;
}

export function CanvasView({ state }: Props) {
  const canvas = state.canvases.find((c) => c.id === state.activeCanvasId);
  if (!canvas) {
    return (
      <div className="placeholder" data-testid="canvas-placeholder">
        <div className="placeholder-inner">
          <h2>no canvas selected</h2>
          <button className="primary" onClick={() => actions.createCanvas()} data-testid="create-first-canvas">
            create a canvas
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="canvas-area" data-testid="canvas-area">
      <div className="canvas-header">
        <input
          className="canvas-name"
          value={canvas.name}
          onChange={(e) => actions.renameCanvas(canvas.id, e.target.value)}
          data-testid="canvas-name"
        />
        <span className="canvas-meta">
          {canvas.cards.length} cards · {canvas.edges.length} edges
        </span>
      </div>
      <div className="canvas-stage" data-testid="canvas-stage">
        coming next
      </div>
    </div>
  );
}
