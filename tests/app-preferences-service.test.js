const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AppPreferencesService } = require('../src/services/app-preferences-service');

test('сохраняет переключатель быстрого доступа между запусками', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-preferences-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'app-preferences.json');
  const first = new AppPreferencesService(file);
  assert.equal((await first.initialize()).quickAccessEnabled, true);
  await first.setQuickAccessEnabled(false);
  await first.update({ locale: 'en', theme: 'dark' });
  const restarted = new AppPreferencesService(file);
  const snapshot = await restarted.initialize();
  assert.equal(snapshot.quickAccessEnabled, false);
  assert.equal(snapshot.locale, 'en');
  assert.equal(snapshot.theme, 'dark');
});

test('повреждённые настройки заменяются безопасными значениями по умолчанию', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-preferences-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'app-preferences.json');
  await fs.writeFile(file, '{broken');
  const preferences = new AppPreferencesService(file);
  assert.equal((await preferences.initialize()).quickAccessEnabled, true);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { quickAccessEnabled: true, locale: 'ru', theme: 'light' });
});
