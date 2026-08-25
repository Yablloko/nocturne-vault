const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('у документов нет скрытого экспорта во временную папку или запуска внешней программы', () => {
  const main = source('src/main.js');
  const preload = `${source('src/preload.js')}\n${source('src/quick/preload.js')}`;
  assert.equal(main.includes('shell.openPath'), false);
  assert.equal(main.includes("safeHandle('vault:open-document'"), false);
  assert.equal(main.includes("safeHandle('quick:open-document'"), false);
  assert.equal(preload.includes("invoke('vault:open-document'"), false);
  assert.equal(preload.includes("invoke('quick:open-document'"), false);
  assert.match(main, /vault:preview-document/);
  assert.match(main, /vault:save-media/);
});
