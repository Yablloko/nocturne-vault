const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('панель не показывает шаблонную шапку Quick, а трей не дублирует её запуск', () => {
  const quick = source('src/quick/quick.jsx');
  const main = source('src/main.js');
  assert.equal(quick.includes('rail-head'), false);
  assert.equal(main.includes("{ label: 'Быстрый доступ', click: showQuick }"), false);
  assert.equal(main.includes('hideMainToBackground()'), true);
});

test('экран TOTP не содержит лишнюю промо-разметку, а раздел стоит последним в медианавигации', () => {
  const renderer = source('src/renderer/app.js');
  const styles = source('src/renderer/styles.css');
  const mainShell = renderer.slice(renderer.indexOf('function renderMain()'), renderer.indexOf('function renderCurrentPage()'));
  const otpPage = renderer.slice(renderer.indexOf('function renderOtpPage()'), renderer.indexOf('async function refreshOtpCodes()'));
  assert.equal(mainShell.includes('sidebar-brand__icon'), false);
  assert.ok(mainShell.indexOf("navButton('documents'") < mainShell.indexOf("navButton('otp'"));
  assert.equal(mainShell.includes("state.page === 'otp' ?"), false);
  assert.equal(otpPage.includes('RFC 6238'), false);
  assert.equal(otpPage.includes('Секреты хранятся'), false);
  assert.equal(styles.match(/\.otp-intro \{([^}]*)\}/s)[1].includes('border-bottom'), false);
  assert.equal(styles.match(/\.otp-list \{([^}]*)\}/s)[1].includes('border-top'), false);
});

test('TOTP-секреты исключены из истории буфера', () => {
  const main = source('src/main.js');
  assert.match(main, /\^otpauth\(\?:-migration\)\?:/);
  assert.match(main, /decodeOtpQrImage\(image\)/);
  assert.match(main, /clipboard\.clear\(\)/);
});
