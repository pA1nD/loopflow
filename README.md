# loopflow

A minimal Electron app for sketching LLM orchestrations as connected cards on a
canvas, alongside a tiny structured datastore for the values those flows
operate on. Built to feel ultralight — Excalidraw vibes — and backed by a
single JSON model.

## What's in the box

- **Canvas** — multiple canvases, each holding cards (kinds: `prompt`, `llm`,
  `tool`, `output`, `note`) connected by directional edges. Drag a card body to
  move it; mousedown the right-side port and release on another card to draw a
  connection. Backspace deletes a selected edge.
- **Datastore** — define datamodels with typed fields (`string`, `number`,
  `boolean`, `date`), then populate them via per-model tables.
- **Persistence** — entire app state is serialized to `localStorage` under
  `loopflow:state:v1`. Exporting/importing is just JSON.

## Scripts

```bash
npm install
npm run dev        # vite + electron in watch mode
npm run build      # bundle main, preload and renderer
npm run start      # launch the bundled Electron app
npm run test:e2e   # Playwright e2e against the bundled app
npm run typecheck  # strict TS across app + tests
```

## Tested acceptance criteria

The Playwright suite covers:

1. Creating a canvas and connecting cards (and so on).
2. Creating two distinct datamodels.
3. Adding rows to each datamodel's table.
