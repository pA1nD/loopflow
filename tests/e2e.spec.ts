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
  await expect(page.getByTestId('canvas-area')).toBeVisible();
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
  await expect(page.getByTestId('datastore-area')).toBeVisible();
  await page.getByTestId('datamodel-name').fill('users');

  // Create the second datamodel via the sidebar.
  await page.getByTestId('new-datamodel').click();
  await page.getByTestId('datamodel-name').fill('events');

  const persisted = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models = (persisted as any).datamodels;
  expect(models).toHaveLength(2);
  expect(models.map((m: { name: string }) => m.name).sort()).toEqual(['events', 'users']);

  // Both models should be selectable from the sidebar.
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
  let userField1 = (users as any).datamodels[0].fields[0].id;
  await page.getByTestId(`field-name-${userField1}`).fill('name');

  await page.getByTestId('add-field').click();
  users = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userField2 = (users as any).datamodels[0].fields[1].id;
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
  const eventField1 = (events as any).datamodels[1].fields[0].id;
  await page.getByTestId(`field-name-${eventField1}`).fill('title');
  await page.getByTestId('add-row').click();
  await page.getByTestId(`cell-0-${eventField1}`).fill('launch');

  // Switch back to the users model — its data should still be there.
  events = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usersId = (events as any).datamodels[0].id;
  await page.getByTestId(`datamodel-item-${usersId}`).click();
  await expect(page.getByTestId('datamodel-name')).toHaveValue('users');
  await expect(page.getByTestId(`cell-0-${userField1}`)).toHaveValue('ada');
  await expect(page.getByTestId(`cell-0-${userField2}`)).toHaveValue('36');

  // And the events model still holds its row.
  const final = await page.evaluate(() => window.__loopflow?.getState());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalState = final as any;
  expect(finalState.datamodels).toHaveLength(2);
  expect(finalState.datamodels[0].rows[0][userField1]).toBe('ada');
  expect(finalState.datamodels[0].rows[0][userField2]).toBe(36);
  expect(finalState.datamodels[1].rows[0][eventField1]).toBe('launch');
});
