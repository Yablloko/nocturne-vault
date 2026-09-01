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
  assert.match(main, /isSensitiveOtpPayload\(text\)/);
  assert.match(main, /isSensitiveOtpPayload\(decodeQrPayload\(image\)\)/);
  assert.match(main, /clipboard\.clear\(\)/);
});

test('закрытие блокирует ключ, а IPC и навигация привязаны к своим окнам', () => {
  const main = source('src/main.js');
  assert.match(main, /function hideMainToBackground\(\) \{\s*lockVault\('background'\)/);
  assert.match(main, /event\.sender === expected\.webContents/);
  assert.match(main, /url !== allowedUrl/);
  assert.equal(main.includes("url.startsWith('file://')"), false);
});

test('таймер бездействия принадлежит main-процессу', () => {
  const main = source('src/main.js');
  const renderer = source('src/renderer/app.js');
  assert.match(main, /setTimeout\(\(\) => lockVault\('inactive'\)/);
  assert.match(renderer, /window\.nocturne\.recordActivity\(\)/);
  assert.equal(renderer.includes('state.lastActivity'), false);
});

test('уничтожение проходит через общую очистку чувствительной сессии', () => {
  const main = source('src/main.js');
  const wiped = main.slice(main.indexOf('vault.onWiped'), main.indexOf("protocol.handle('vaultmedia'"));
  assert.match(wiped, /resetSensitiveSessionState\(\)/);
  assert.match(main, /clearOwnedSensitiveClipboard\(\)/);
});

test('корень раздела не подменяется виртуальной папкой', () => {
  const renderer = source('src/renderer/app.js');
  assert.equal(renderer.includes('UNFILED_FOLDER_ID'), false);
  assert.equal(renderer.includes('folder-tile--unfiled'), false);
  assert.match(renderer, /data-explorer-root="passwords"/);
  assert.match(renderer, /data-explorer-root="media"/);
  assert.match(renderer, /data-explorer-root="documents"/);
});

test('просмотр медиатеки ограничен открытой папкой', () => {
  const renderer = source('src/renderer/app.js');
  const sequence = renderer.slice(renderer.indexOf('function mediaSequence'), renderer.indexOf('function stepMedia'));
  assert.match(sequence, /organizerItems\('media'\)/);
  assert.equal(sequence.includes('state.snapshot.media'), false);
});

test('папки и файлы медиатеки находятся в одной сетке', () => {
  const renderer = source('src/renderer/app.js');
  const page = renderer.slice(renderer.indexOf('function renderMediaPage'), renderer.indexOf('function documentExtension'));
  assert.equal(page.includes("folderShelf('media')"), false);
  assert.match(page, /media-grid media-grid--mixed/);
  assert.match(page, /folders\.map\(\(folder\) => folderTile\('media', folder, 'folder-tile--media'\)\)/);
  assert.match(page, /draggable="true"/);
});

test('папки заметок и документов находятся внутри списков', () => {
  const renderer = source('src/renderer/app.js');
  const documents = renderer.slice(renderer.indexOf('function renderDocumentsPage'), renderer.indexOf('function renderDocumentInspector'));
  const notes = renderer.slice(renderer.indexOf('function renderNotesPage'), renderer.indexOf('function renderNoteInspector'));
  assert.equal(documents.includes("folderShelf('documents')"), false);
  assert.equal(notes.includes("folderShelf('notes')"), false);
  assert.match(documents, /folderListRow\('documents', folder, 'documents'\)/);
  assert.match(notes, /folderListRow\('notes', folder, 'notes'\)/);
});

test('проводниковое выделение и перенос работают без полной перерисовки', () => {
  const renderer = source('src/renderer/app.js');
  assert.match(renderer, /className = 'selection-marquee'/);
  assert.match(renderer, /setPointerCapture/);
  assert.match(renderer, /application\/x-nocturne-selection/);
  assert.match(renderer, /moveFolders\(\{ ids: folderIds, parentId: folderId \}\)/);
  assert.match(renderer, /selectExplorerTarget\(section, 'item', id, event\.ctrlKey \|\| event\.metaKey, false\)/);
});

test('Escape выходит из папок во всех пяти разделах', () => {
  const renderer = source('src/renderer/app.js');
  assert.match(renderer, /new Set\(\['passwords', 'notes', 'media', 'documents', 'otp'\]\)/);
});

test('настройки собраны в четыре понятных раздела', () => {
  const renderer = source('src/renderer/app.js');
  const grouped = renderer.slice(renderer.indexOf('const groupedSections'), renderer.indexOf('const aliases'));
  for (const section of ['security:', 'application:', 'data:', 'help:']) assert.match(grouped, new RegExp(section));
});
