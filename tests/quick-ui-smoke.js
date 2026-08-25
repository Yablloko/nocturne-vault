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
    await main.evaluate(async () => {
      const response = await window.nocturne.saveNote({ title: 'Маршрут на север', body: 'Позвонить хозяину дома до восьми.' });
      if (!response.ok) throw new Error(response.error);
      const entry = await window.nocturne.saveEntry({ title: 'Почта', username: 'owner@example.com', password: 'test-secret', folderId: 'personal' });
      if (!entry.ok) throw new Error(entry.error);
      const otp = await window.nocturne.importOtpUri('otpauth://totp/Nocturne%20Test:owner@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Nocturne%20Test');
      if (!otp.ok) throw new Error(otp.error);
    });
    const clipboardSample = `Текст из системного буфера ${Date.now()}`;
    await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardSample);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await electronApp.evaluate(({ clipboard, nativeImage }, imagePath) => clipboard.writeImage(nativeImage.createFromPath(imagePath)), path.resolve(__dirname, '..', 'assets', 'nocturne.png'));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const quickWindow = electronApp.waitForEvent('window');
    await main.evaluate(() => window.nocturne.close());
    const quick = await quickWindow;
    quick.on('pageerror', (error) => console.error('Quick renderer error:', error.message));
    await quick.waitForLoadState('domcontentloaded');
    await quick.waitForSelector('.chevron', { state: 'attached' });

    await quick.locator('.chevron').click({ force: true });
    await new Promise((resolve) => setTimeout(resolve, 320));
    await quick.waitForSelector('.clip-row');
    if (!await quick.getByText('Документы', { exact: true }).count()) throw new Error('Quick documents tab is missing');
    if (await quick.locator('.rail-head').count()) throw new Error('Removed Quick branding header is still visible');
    if (!await quick.getByText('Коды', { exact: true }).count()) throw new Error('Quick OTP tab is missing');
    await quick.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-quick-clipboard.png') });

    await quick.getByText('Скриншоты', { exact: true }).click();
    await quick.locator('.shot').first().click();
    await quick.locator('.preview-actions button').first().click();
    await quick.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-quick-screenshot.png') });

    await quick.getByText('Пароли', { exact: true }).click();
    await quick.locator('.unlock input').fill(password);
    await quick.locator('.unlock button').click();
    await quick.locator('.vault-index button').first().click();
    await quick.locator('.secret-line button[aria-label="Безопасно скопировать пароль"]').click();
    await quick.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-quick-passwords.png') });
    await quick.getByText('Коды', { exact: true }).click();
    await quick.waitForSelector('.otp-quick__row');
    if (!/^\d{3} \d{3}$/.test((await quick.locator('.otp-quick__code').first().textContent()).trim())) throw new Error('Quick TOTP code was not rendered');
    await quick.locator('.otp-quick__row').first().click();
    await quick.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-quick-otp.png') });
    console.log('Quick UI smoke test passed');
  } finally {
    await electronApp.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
