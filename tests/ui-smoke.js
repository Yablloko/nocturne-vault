const { _electron: electron } = require('playwright');
const electronExecutable = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-ui-test-'));
  const packagedExecutable = process.env.NOCTURNE_ELECTRON_EXE;
  const electronApp = await electron.launch({
    executablePath: packagedExecutable || electronExecutable,
    args: packagedExecutable ? [] : ['.'],
    env: { ...process.env, NOCTURNE_TEST_USER_DATA: tempUserData },
  });
  try {
    const window = await electronApp.firstWindow();
    window.on('pageerror', (error) => console.error('Renderer error:', error.message));
    await window.waitForSelector('#create-form');
    const title = await window.locator('h1').textContent();
    if (title !== 'Создание хранилища') throw new Error(`Unexpected onboarding title: ${title}`);
    await window.locator('[data-toggle-password="password"]').click();
    if (await window.locator('#create-form input[name="password"]').getAttribute('type') !== 'text') throw new Error('Password visibility button failed');
    await window.locator('[data-toggle-password="password"]').click();
    await fs.mkdir(path.join(process.cwd(), 'artifacts'), { recursive: true });
    await window.screenshot({ path: path.join(process.cwd(), 'artifacts', 'nocturne-onboarding.png') });
    await window.locator('#create-form input[name="password"]').fill('Тестовая мастер фраза 2026 года');
    await window.locator('#create-form input[name="confirm"]').fill('Тестовая мастер фраза 2026 года');
    await window.locator('#create-form button[type="submit"]').click();
    await window.waitForSelector('.recovery-key');
    await window.screenshot({ path: path.join(process.cwd(), 'artifacts', 'nocturne-recovery.png') });
    await window.locator('#recovery-confirm').check();
    await window.locator('[data-action="finish-onboarding"]').click();
    await window.waitForSelector('.app-shell');
    await window.locator('[data-action="new-entry"]').click();
    await window.screenshot({ path: path.join(process.cwd(), 'artifacts', 'nocturne-entry-dialog.png') });
    await window.locator('#entry-form input[name="title"]').fill('Рабочая почта');
    await window.locator('#entry-form input[name="username"]').fill('hello@example.test');
    await window.locator('#entry-form input[name="password"]').fill('Local-Test-Password-2026!');
    await window.locator('#entry-form input[name="url"]').fill('mail.example.test');
    await window.locator('#entry-form textarea[name="notes"]').fill('Тестовая запись для проверки интерфейса.');
    await window.locator('#entry-form').evaluate((form) => form.requestSubmit());
    await window.waitForFunction(() => !document.querySelector('#entry-dialog')?.open || Boolean(document.querySelector('.toast--danger')));
    if (await window.locator('#entry-dialog').evaluate((dialog) => dialog.open)) {
      throw new Error(`Entry save failed: ${await window.locator('.toast--danger').textContent()}`);
    }
    await window.screenshot({ path: path.join(process.cwd(), 'artifacts', 'nocturne-dashboard.png') });
    await window.locator('[data-page="otp"]').click();
    await window.locator('[data-action="new-otp"]').first().click();
    await window.locator('[data-action="otp-uri"]').click();
    await window.locator('#otp-uri-form textarea[name="uri"]').fill('otpauth://totp/Nocturne%20Test:owner@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Nocturne%20Test');
    await window.locator('#otp-uri-form button[type="submit"]').click();
    await window.waitForSelector('.otp-row');
    if (!/^\d{3} \d{3}$/.test((await window.locator('[data-otp-code]').first().textContent()).trim())) throw new Error('TOTP code was not rendered');
    await window.screenshot({ path: path.join(process.cwd(), 'artifacts', 'nocturne-otp.png') });
    await window.locator('[data-page="documents"]').click();
    await window.waitForSelector('.document-workspace');
    if (!await window.getByText('Документов пока нет', { exact: true }).count()) throw new Error('Documents empty state is missing');
    await window.locator('[data-page="media"]').click();
    await window.waitForSelector('.media-filter');
    for (const label of ['Все', 'Фото', 'Видео', 'Аудио']) {
      if (!await window.locator('.media-filter button').filter({ hasText: label }).count()) throw new Error(`Missing media filter: ${label}`);
    }
    await window.locator('[data-page="notes"]').click();
    await window.locator('[data-action="new-note"]').click();
    await window.locator('#note-form input[name="title"]').fill('Маршрут на север');
    await window.locator('#note-form textarea[name="body"]').fill('Позвонить хозяину дома до восьми.\n\nПроверить документы и сохранить адрес офлайн.');
    await window.locator('#note-form button[type="submit"]').click();
    await window.waitForSelector('.note-sheet');
    if (await window.getByText('Изменено', { exact: true }).count()) throw new Error('Notes UI still shows the removed Modified column');
    await electronApp.evaluate(({ clipboard, nativeImage }, imagePath) => clipboard.writeImage(nativeImage.createFromPath(imagePath)), path.join(process.cwd(), 'assets', 'nocturne.png'));
    await window.locator('[data-paste-note]').click();
    await window.waitForSelector('.note-photo-strip img');
    await window.locator('.note-photo-strip figure').click();
    await window.waitForSelector('.media-actionbar');
    for (const label of ['Копировать', 'Сохранить на ПК', 'Переименовать', 'Удалить']) {
      if (!await window.locator('.media-actionbar').getByText(label, { exact: true }).count()) throw new Error(`Missing media action: ${label}`);
    }
    if (await window.locator('.media-actionbar').getByText('Поделиться', { exact: true }).count()) throw new Error('Duplicate Share action must not be present');
    await window.evaluate(() => window.nocturne.lock());
    await window.waitForSelector('#unlock-form');
    if (await window.locator('#media-dialog').evaluate((dialog) => dialog.open)) throw new Error('Sensitive media dialog survived vault lock');
    if (await window.locator('#media-dialog-content').textContent()) throw new Error('Sensitive media content survived vault lock');
    await window.locator('#unlock-form input[name="credential"]').fill('Тестовая мастер фраза 2026 года');
    await window.locator('#unlock-form button[type="submit"]').click();
    await window.waitForSelector('.app-shell');
    await window.screenshot({ path: path.join(process.cwd(), 'artifacts', 'nocturne-notes.png') });
    await window.locator('[data-page="settings"]').click();
    await window.waitForSelector('.settings-section-nav');
    await window.waitForTimeout(260);
    await window.screenshot({ path: path.join(process.cwd(), 'artifacts', 'nocturne-settings.png') });
    await window.locator('[data-settings-section="access"]').click();
    await window.waitForSelector('[data-action="configure-quick"]');
    await window.locator('[data-action="configure-quick"]').click();
    await window.locator('[data-action="quick-pin"]').click();
    await window.locator('#quick-pin-form input[name="pin"]').fill('12ab34cd56');
    if (await window.locator('#quick-pin-form input[name="pin"]').inputValue() !== '123456') throw new Error('PIN field accepted non-digits');
    await window.locator('[data-close-dialog="simple-dialog"]').click();
    await window.locator('[data-action="configure-quick"]').click();
    await window.locator('[data-action="quick-pattern"]').click();
    await window.locator('#pattern-reauth-form input[name="currentPassword"]').fill('Тестовая мастер фраза 2026 года');
    await window.locator('#pattern-reauth-form button[type="submit"]').click();
    await window.waitForSelector('[data-pattern-context="enroll-first"]');
    await drawPattern(window, [0, 1, 4, 7, 8]);
    await window.waitForSelector('[data-pattern-context="enroll-confirm"]');
    await window.screenshot({ path: path.join(process.cwd(), 'artifacts', 'nocturne-pattern.png') });
    if (await window.locator('[data-action="pattern-config-save"], [data-action="reset-pattern"]').count()) throw new Error('Pattern setup still has manual action buttons');
    await drawPattern(window, [0, 1, 4, 7, 8]);
    await window.locator('#simple-dialog').waitFor({ state: 'hidden' });
    await window.waitForSelector('.settings-layout');
    await window.locator('[data-action="lock"]').click();
    await window.waitForSelector('#pattern-unlock-form [data-pattern-surface]', { state: 'visible' });
    await window.locator('[data-pattern-surface]:visible [data-pattern-node]').first().waitFor({ state: 'visible' });
    await window.screenshot({ path: path.join(process.cwd(), 'artifacts', 'nocturne-pattern-lock.png') });
    if (await window.locator('#pattern-unlock-form button[type="submit"], [data-action="reset-pattern"]').count()) throw new Error('Pattern unlock still has manual action buttons');
    await drawPattern(window, [0, 1, 4, 7, 8]);
    await window.waitForSelector('.app-shell');
    console.log('UI smoke test passed');
  } finally {
    await electronApp.close();
    await fs.rm(tempUserData, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function drawPattern(window, indexes) {
  const nodes = window.locator('[data-pattern-surface]:visible [data-pattern-node]');
  const first = await nodes.nth(indexes[0]).boundingBox();
  await window.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await window.mouse.down();
  for (const index of indexes.slice(1)) {
    const box = await nodes.nth(index).boundingBox();
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  }
  await window.mouse.up();
}
