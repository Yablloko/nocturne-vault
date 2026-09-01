const { _electron: electron } = require('playwright');
const electronExecutable = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const password = 'Тестовая мастер фраза для перезапуска 2026';
const pattern = '0-1-4-7-8';

async function launch(root) {
  return electron.launch({ executablePath: electronExecutable, args: ['.'], cwd: path.resolve(__dirname, '..'), env: { ...process.env, NOCTURNE_TEST_USER_DATA: root } });
}

async function draw(page, selector, indexes) {
  const nodes = page.locator(`${selector} [data-pattern-node]`);
  const first = await nodes.nth(indexes[0]).boundingBox();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  for (const index of indexes.slice(1)) {
    const box = await nodes.nth(index).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  }
  await page.mouse.up();
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-quick-restart-'));
  let app;
  try {
    app = await launch(root);
    let main = await app.firstWindow();
    await main.locator('#create-form input[name="password"]').fill(password);
    await main.locator('#create-form input[name="confirm"]').fill(password);
    await main.locator('#create-form button[type="submit"]').click();
    await main.locator('#recovery-confirm').check();
    await main.locator('[data-action="finish-onboarding"]').click();
    const configured = await main.evaluate(async ({ patternValue, master }) => window.nocturne.configureQuickUnlock('pattern', patternValue, master), { patternValue: pattern, master: password });
    if (!configured.ok) throw new Error(configured.error);
    await app.close();
    app = null;

    app = await launch(root);
    main = await app.firstWindow();
    await main.waitForSelector('#unlock-form[data-mode="password"]');
    if (await main.locator('#pattern-unlock-form').count()) throw new Error('Pattern must not unlock the first launch gate');
    await main.locator('#unlock-form input[name="credential"]').fill(password);
    await main.locator('#unlock-form button[type="submit"]').click();
    await main.waitForSelector('.app-shell');

    await main.locator('[data-action="lock"]').click();
    await main.waitForSelector('#pattern-unlock-form [data-pattern-surface]');
    await draw(main, '#pattern-unlock-form', [0, 1, 4, 7, 8]);
    await main.waitForSelector('.app-shell');

    const quickWindow = app.waitForEvent('window');
    await main.evaluate(() => window.nocturne.close());
    const quick = await quickWindow;
    await quick.waitForSelector('.chevron');
    await quick.evaluate(async () => window.nocturneQuick.toggle());
    await quick.waitForSelector('.quick-root.is-expanded');
    await quick.getByText('Пароли', { exact: true }).click();
    await quick.waitForSelector('.quick-pattern');
    if (await quick.locator('.unlock input').count()) throw new Error('Quick panel requested master password after session activation');
    console.log('Quick restart UI smoke test passed');
  } finally {
    if (app) await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
