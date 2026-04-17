import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      // Keeps the Electron window offscreen + never focused so running the
      // suite doesn't interrupt whatever the user is doing.
      LOOPFLOW_HEADLESS: '1',
    },
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="titlebar"]');
  // Reset persisted state via the in-app test hook so each test starts clean.
  await page.evaluate(() => window.__loopflow?.reset());
  // After reset, force a re-render by clicking the canvas tab.
  await page.getByTestId('nav-canvas').click();
});

test.afterEach(async () => {
  await app.close();
});

test('create a canvas and connect two cards on it', async () => {
  // Create the canvas.
  await page.getByTestId('create-first-canvas').click();
  await expect(page.getByTestId('canvas-stage')).toBeVisible();
  await expect(page.getByTestId('canvas-name')).toHaveValue('untitled flow');

  // Add the first card.
  await page.getByTestId('add-card').click();
  const firstCardCount = await page.locator('[data-card-id]').count();
  expect(firstCardCount).toBe(1);
  const firstCardId = await page
    .locator('[data-card-id]')
    .first()
    .getAttribute('data-card-id');
  expect(firstCardId).toBeTruthy();

  // Add the second card.
  await page.getByTestId('add-card').click();
  await expect(page.locator('[data-card-id]')).toHaveCount(2);
  const secondCardId = await page
    .locator('[data-card-id]')
    .nth(1)
    .getAttribute('data-card-id');

  // Drag from the first card's output port to the second card.
  const port = page.getByTestId(`card-port-${firstCardId}`);
  const portBox = await port.boundingBox();
  const target = page.locator(`[data-card-id="${secondCardId}"]`);
  const targetBox = await target.boundingBox();
  if (!portBox || !targetBox) throw new Error('missing card geometry');

  const startX = portBox.x + portBox.width / 2;
  const startY = portBox.y + portBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Intermediate move so the connect-state actually picks up cursor tracking.
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 8 });
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();

  // One edge from card 1 -> card 2 must now exist in the JSON model.
  const persisted = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = persisted as any;
  expect(state.canvases).toHaveLength(1);
  expect(state.canvases[0].cards).toHaveLength(2);
  expect(state.canvases[0].edges).toHaveLength(1);
  expect(state.canvases[0].edges[0]).toMatchObject({
    from: firstCardId,
    to: secondCardId,
  });

  // Add a third card and connect card 2 -> card 3 to demonstrate "and so on".
  await page.getByTestId('add-card').click();
  const thirdCardId = await page
    .locator('[data-card-id]')
    .nth(2)
    .getAttribute('data-card-id');

  const port2 = page.getByTestId(`card-port-${secondCardId}`);
  const port2Box = await port2.boundingBox();
  const target3 = page.locator(`[data-card-id="${thirdCardId}"]`);
  const target3Box = await target3.boundingBox();
  if (!port2Box || !target3Box) throw new Error('missing card geometry');

  await page.mouse.move(port2Box.x + 5, port2Box.y + 5);
  await page.mouse.down();
  await page.mouse.move(target3Box.x + 30, target3Box.y + 30, { steps: 8 });
  await page.mouse.move(
    target3Box.x + target3Box.width / 2,
    target3Box.y + target3Box.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  const final = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((final as any).canvases[0].edges).toHaveLength(2);
});

test('repeatedly adding cards lays them out without overlapping', async () => {
  await page.getByTestId('create-first-canvas').click();
  // Five cards is enough to force the layout to advance at least two columns.
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('add-card').click();
  }
  await expect(page.locator('[data-card-id]')).toHaveCount(5);

  const state = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cards = (state as any).canvases[0].cards as Array<{ x: number; y: number }>;
  expect(cards).toHaveLength(5);

  const CARD_W = 180;
  const CARD_H = 76;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      const overlap =
        a.x < b.x + CARD_W &&
        a.x + CARD_W > b.x &&
        a.y < b.y + CARD_H &&
        a.y + CARD_H > b.y;
      expect(overlap, `cards ${i} and ${j} overlap at ${JSON.stringify({ a, b })}`).toBe(false);
    }
  }
  // All positions on the 24px grid.
  for (const c of cards) {
    expect(c.x % 24).toBe(0);
    expect(c.y % 24).toBe(0);
  }
});

test('dragging from a port to empty canvas spawns a new connected card', async () => {
  await page.getByTestId('create-first-canvas').click();
  await page.getByTestId('add-card').click();
  const firstCardId = await page
    .locator('[data-card-id]')
    .first()
    .getAttribute('data-card-id');
  expect(firstCardId).toBeTruthy();

  const port = page.getByTestId(`card-port-${firstCardId}`);
  const portBox = await port.boundingBox();
  const stageBox = await page.getByTestId('canvas-stage').boundingBox();
  if (!portBox || !stageBox) throw new Error('missing geometry');

  // Drop on empty space well to the right.
  const dropX = stageBox.x + stageBox.width - 160;
  const dropY = portBox.y + 40;

  await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dropX, dropY, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('[data-card-id]')).toHaveCount(2);
  const state = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = state as any;
  expect(s.canvases[0].cards).toHaveLength(2);
  expect(s.canvases[0].edges).toHaveLength(1);
  expect(s.canvases[0].edges[0].from).toBe(firstCardId);
});

test('card positions snap to the 24px grid while dragging', async () => {
  await page.getByTestId('create-first-canvas').click();
  await page.getByTestId('add-card').click();
  const cardId = await page
    .locator('[data-card-id]')
    .first()
    .getAttribute('data-card-id');

  const card = page.locator(`[data-card-id="${cardId}"]`);
  const box = await card.boundingBox();
  if (!box) throw new Error('no card geometry');

  // Drag by a non-grid-aligned amount. The stored position must still be on 24px steps.
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 30 + 157, box.y + 30 + 71, { steps: 10 });
  await page.mouse.up();

  const state = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const persisted = (state as any).canvases[0].cards[0];
  expect(persisted.x % 24).toBe(0);
  expect(persisted.y % 24).toBe(0);
});

test('create two distinct datamodels', async () => {
  await page.getByTestId('nav-datastore').click();

  await page.getByTestId('create-first-datamodel').click();
  await expect(page.getByTestId('datastore-stage')).toBeVisible();
  await page.getByTestId('datamodel-name').fill('users');

  // Create the second datamodel via the sidebar.
  await page.getByTestId('new-datamodel').click();
  await page.getByTestId('datamodel-name').fill('events');

  const persisted = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models = (persisted as any).datamodels.filter((m: { isSystem?: boolean }) => !m.isSystem);
  expect(models).toHaveLength(2);
  expect(models.map((m: { name: string }) => m.name).sort()).toEqual(['events', 'users']);

  const firstId = models[0].id;
  const secondId = models[1].id;
  await expect(page.getByTestId(`datamodel-item-${firstId}`)).toBeVisible();
  await expect(page.getByTestId(`datamodel-item-${secondId}`)).toBeVisible();
});

test('each datamodel exposes a table where data can be entered', async () => {
  await page.getByTestId('nav-datastore').click();

  // Model 1: users with name + age.
  await page.getByTestId('create-first-datamodel').click();
  await page.getByTestId('datamodel-name').fill('users');

  await page.getByTestId('add-field').click();
  let users = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let userField1 = (users as any).datamodels.find((m: any) => m.name === 'users').fields[0].id;
  await page.getByTestId(`field-name-${userField1}`).fill('name');

  await page.getByTestId('add-field').click();
  users = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userField2 = (users as any).datamodels.find((m: any) => m.name === 'users').fields[1].id;
  await page.getByTestId(`field-name-${userField2}`).fill('age');
  await page.getByTestId(`field-type-${userField2}`).selectOption('number');

  await page.getByTestId('add-row').click();
  await page.getByTestId(`cell-0-${userField1}`).fill('ada');
  await page.getByTestId(`cell-0-${userField2}`).fill('36');

  // Model 2: events with title.
  await page.getByTestId('new-datamodel').click();
  await page.getByTestId('datamodel-name').fill('events');
  await page.getByTestId('add-field').click();
  let events = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventField1 = (events as any).datamodels.find((m: any) => m.name === 'events').fields[0].id;
  await page.getByTestId(`field-name-${eventField1}`).fill('title');
  await page.getByTestId('add-row').click();
  await page.getByTestId(`cell-0-${eventField1}`).fill('launch');

  // Switch back to the users model — its data should still be there.
  events = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usersId = (events as any).datamodels.find((m: any) => m.name === 'users').id;
  await page.getByTestId(`datamodel-item-${usersId}`).click();
  await expect(page.getByTestId('datamodel-name')).toHaveValue('users');
  await expect(page.getByTestId(`cell-0-${userField1}`)).toHaveValue('ada');
  await expect(page.getByTestId(`cell-0-${userField2}`)).toHaveValue('36');

  // And the events model still holds its row.
  const final = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalState = final as any;
  const userModels = finalState.datamodels.filter((m: any) => !m.isSystem);
  expect(userModels).toHaveLength(2);
  const usersModel = userModels.find((m: any) => m.name === 'users');
  const eventsModel = userModels.find((m: any) => m.name === 'events');
  expect(usersModel.rows[0][userField1]).toBe('ada');
  expect(usersModel.rows[0][userField2]).toBe(36);
  expect(eventsModel.rows[0][eventField1]).toBe('launch');
});

// ---------- orchestration flow ----------

/**
 * Shared builder for the orchestration test. Returns the ids the flow tests
 * need so the "setup" and "execute" specs can each assert on the same shape.
 */
async function buildInterval30dayFlow(topic: string, datamodelName: string) {
  // Pre-create the target datamodel with fields matching the last30days
  // output schema. The datastore-append action writes rows by field NAME,
  // so these names must line up with the fixture keys (topic, finding,
  // source, score).
  await page.getByTestId('nav-datastore').click();
  await page.getByTestId('create-first-datamodel').click();
  await page.getByTestId('datamodel-name').fill(datamodelName);

  const addNamedField = async (name: string, type?: 'string' | 'number') => {
    await page.getByTestId('add-field').click();
    const state = await page.evaluate(() => window.__loopflow?.getState());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (state as any).datamodels.find((m: any) => m.name === datamodelName);
    const fid = model.fields[model.fields.length - 1].id;
    await page.getByTestId(`field-name-${fid}`).fill(name);
    if (type === 'number') await page.getByTestId(`field-type-${fid}`).selectOption('number');
  };
  await addNamedField('topic');
  await addNamedField('finding');
  await addNamedField('source');
  await addNamedField('score', 'number');

  // Build the canvas: interval-trigger -> last30days -> datastore-append
  await page.getByTestId('nav-canvas').click();
  await page.getByTestId('create-first-canvas').click();
  await page.getByTestId('canvas-name').fill('research loop');

  const addAndConfigure = async (kind: string, configure: () => Promise<void>) => {
    await page.getByTestId('add-card').click();
    // The just-added card is now selected; the inspector is open.
    await page.getByTestId('inspector-kind').selectOption(kind);
    await configure();
  };

  await addAndConfigure('interval-trigger', async () => {
    await page.getByTestId('param-intervalSeconds').fill('60');
    const enabled = page.getByTestId('param-enabled');
    if (!(await enabled.isChecked())) await enabled.check();
  });

  await addAndConfigure('last30days', async () => {
    await page.getByTestId('param-topic').fill(topic);
  });

  await addAndConfigure('datastore-append', async () => {
    const stateAfterCreate = await page.evaluate(() => window.__loopflow?.getState());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (stateAfterCreate as any).datamodels.find((m: any) => m.name === datamodelName);
    await page.getByTestId('param-datamodelId').selectOption(model.id);
  });

  // Connect the three cards via the port-drag interaction.
  const connect = async (fromIdx: number, toIdx: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = (await page.evaluate(() => window.__loopflow?.getState())) as any;
    const cards = snap.canvases[0].cards;
    const fromId = cards[fromIdx].id;
    const toId = cards[toIdx].id;
    const port = page.getByTestId(`card-port-${fromId}`);
    const target = page.locator(`[data-card-id="${toId}"]`);
    const portBox = await port.boundingBox();
    const targetBox = await target.boundingBox();
    if (!portBox || !targetBox) throw new Error('missing geometry for connect');
    await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      (portBox.x + targetBox.x) / 2,
      (portBox.y + targetBox.y) / 2,
      { steps: 10 },
    );
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
  };

  await connect(0, 1);
  await connect(1, 2);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await page.evaluate(() => window.__loopflow?.getState())) as any;
}

test('orchestration flow: build an interval -> last30days -> datastore-append pipeline from scratch', async () => {
  const state = await buildInterval30dayFlow('react 19', 'findings');

  // Three cards on the canvas, two edges between them, in the expected order.
  const canvas = state.canvases[0];
  expect(canvas.cards).toHaveLength(3);
  expect(canvas.edges).toHaveLength(2);
  expect(canvas.cards[0].kind).toBe('interval-trigger');
  expect(canvas.cards[1].kind).toBe('last30days');
  expect(canvas.cards[2].kind).toBe('datastore-append');

  // Each node has its params persisted from the inspector.
  expect(canvas.cards[0].params.intervalSeconds).toBe(60);
  expect(canvas.cards[0].params.enabled).toBe(true);
  expect(canvas.cards[1].params.topic).toBe('react 19');
  const findings = state.datamodels.find((m: { name: string }) => m.name === 'findings');
  expect(findings).toBeTruthy();
  expect(canvas.cards[2].params.datamodelId).toBe(findings.id);

  // Datamodel has the right shape and is still empty — setup alone should
  // not execute anything.
  const fieldNames = findings.fields.map((f: { name: string }) => f.name);
  expect(fieldNames).toEqual(['topic', 'finding', 'source', 'score']);
  expect(findings.rows).toHaveLength(0);

  // The `runs` system datamodel exists and is also empty.
  const runs = state.datamodels.find(
    (m: { name: string; isSystem?: boolean }) => m.isSystem && m.name === 'runs',
  );
  expect(runs).toBeTruthy();
  expect(runs.rows).toHaveLength(0);
});

test('orchestration flow: run it, rows land in the target datamodel and runs are logged', async () => {
  await buildInterval30dayFlow('tailwind 4', 'findings');

  // Fire the trigger from the inspector — selecting the trigger card and
  // clicking "run now" exercises the same path the scheduler would take.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state0 = (await page.evaluate(() => window.__loopflow?.getState())) as any;
  const triggerId = state0.canvases[0].cards[0].id;
  await page.locator(`[data-card-id="${triggerId}"]`).click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.getByTestId('inspector-run').click();

  // The mock last30days produces 3 findings — wait for them to land.
  await expect
    .poll(
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (await page.evaluate(() => window.__loopflow?.getState())) as any;
        return s.datamodels.find((m: { name: string }) => m.name === 'findings').rows.length;
      },
      { timeout: 5000 },
    )
    .toBe(3);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = (await page.evaluate(() => window.__loopflow?.getState())) as any;
  const findings = state.datamodels.find((m: { name: string }) => m.name === 'findings');
  const runs = state.datamodels.find(
    (m: { name: string; isSystem?: boolean }) => m.isSystem && m.name === 'runs',
  );

  // Every finding row was written through the field-name mapping and has
  // the expected per-row shape (topic stable across all rows, score is a
  // number).
  const fieldsByName = Object.fromEntries(
    findings.fields.map((f: { id: string; name: string }) => [f.name, f.id]),
  );
  for (const row of findings.rows) {
    expect(row[fieldsByName.topic]).toBe('tailwind 4');
    expect(typeof row[fieldsByName.finding]).toBe('string');
    expect(['reddit', 'x', 'hn']).toContain(row[fieldsByName.source]);
    expect(typeof row[fieldsByName.score]).toBe('number');
  }

  // One run record per card in the pipeline (trigger + last30days + sink).
  expect(runs.rows.length).toBe(3);
  const runsStatus = (row: Record<string, string>) => {
    const statusField = runs.fields.find((f: { name: string }) => f.name === 'status').id;
    return row[statusField];
  };
  for (const r of runs.rows) expect(runsStatus(r)).toBe('ok');

  // And the user can review them in the datastore — the runs model shows
  // up in the sidebar with its rows visible in the table.
  await page.getByTestId('nav-datastore').click();
  await page.getByTestId(`datamodel-item-${runs.id}`).click();
  await expect(page.getByTestId('data-table')).toBeVisible();
  await expect(page.getByTestId('row-0')).toBeVisible();
  await expect(page.getByTestId('row-2')).toBeVisible();
});
