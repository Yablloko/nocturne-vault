const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ActivityService, HISTORY_LIMIT } = require('../src/services/activity-service');

test('локальная история зашифрована, ограничена и поддерживает очистку', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-activity-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const protector = { protect: (value) => Buffer.from(value), unprotect: (value) => Buffer.from(value) };
  const service = new ActivityService(root, protector);
  await service.initialize();

  for (let index = 0; index < HISTORY_LIMIT + 4; index += 1) await service.addText(`private clipboard ${index}`);
  const png = Buffer.from('fake-png-private-marker');
  await service.addScreenshot(png);
  const snapshot = service.getSnapshot();
  assert.equal(snapshot.clipboard.length, HISTORY_LIMIT);
  assert.equal(snapshot.clipboard[0].text, `private clipboard ${HISTORY_LIMIT + 3}`);
  assert.equal(snapshot.screenshots.length, 1);

  const raw = await fs.readFile(service.containerPath, 'utf8');
  assert.equal(raw.includes('private clipboard'), false);
  const shot = await fs.readFile(path.join(service.shotsDir, `${snapshot.screenshots[0].id}.nvs`));
  assert.equal(shot.includes(png), false);
  assert.deepEqual(await service.getScreenshot(snapshot.screenshots[0].id), png);

  await service.clear('clipboard');
  await service.clear('screenshots');
  assert.deepEqual(service.getSnapshot(), { clipboard: [], screenshots: [] });

  await service.addText('будет уничтожено вместе со старым ключом');
  const previousKey = Buffer.from(service.key);
  await service.destroyAndReset();
  assert.deepEqual(service.getSnapshot(), { clipboard: [], screenshots: [] });
  assert.notDeepEqual(service.key, previousKey);
});
