const { _electron: electron } = require('playwright');
const electronExecutable = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-quick-ui-'));
  const packagedExecutable = process.env.NOCTURNE_ELECTRON_EXE;
  const electronApp = await electron.launch({
    executablePath: packagedExecutable || electronExecutable,
    args: packagedExecutable ? [] : ['.'],
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NOCTURNE_TEST_USER_DATA: root },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const main = electronApp.windows().find((page) => page.url().includes('/renderer/'));
    if (!main) throw new Error('Expected main window');
    if (electronApp.windows().some((page) => page.url().includes('/quick/'))) throw new Error('Quick panel must stay hidden before main window is closed');

    const password = 'очень длинный пароль для quick 2026';
    await main.locator('#create-form input[name="password"]').fill(password);
    await main.locator('#create-form input[name="confirm"]').fill(password);
    await main.locator('#create-form button[type="submit"]').click();
    await main.locator('#recovery-confirm').check();
    await main.locator('[data-action="finish-onboarding"]').click();
    await main.evaluate(async ({ password, pattern }) => {
      const response = await window.nocturne.saveNote({ title: 'Маршрут на север', body: 'Позвонить хозяину дома до восьми.' });
      if (!response.ok) throw new Error(response.error);
      const entry = await window.nocturne.saveEntry({ title: 'Почта', username: 'owner@example.com', password: 'test-secret', folderId: 'personal' });
      if (!entry.ok) throw new Error(entry.error);
      const otp = await window.nocturne.importOtpUri('otpauth://totp/Nocturne%20Test:owner@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Nocturne%20Test');
      if (!otp.ok) throw new Error(otp.error);
      const configured = await window.nocturne.configureQuickUnlock('pattern', pattern, password);
      if (!configured.ok) throw new Error(configured.error);
    }, { password, pattern: '0-1-2-5-8' });
    const clipboardSample = `Текст из системного буфера ${Date.now()}`;
    await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardSample);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await electronApp.evaluate(({ clipboard, nativeImage }, imagePath) => clipboard.writeImage(nativeImage.createFromPath(imagePath)), path.resolve(__dirname, '..', 'assets', 'nocturne.png'));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const ownedSecret = `nocturne-owned-secret-${Date.now()}`;
    await main.evaluate(async (secret) => {
      const response = await window.nocturne.copySecurely(secret, 120);
      if (!response.ok) throw new Error(response.error);
    }, ownedSecret);
    if (await electronApp.evaluate(({ clipboard }) => clipboard.readText()) !== ownedSecret) throw new Error('Secure clipboard write failed');
    const quickWindow = electronApp.waitForEvent('window');
    await main.evaluate(() => window.nocturne.close());
    const quick = await quickWindow;
    if (await electronApp.evaluate(({ clipboard }) => clipboard.readText()) === ownedSecret) throw new Error('Vault close did not clear owned secret clipboard data');
    quick.on('pageerror', (error) => console.error('Quick renderer error:', error.message));
    await quick.waitForLoadState('domcontentloaded');
    await quick.waitForSelector('.chevron', { state: 'attached' });

    await quick.evaluate(async () => {
      const response = await window.nocturneQuick.toggle();
      if (!response.ok || !response.data) throw new Error(response.error || 'Quick panel did not expand');
    });
    await quick.waitForSelector('.quick-root.is-expanded');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/quick/'))?.focus();
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    await quick.waitForSelector('.quick-pattern');
    if (await quick.locator('.unlock input').count()) throw new Error('Pattern quick unlock unexpectedly requested the master password');
    if (await quick.locator('[data-pattern-node]').count() !== 9) throw new Error('Pattern grid is incomplete');
    const centers = await quick.locator('[data-pattern-node]').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }));
    await quick.mouse.move(centers[0].x, centers[0].y);
    await quick.mouse.down();
    for (const index of [1, 2, 5, 8]) await quick.mouse.move(centers[index].x, centers[index].y, { steps: 4 });
    await quick.mouse.up();
    await quick.waitForSelector('.clip-row');
    if (!await quick.getByText('Документы', { exact: true }).count()) throw new Error('Quick documents tab is missing');
    if (await quick.locator('.rail-head').count()) throw new Error('Removed Quick branding header is still visible');
    if (!await quick.getByText('Коды', { exact: true }).count()) throw new Error('Quick OTP tab is missing');
    await quick.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-quick-clipboard.png') });

    await main.evaluate(async () => {
      const response = await window.nocturne.savePreferences({ locale: 'en', theme: 'dark' });
      if (!response.ok) throw new Error(response.error);
    });
    await quick.waitForFunction(() => document.documentElement.lang === 'en' && document.body.dataset.theme === 'dark');
    await quick.getByText('Screenshots', { exact: true }).waitFor();
    await quick.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-quick-dark-en.png') });
    await main.evaluate(async () => {
      const response = await window.nocturne.savePreferences({ locale: 'ru', theme: 'light' });
      if (!response.ok) throw new Error(response.error);
    });
    await quick.waitForFunction(() => document.documentElement.lang === 'ru' && document.body.dataset.theme === 'light');
    await quick.getByText('Скриншоты', { exact: true }).waitFor();

    await quick.getByText('Скриншоты', { exact: true }).click();
    await quick.locator('.shot').first().click();
    await quick.locator('.preview-actions button').first().click();
    await quick.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-quick-screenshot.png') });

    await quick.getByText('Пароли', { exact: true }).click();
    await quick.waitForSelector('.vault-index');
    await quick.locator('.vault-index button').first().click();
    await quick.locator('.secret-line button[aria-label="Безопасно скопировать логин"]').click();
    await electronApp.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/renderer/'));
      mainWindow?.show();
      mainWindow?.focus();
    });
    await quick.waitForSelector('.quick-root:not(.is-expanded)');
    await new Promise((resolve) => setTimeout(resolve, 260));
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/renderer/'))?.hide();
    });
    await quick.locator('.chevron').click({ force: true });
    await new Promise((resolve) => setTimeout(resolve, 320));
    if (await quick.locator('.unlock').count()) throw new Error('Quick authorization was lost after copy and focus change');
    await quick.waitForSelector('.secret-line button[aria-label="Безопасно скопировать пароль"]');
    await quick.locator('.secret-line button[aria-label="Безопасно скопировать пароль"]').click();
    await quick.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-quick-passwords.png') });
    await quick.getByText('Коды', { exact: true }).click();
    await quick.waitForSelector('.otp-quick__row');
    if (!/^\d{3} \d{3}$/.test((await quick.locator('.otp-quick__code').first().textContent()).trim())) throw new Error('Quick TOTP code was not rendered');
    await quick.locator('.otp-quick__row').first().click();
    await quick.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-quick-otp.png') });
    const destroySecret = `destroy-owned-secret-${Date.now()}`;
    await main.evaluate(async ({ password: currentPassword, secret }) => {
      const copied = await window.nocturne.copySecurely(secret, 120);
      if (!copied.ok) throw new Error(copied.error);
      const destroyed = await window.nocturne.destroyVault(currentPassword);
      if (!destroyed.ok) throw new Error(destroyed.error);
    }, { password, secret: destroySecret });
    if (await electronApp.evaluate(({ clipboard }) => clipboard.readText()) === destroySecret) throw new Error('Vault destruction did not clear owned secret clipboard data');
    console.log('Quick UI smoke test passed');
  } finally {
    await electronApp.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
