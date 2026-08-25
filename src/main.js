const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, powerMonitor, protocol, safeStorage, screen, Tray } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { VaultService } = require('./services/vault-service');
const { ActivityService } = require('./services/activity-service');
const { parseByteRange } = require('./services/media-range');
const { purgeLegacyTemporaryExports } = require('./services/legacy-temp-cleanup');
const { decodeOtpQrImage, parseOtpAuthUri } = require('./services/otp-service');

protocol.registerSchemesAsPrivileged([
  { scheme: 'vaultmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'quickshot', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

let mainWindow;
let quickWindow;
let tray;
let vault;
let activity;
let clipboardTimer;
let clipboardImageTimer;
let clipboardMonitor;
let ignoredClipboardText = null;
let lastClipboardText = '';
let lastImageHash = '';
let isQuitting = false;
let quickExpanded = false;
let quickBoundsTimer;

if (process.env.NOCTURNE_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.NOCTURNE_TEST_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();

const assetPath = (file) => path.join(__dirname, '..', 'assets', file);
const rendererPath = (file) => path.join(__dirname, 'renderer', file);
const quickPath = (file) => path.join(__dirname, 'quick', file);

function showMain() {
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (quickWindow?.isVisible()) {
    quickExpanded = false;
    quickWindow.webContents.send('quick:expanded', false);
    quickWindow.hide();
  }
}

function hideMainToBackground() {
  mainWindow?.hide();
  showQuick();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240, height: 800, minWidth: 980, minHeight: 680, show: false, frame: false,
    icon: assetPath('nocturne.png'), backgroundColor: '#f2f1ed', title: 'Nocturne Vault',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged, webviewTag: false, spellcheck: false },
  });
  mainWindow.loadFile(rendererPath('index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file://')) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideMainToBackground();
  });
  mainWindow.on('minimize', () => { if (vault?.isUnlocked() && vault.payload.settings.lockOnMinimize) lockVault('minimize'); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function collapsedBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 62;
  return { x: Math.round(display.workArea.x + (display.workArea.width - width) / 2), y: display.workArea.y, width, height: 30 };
}

function expandedBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = Math.min(820, display.workArea.width - 32);
  const height = Math.min(510, display.workArea.height - 32);
  return { x: Math.round(display.workArea.x + (display.workArea.width - width) / 2), y: display.workArea.y, width, height };
}

function setQuickExpanded(expanded) {
  clearTimeout(quickBoundsTimer);
  quickExpanded = Boolean(expanded);
  if (!quickWindow || quickWindow.isDestroyed()) return;
  if (quickExpanded) {
    // Resize the transparent hit area first, then let Chromium perform the visible
    // motion. Repeated native setBounds calls made the centered chevron jitter.
    quickWindow.setBounds(expandedBounds());
    quickWindow.webContents.send('quick:expanded', true);
  } else {
    quickWindow.webContents.send('quick:expanded', false);
    quickBoundsTimer = setTimeout(() => {
      if (!quickExpanded && quickWindow && !quickWindow.isDestroyed()) quickWindow.setBounds(collapsedBounds());
    }, 230);
  }
  if (!quickExpanded && !mainWindow?.isVisible()) lockVault('quick');
}

function createQuickWindow() {
  if (quickWindow && !quickWindow.isDestroyed()) return quickWindow;
  quickWindow = new BrowserWindow({
    ...collapsedBounds(), show: false, frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: true, roundedCorners: false,
    webPreferences: { preload: quickPath('preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged, spellcheck: false },
  });
  quickWindow.setAlwaysOnTop(true, 'pop-up-menu');
  quickWindow.loadFile(quickPath('index.html'));
  quickWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  quickWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file://')) event.preventDefault(); });
  quickWindow.on('blur', () => { if (quickExpanded) setQuickExpanded(false); });
  quickWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); setQuickExpanded(false); quickWindow.hide(); } });
  quickWindow.on('closed', () => { quickWindow = null; });
  return quickWindow;
}

function showQuick() {
  const window = createQuickWindow();
  clearTimeout(quickBoundsTimer);
  window.setBounds(collapsedBounds());
  quickExpanded = false;
  window.show();
  window.moveTop();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(assetPath('nocturne.ico')));
  tray.setToolTip('Nocturne Vault');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Nocturne', click: showMain },
    { type: 'separator' },
    { label: 'Завершить работу', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', showMain);
}

function lockVault(reason = 'manual') {
  if (!vault?.isUnlocked()) return;
  vault.lock();
  mainWindow?.webContents.send('vault:locked', { reason, quickUnlockAvailable: Boolean(vault.sessionQuickWrap) });
  quickWindow?.webContents.send('quick:vault-locked');
}

function safeHandle(channel, handler) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try { return { ok: true, data: await handler(...args) }; }
    catch (error) { console.error(`[${channel}]`, error.message); return { ok: false, error: error.message || 'UNKNOWN_ERROR' }; }
  });
}

function notifyActivity() { quickWindow?.webContents.send('quick:activity', activity.getSnapshot()); }

function writeTextToClipboard(text, clearAfterSeconds = 0) {
  clearTimeout(clipboardTimer);
  const value = String(text || '');
  ignoredClipboardText = value;
  lastClipboardText = value;
  clipboard.writeText(value);
  if (clearAfterSeconds > 0) {
    clipboardTimer = setTimeout(() => {
      if (clipboard.readText() === value) { clipboard.clear(); lastClipboardText = ''; }
    }, Math.max(5, Number(clearAfterSeconds) || 30) * 1000);
  }
}

function writeImageToClipboard(buffer, clearAfterSeconds = 0) {
  clearTimeout(clipboardImageTimer);
  const image = nativeImage.createFromBuffer(Buffer.from(buffer));
  const png = image.toPNG();
  const writtenHash = crypto.createHash('sha256').update(png).digest('hex');
  lastImageHash = writtenHash;
  clipboard.writeImage(image);
  if (clearAfterSeconds > 0) {
    clipboardImageTimer = setTimeout(() => {
      const current = clipboard.readImage();
      if (!current.isEmpty() && crypto.createHash('sha256').update(current.toPNG()).digest('hex') === writtenHash) {
        clipboard.clear();
        if (lastImageHash === writtenHash) lastImageHash = '';
      }
    }, Math.max(5, Number(clearAfterSeconds) || 30) * 1000);
  }
}

async function saveBufferToComputer(ownerWindow, buffer, name, title = 'Сохранить файл') {
  const result = await dialog.showSaveDialog(ownerWindow, { title, defaultPath: name });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, buffer, { mode: 0o600 });
  return { saved: true, filePath: result.filePath };
}

function startClipboardMonitor() {
  lastClipboardText = clipboard.readText();
  const initialImage = clipboard.readImage();
  lastImageHash = initialImage.isEmpty() ? '' : crypto.createHash('sha256').update(initialImage.toPNG()).digest('hex');
  clipboardMonitor = setInterval(async () => {
    try {
      const text = clipboard.readText();
      if (text !== lastClipboardText) {
        lastClipboardText = text;
        const containsOtpSecret = /^otpauth(?:-migration)?:\/\//i.test(text.trim());
        if (text && !containsOtpSecret && text !== ignoredClipboardText && await activity.addText(text)) notifyActivity();
        if (text === ignoredClipboardText) ignoredClipboardText = null;
      }
      const image = clipboard.readImage();
      const png = image.isEmpty() ? null : image.toPNG();
      const hash = png ? crypto.createHash('sha256').update(png).digest('hex') : '';
      if (hash && hash !== lastImageHash) {
        lastImageHash = hash;
        let containsOtpSecret = false;
        try { decodeOtpQrImage(image); containsOtpSecret = true; } catch {}
        if (!containsOtpSecret && await activity.addScreenshot(png)) notifyActivity();
      } else if (!hash) lastImageHash = '';
    } catch (error) { console.error('[clipboard-monitor]', error.message); }
  }, 700);
}

function registerIpc() {
  safeHandle('app:bootstrap', async () => ({ version: app.getVersion(), exists: vault.exists(), unlocked: vault.isUnlocked(), snapshot: vault.isUnlocked() ? vault.getSnapshot() : null, quickUnlockAvailable: Boolean(vault.sessionQuickWrap) }));
  safeHandle('vault:create', async (password) => { const created = await vault.create(password); quickWindow?.webContents.send('quick:vault-created'); return created; });
  safeHandle('vault:unlock', (password) => vault.unlockWithPassword(password));
  safeHandle('vault:recover', (key) => vault.unlockWithRecovery(key));
  safeHandle('vault:quick-unlock', ({ mode, credential }) => vault.quickUnlock(mode, credential));
  safeHandle('vault:lock', async () => { lockVault('manual'); return true; });
  safeHandle('vault:snapshot', async () => vault.getSnapshot());
  safeHandle('vault:save-entry', (entry) => vault.saveEntry(entry));
  safeHandle('vault:delete-entry', (id) => vault.deleteEntry(id));
  safeHandle('vault:save-note', (note) => vault.saveNote(note));
  safeHandle('vault:delete-note', (id) => vault.deleteNote(id));
  safeHandle('vault:save-otp', (entry) => vault.saveOtpAccount(entry));
  safeHandle('vault:delete-otp', (id) => vault.deleteOtpAccount(id));
  safeHandle('vault:otp-codes', () => vault.getOtpCodes());
  safeHandle('vault:import-otp-uri', async (uri) => {
    const value = String(uri || '').trim();
    const snapshot = await vault.importOtpUri(value);
    if (clipboard.readText().trim() === value) {
      clipboard.clear();
      ignoredClipboardText = null;
      lastClipboardText = '';
    }
    return snapshot;
  });
  safeHandle('vault:import-otp-clipboard', async () => {
    const text = clipboard.readText().trim();
    const parsed = text.startsWith('otpauth://') ? parseOtpAuthUri(text) : decodeOtpQrImage(clipboard.readImage());
    const snapshot = await vault.saveOtpAccount(parsed);
    clipboard.clear();
    ignoredClipboardText = null;
    lastClipboardText = '';
    lastImageHash = '';
    return { snapshot, imported: { issuer: parsed.issuer, account: parsed.account } };
  });
  safeHandle('vault:import-otp-qr', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Импортировать QR-код TOTP', properties: ['openFile'], filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const parsed = decodeOtpQrImage(nativeImage.createFromPath(result.filePaths[0]));
    return { snapshot: await vault.saveOtpAccount(parsed), imported: { issuer: parsed.issuer, account: parsed.account } };
  });
  safeHandle('vault:add-folder', (name) => vault.addFolder(name));
  safeHandle('vault:save-settings', (settings) => vault.saveSettings(settings));
  safeHandle('vault:verify-master-password', (password) => vault.verifyMasterPassword(password));
  safeHandle('vault:quick-configure', ({ mode, credential, currentPassword }) => vault.configureQuickUnlock(mode, credential, currentPassword));
  safeHandle('vault:change-master-password', ({ currentPassword, newPassword }) => vault.changeMasterPassword(currentPassword, newPassword));
  safeHandle('vault:destroy', async () => { await vault.destroyVault(); return true; });
  safeHandle('vault:import-media', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Добавить в защищённую медиатеку', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Фото, видео и аудио', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov', 'm4v', 'mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac'] }] });
    return result.canceled ? { canceled: true } : vault.importMedia(result.filePaths);
  });
  safeHandle('vault:import-documents', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Добавить в защищённые документы', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Документы', extensions: ['pdf', 'txt', 'md', 'rtf', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'] }] });
    return result.canceled ? { canceled: true } : vault.importDocuments(result.filePaths);
  });
  safeHandle('vault:import-note-photos', async (noteId) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Прикрепить фото к заметке', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
    return result.canceled ? { canceled: true } : vault.importNoteAttachments(noteId, result.filePaths);
  });
  safeHandle('vault:import-note-clipboard', async (noteId) => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return { empty: true };
    return { snapshot: await vault.importNoteImageBuffer(noteId, image.toPNG()) };
  });
  safeHandle('vault:delete-media', (id) => vault.deleteMedia(id));
  safeHandle('vault:rename-media', ({ id, name }) => vault.renameMedia(id, name));
  safeHandle('vault:save-media', async (id) => {
    const media = await vault.getMedia(id);
    try { return await saveBufferToComputer(mainWindow, media.buffer, media.name, 'Сохранить расшифрованную копию'); }
    finally { media.buffer.fill(0); }
  });
  safeHandle('vault:preview-document', async (id) => {
    const item = vault.payload.media.find((media) => media.id === id && media.kind === 'document');
    if (!item) throw new Error('DOCUMENT_NOT_FOUND');
    if (!['text/plain', 'text/markdown', 'text/csv'].includes(item.type)) throw new Error('DOCUMENT_PREVIEW_UNSUPPORTED');
    const media = await vault.getMedia(id);
    try {
      if (media.buffer.length > 5 * 1024 * 1024) throw new Error('DOCUMENT_PREVIEW_TOO_LARGE');
      return { id, name: media.name, type: media.mime, text: media.buffer.toString('utf8') };
    } finally { media.buffer.fill(0); }
  });
  safeHandle('vault:copy-media', async (id) => {
    const media = await vault.getMedia(id);
    if (!media.mime.startsWith('image/')) throw new Error('MEDIA_COPY_UNSUPPORTED');
    try { writeImageToClipboard(media.buffer, vault.payload.settings.clipboardSeconds); return true; }
    finally { media.buffer.fill(0); }
  });
  safeHandle('vault:save-recovery-key', async (recoveryKey) => {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Сохранить ключ восстановления', defaultPath: 'Nocturne-Recovery-Key.txt', filters: [{ name: 'Текстовый файл', extensions: ['txt'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, ['NOCTURNE VAULT — КЛЮЧ ВОССТАНОВЛЕНИЯ', '', recoveryKey, '', 'Храните этот файл отдельно от компьютера с хранилищем.', 'Любой человек с этим ключом и контейнером сможет получить доступ к данным.'].join('\r\n'), { mode: 0o600 });
    return { saved: true };
  });
  safeHandle('clipboard:write', async ({ text, clearAfterSeconds }) => {
    writeTextToClipboard(text, clearAfterSeconds);
    return true;
  });
  safeHandle('window:minimize', async () => mainWindow?.minimize());
  safeHandle('window:maximize', async () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); return Boolean(mainWindow?.isMaximized()); });
  safeHandle('window:close', async () => hideMainToBackground());

  safeHandle('quick:bootstrap', async () => ({ expanded: quickExpanded, activity: activity.getSnapshot(), vaultExists: vault.exists() }));
  safeHandle('quick:toggle', async () => { setQuickExpanded(!quickExpanded); return quickExpanded; });
  safeHandle('quick:collapse', async () => { setQuickExpanded(false); return true; });
  safeHandle('quick:delete', ({ section, id }) => activity.deleteItem(section, id));
  safeHandle('quick:clear', (section) => activity.clear(section));
  safeHandle('quick:copy', async (text) => { writeTextToClipboard(text); return true; });
  safeHandle('quick:copy-secret', async (text) => { writeTextToClipboard(text, vault.payload?.settings.clipboardSeconds || 30); return true; });
  safeHandle('quick:copy-screenshot', async (id) => { writeImageToClipboard(await activity.getScreenshot(id)); return true; });
  safeHandle('quick:save-screenshot', async (id) => saveBufferToComputer(quickWindow, await activity.getScreenshot(id), `Скриншот-${id.slice(0, 8)}.png`, 'Сохранить скриншот'));
  safeHandle('quick:unlock-vault', async (password) => vault.unlockWithPassword(password));
  safeHandle('quick:delete-note', (id) => vault.deleteNote(id));
  safeHandle('quick:otp-codes', () => vault.getOtpCodes());
  safeHandle('quick:copy-media', async (id) => { const media = await vault.getMedia(id); if (!media.mime.startsWith('image/')) throw new Error('MEDIA_COPY_UNSUPPORTED'); try { writeImageToClipboard(media.buffer, vault.payload.settings.clipboardSeconds); return true; } finally { media.buffer.fill(0); } });
  safeHandle('quick:save-media', async (id) => { const media = await vault.getMedia(id); try { return await saveBufferToComputer(quickWindow, media.buffer, media.name); } finally { media.buffer.fill(0); } });
  safeHandle('quick:preview-document', async (id) => {
    const item = vault.payload.media.find((media) => media.id === id && media.kind === 'document');
    if (!item) throw new Error('DOCUMENT_NOT_FOUND');
    if (!['text/plain', 'text/markdown', 'text/csv'].includes(item.type)) throw new Error('DOCUMENT_PREVIEW_UNSUPPORTED');
    const media = await vault.getMedia(id);
    try {
      if (media.buffer.length > 1024 * 1024) throw new Error('DOCUMENT_PREVIEW_TOO_LARGE');
      return { id, name: media.name, type: media.mime, text: media.buffer.toString('utf8') };
    } finally { media.buffer.fill(0); }
  });
  safeHandle('quick:open-main', async () => { showMain(); return true; });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.nocturne.vault');
  vault = new VaultService(path.join(app.getPath('userData'), 'vault-data'));
  await purgeLegacyTemporaryExports({
    tempRoot: app.getPath('temp'),
    secureDeleteFile: (file) => vault.secureDeleteFile(file),
    logger: console,
  });
  activity = new ActivityService(path.join(app.getPath('userData'), 'quick-data'), {
    protect: (buffer) => safeStorage.encryptString(Buffer.from(buffer).toString('base64')),
    unprotect: (buffer) => Buffer.from(safeStorage.decryptString(buffer), 'base64'),
  });
  await activity.initialize();
  vault.onWiped = async () => {
    await activity.destroyAndReset();
    mainWindow?.webContents.send('vault:wiped');
    quickWindow?.webContents.send('quick:vault-wiped');
    notifyActivity();
  };

  protocol.handle('vaultmedia', async (request) => {
    let media;
    try {
      media = await vault.getMedia(new URL(request.url).hostname);
      const size = media.buffer.length;
      const range = parseByteRange(request.headers.get('range'), size);
      const commonHeaders = { 'Content-Type': media.mime, 'Cache-Control': 'no-store, max-age=0', 'Accept-Ranges': 'bytes' };
      if (range?.invalid) {
        return new Response(null, { status: 416, headers: { ...commonHeaders, 'Content-Range': `bytes */${size}` } });
      }
      const contentLength = range ? range.end - range.start + 1 : size;
      const headers = { ...commonHeaders, 'Content-Length': String(contentLength), ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}) };
      if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
      const body = range ? Buffer.from(media.buffer.subarray(range.start, range.end + 1)) : Buffer.from(media.buffer);
      try { return new Response(body, { status: range ? 206 : 200, headers }); }
      finally { body.fill(0); }
    }
    catch { return new Response('Locked or missing', { status: 404 }); }
    finally { media?.buffer?.fill(0); }
  });
  protocol.handle('quickshot', async (request) => {
    try { return new Response(await activity.getScreenshot(new URL(request.url).hostname), { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store, max-age=0' } }); }
    catch { return new Response('Missing', { status: 404 }); }
  });

  registerIpc();
  createTray();
  createMainWindow();
  if (process.env.NOCTURNE_TEST_SHOW_QUICK) showQuick();
  startClipboardMonitor();
  powerMonitor.on('lock-screen', () => { if (vault?.payload?.settings.lockOnSystemLock) lockVault('system'); });
  powerMonitor.on('suspend', () => lockVault('system'));
  screen.on('display-metrics-changed', () => { if (quickWindow?.isVisible()) quickWindow.setBounds(quickExpanded ? expandedBounds() : collapsedBounds()); });
  app.on('activate', showMain);
});

app.on('second-instance', showMain);
app.on('before-quit', () => { isQuitting = true; clearInterval(clipboardMonitor); clearTimeout(clipboardTimer); clearTimeout(clipboardImageTimer); clearTimeout(quickBoundsTimer); vault?.lock({ preserveQuickUnlock: false }); });
app.on('window-all-closed', () => {});
