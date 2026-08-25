const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { purgeLegacyTemporaryExports } = require('../src/services/legacy-temp-cleanup');

test('удаляет только файлы из каталогов старого формата и не трогает посторонние записи', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-legacy-cleanup-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const shareRoot = path.join(tempRoot, 'Nocturne Share');
  const exportDirectory = path.join(shareRoot, '0f3e3c8a-63ad-4d4e-a6dc-80fb06883651');
  const unrelated = path.join(shareRoot, 'not-a-nocturne-export');
  await fs.mkdir(exportDirectory, { recursive: true });
  await fs.mkdir(unrelated);
  await fs.writeFile(path.join(exportDirectory, 'document.txt'), 'secret');
  await fs.writeFile(path.join(unrelated, 'keep.txt'), 'keep');

  const deleted = [];
  const result = await purgeLegacyTemporaryExports({
    tempRoot,
    secureDeleteFile: async (file) => { deleted.push(file); await fs.unlink(file); },
    logger: { warn() {} },
  });

  assert.equal(result.removed, 1);
  assert.equal(deleted.length, 1);
  assert.equal(await fs.readFile(path.join(unrelated, 'keep.txt'), 'utf8'), 'keep');
});

test('отказывается следовать корневой ссылке или junction за пределы temp', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-legacy-link-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-outside-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const marker = path.join(outside, 'must-survive.txt');
  await fs.writeFile(marker, 'keep');
  try {
    await fs.symlink(outside, path.join(tempRoot, 'Nocturne Share'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') return t.skip('Создание junction запрещено политикой системы');
    throw error;
  }

  let deleteCalled = false;
  const result = await purgeLegacyTemporaryExports({
    tempRoot,
    secureDeleteFile: async () => { deleteCalled = true; },
    logger: { warn() {} },
  });
  assert.equal(result.refused, true);
  assert.equal(deleteCalled, false);
  assert.equal(await fs.readFile(marker, 'utf8'), 'keep');
});
