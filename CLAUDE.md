# Working in this repo

## 1. Debug through CDP, not through the user

The Electron dev app is launchable with a Chrome DevTools Protocol endpoint
on port 9222:

```
npm run dev:debug
```

Prefer this over asking the human "does it work now?" — you can observe
and drive the running app directly:

- `node scripts/inspect.mjs '<expression>'` — evaluate JS in the renderer
  (e.g. `window.__loopflow.getState()`, `window.__loopflow.runFromCard(cid, mid)`).
  Accepts a single expression or a braced block that returns a value.
  Async expressions are awaited.
- `node scripts/run-llm.mjs` — end-to-end validator: reads the seeded
  canvas, fires the LLM node, polls rows until they land, prints the
  final state. Good smoke test after renderer changes.
- `node scripts/shot.mjs /tmp/out.png` — `Page.captureScreenshot` helper;
  read the PNG back to validate layout visually.

**Work this into the loop while you're building:** change code → rebuild
(`npm run build` — main-process edits need a full Electron restart, the
renderer HMRs on its own) → inspect via CDP → iterate. Don't hand
the user something you haven't verified yourself.

Main-process errors surface through the CDP page-level error channel and
through `[electron-main:err]` in test output — check stderr when things
fail silently.

## 2. Keep the e2e suite small, meaningful, and alive

The Playwright suite in `tests/e2e.spec.ts` is the second line of
validation. Its job is to catch regressions on **things that matter** —
not to paper over every change.

Rules:

- **Core flows only.** Creating canvases, adding cards, connecting,
  building a datamodel, running a pipeline end-to-end. These are the
  user's mental model; they must keep working.
- **Persist every meaningful human feature request as a test.** When the
  user asks for behavior X ("drag from a port to empty canvas spawns a
  connected card"; "running the llm writes rows into the target
  datamodel"), write a test that locks that in. That's how "what the
  user asked for" becomes durable.
- **Skip marginal things.** Don't assert on exact pixel positions, exact
  strings that can change (LLM output content, timestamps), CSS class
  names, or any UI detail that's reasonable to evolve.
- **Structural assertions over exact content.** Prefer
  `typeof x === 'number'` and `length >= 2` over `rows[0].finding === 'X'`
  — especially for real LLM outputs that are non-deterministic.
- **Run the suite at natural milestones**, not on every tiny fix:
  - after a feature is implemented and before reporting it done
  - after a refactor that touches shared code (store, runtime, actions)
  - before pushing a branch
  - *not* after each CSS tweak, test name rename, or typo fix
- **Maintain as you go.** When testids rename or shapes move around,
  update the affected tests in the same commit. A broken suite stops
  being load-bearing.

When in doubt, ask: "if this test failed six months from now, would I
want to know?" If yes, keep it. If no, delete it.
