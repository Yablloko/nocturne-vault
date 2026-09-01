const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, powerMonitor, protocol, safeStorage, screen, session, shell, Tray } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { VaultService } = require('./services/vault-service');
const { ActivityService } = require('./services/activity-service');
const { parseByteRange } = require('./services/media-range');
const { purgeLegacyTemporaryExports } = require('./services/legacy-temp-cleanup');
const { decodeOtpQrImage, decodeQrPayload, isSensitiveOtpPayload, parseOtpAuthUri } = require('./services/otp-service');
const { extractOfficeText, extractRtfText, MODERN_OFFICE_MIMES, MAX_ARCHIVE_BYTES } = require('./services/document-preview-service');
const { AppPreferencesService } = require('./services/app-preferences-service');
const { WindowsAutostartService } = require('./services/windows-autostart-service');

protocol.registerSchemesAsPrivileged([
  { scheme: 'vaultmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'quickshot', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

let mainWindow;
let quickWindow;
let tray;
let vault;
let activity;
let appPreferences;
let autostart;
let clipboardTimer;
let clipboardImageTimer;
let clipboardMonitor;
let ignoredClipboardText = null;
let sensitiveClipboardOwnership = null;
let lastClipboardText = '';
let lastImageHash = '';
let isQuitting = false;
let quickExpanded = false;
let quickBoundsTimer;
let vaultSessionTimer;
let lastVaultActivity = 0;
let pendingExternalImports = [];
let screenCaptureActive = false;
const launchedAtStartup = process.argv.includes('--autostart');

if (process.env.NOCTURNE_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.NOCTURNE_TEST_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();

const assetPath = (file) => path.join(__dirname, '..', 'assets', file);
const rendererPath = (file) => path.join(__dirname, 'renderer', file);
const quickPath = (file) => path.join(__dirname, 'quick', file);

function commandLineImports(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const inline = typeof args[index] === 'string' && args[index].startsWith('--import=') ? args[index].slice('--import='.length) : null;
    const value = inline ?? (args[index] === '--import' && typeof args[index + 1] === 'string' ? args[++index] : null);
    if (!value) continue;
    const resolved = path.resolve(value.replace(/^"|"$/g, ''));
    if (!result.includes(resolved)) result.push(resolved);
  }
  return result.slice(0, 100);
}

function queueExternalImports(paths) {
  pendingExternalImports = [...new Set([...pendingExternalImports, ...paths.map((value) => path.resolve(value))])].slice(0, 100);
  showMain();
  mainWindow?.webContents.send('app:external-imports-pending', pendingExternalImports.length);
}

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
  lockVault('background');
  mainWindow?.hide();
  if (appPreferences?.snapshot().quickAccessEnabled !== false) showQuick();
}

function installNavigationGuards(window, entryPath) {
  const allowedUrl = pathToFileURL(entryPath).href;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== allowedUrl) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function applyPrivacySettings() {
  const enabled = vault?.payload?.settings.screenProtection !== false;
  for (const window of [mainWindow, quickWindow]) {
    if (window && !window.isDestroyed()) window.setContentProtection(enabled);
  }
  if (vault?.payload?.settings.blurOnFocusLoss === false) mainWindow?.webContents.send('privacy:conceal', false);
}

function createMainWindow(showOnReady = true) {
  mainWindow = new BrowserWindow({
    width: 1240, height: 800, minWidth: 980, minHeight: 680, show: false, frame: false,
    icon: assetPath('nocturne.png'), backgroundColor: '#f2f1ed', title: 'Nocturne Vault',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged, webviewTag: false, spellcheck: false },
  });
  const entryPath = rendererPath('index.html');
  mainWindow.loadFile(entryPath);
  installNavigationGuards(mainWindow, entryPath);
  mainWindow.setContentProtection(true);
  mainWindow.once('ready-to-show', () => { if (showOnReady) mainWindow.show(); });
  mainWindow.on('blur', () => {
    if (vault?.isUnlocked() && vault.payload.settings.blurOnFocusLoss !== false) mainWindow?.webContents.send('privacy:conceal', true);
  });
  mainWindow.on('focus', () => mainWindow?.webContents.send('privacy:conceal', false));
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
    quickWindow.setBounds(expandedBounds());
    quickWindow.webContents.send('quick:expanded', true);
  } else {
    quickWindow.webContents.send('quick:expanded', false);
    quickBoundsTimer = setTimeout(() => {
      if (!quickExpanded && quickWindow && !quickWindow.isDestroyed()) quickWindow.setBounds(collapsedBounds());
    }, 230);
  }
}

function createQuickWindow() {
  if (quickWindow && !quickWindow.isDestroyed()) return quickWindow;
  quickWindow = new BrowserWindow({
    ...collapsedBounds(), show: false, frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: true, roundedCorners: false,
    webPreferences: { preload: quickPath('preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged, spellcheck: false },
  });
  quickWindow.setAlwaysOnTop(true, 'pop-up-menu');
  quickWindow.setContentProtection(vault?.payload?.settings.screenProtection !== false);
  const entryPath = quickPath('index.html');
  quickWindow.loadFile(entryPath);
  installNavigationGuards(quickWindow, entryPath);
  quickWindow.on('blur', () => { if (quickExpanded) setQuickExpanded(false); });
  quickWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); setQuickExpanded(false); quickWindow.hide(); } });
  quickWindow.on('closed', () => { quickWindow = null; });
  return quickWindow;
}

function showQuick() {
  if (appPreferences?.snapshot().quickAccessEnabled === false) return;
  const window = createQuickWindow();
  clearTimeout(quickBoundsTimer);
  window.setBounds(collapsedBounds());
  quickExpanded = false;
  window.show();
  window.moveTop();
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const quickAccessEnabled = appPreferences?.snapshot().quickAccessEnabled !== false;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Nocturne', click: showMain },
    {
      label: quickAccessEnabled ? 'Отключить быстрый доступ' : 'Включить быстрый доступ',
      click: () => setQuickAccessEnabled(!quickAccessEnabled).catch((error) => console.error('[quick-access]', error.message)),
    },
    { type: 'separator' },
    { label: 'Завершить работу', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

async function setQuickAccessEnabled(enabled) {
  const next = Boolean(enabled);
  await appPreferences.setQuickAccessEnabled(next);
  if (!next) {
    setQuickExpanded(false);
    quickWindow?.hide();
  } else if (!mainWindow?.isVisible()) {
    showQuick();
  }
  refreshTrayMenu();
  return appPreferences.snapshot();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(assetPath('nocturne.ico')));
  tray.setToolTip('Nocturne Vault');
  refreshTrayMenu();
  tray.on('click', showMain);
}

function currentQuickUnlockMode() {
  const mode = vault?.sessionQuickWrap?.mode;
  return mode === 'pin' || mode === 'pattern' ? mode : 'password';
}

function lockVault(reason = 'manual') {
  if (!vault?.isUnlocked()) return;
  resetSensitiveSessionState();
  vault.lock();
  mainWindow?.webContents.send('vault:locked', { reason, quickUnlockAvailable: Boolean(vault.sessionQuickWrap), quickUnlockMode: currentQuickUnlockMode() });
  quickWindow?.webContents.send('quick:vault-locked', { quickUnlockMode: currentQuickUnlockMode() });
}

function resetSensitiveSessionState() {
  clearTimeout(vaultSessionTimer);
  vaultSessionTimer = null;
  lastVaultActivity = 0;
  clearOwnedSensitiveClipboard();
  ignoredClipboardText = null;
  try { lastClipboardText = clipboard.readText(); } catch { lastClipboardText = ''; }
}

function refreshVaultSession() {
  clearTimeout(vaultSessionTimer);
  vaultSessionTimer = null;
  if (!vault?.isUnlocked()) return;
  lastVaultActivity = Date.now();
  const minutes = Math.max(1, Math.min(120, Number(vault.payload.settings.autoLockMinutes) || 5));
  vaultSessionTimer = setTimeout(() => lockVault('inactive'), minutes * 60_000);
}

function trackSuccessfulUnlock(result) {
  if (result?.unlocked) {
    result = vault.getSnapshot();
    applyPrivacySettings();
    refreshVaultSession();
    notifyActivity();
  }
  return result;
}

function isTrustedSender(event, channel) {
  const expected = channel.startsWith('quick:') ? quickWindow : mainWindow;
  return Boolean(expected && !expected.isDestroyed() && event.sender === expected.webContents && event.senderFrame === event.sender.mainFrame);
}

function safeHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event, channel)) return { ok: false, error: 'UNAUTHORIZED_IPC_SENDER' };
    try { return { ok: true, data: await handler(...args) }; }
    catch (error) { console.error(`[${channel}]`, error.message); return { ok: false, error: error.message || 'UNKNOWN_ERROR' }; }
  });
}

function clearOwnedSensitiveClipboard() {
  const owned = sensitiveClipboardOwnership;
  sensitiveClipboardOwnership = null;
  clearTimeout(clipboardTimer);
  clearTimeout(clipboardImageTimer);
  clipboardTimer = null;
  clipboardImageTimer = null;
  if (!owned) return false;
  try {
    if (owned.format === 'text' && clipboard.readText() === owned.value) clipboard.clear();
    if (owned.format === 'image') {
      const current = clipboard.readImage();
      if (!current.isEmpty() && hashImage(current) === owned.hash) clipboard.clear();
    }
    return true;
  } catch { return false; }
}

function hashImage(image) {
  return crypto.createHash('sha256').update(image.toPNG()).digest('hex');
}

function safeClipboardPng(image) {
  if (!image || image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0 || width > 10_000 || height > 10_000 || width * height > 25_000_000) return null;
  const png = image.toPNG();
  return png.length <= 16 * 1024 * 1024 ? png : null;
}

function quickActivitySnapshot() {
  return vault?.isUnlocked() ? activity.getSnapshot() : { clipboard: [], screenshots: [] };
}

function notifyActivity() { quickWindow?.webContents.send('quick:activity', quickActivitySnapshot()); }

function requireQuickUnlock() {
  if (!vault?.isUnlocked()) throw new Error('VAULT_LOCKED');
}

function writeTextToClipboard(text, clearAfterSeconds = 0) {
  clearOwnedSensitiveClipboard();
  const value = String(text || '');
  ignoredClipboardText = value;
  lastClipboardText = value;
  clipboard.writeText(value);
  if (clearAfterSeconds > 0) {
    sensitiveClipboardOwnership = { format: 'text', value };
    clipboardTimer = setTimeout(() => {
      if (sensitiveClipboardOwnership?.format === 'text' && sensitiveClipboardOwnership.value === value) clearOwnedSensitiveClipboard();
      lastClipboardText = clipboard.readText();
    }, Math.max(5, Number(clearAfterSeconds) || 30) * 1000);
  }
}

function writeImageToClipboard(buffer, clearAfterSeconds = 0) {
  clearOwnedSensitiveClipboard();
  const image = nativeImage.createFromBuffer(Buffer.from(buffer));
  const png = image.toPNG();
  const writtenHash = crypto.createHash('sha256').update(png).digest('hex');
  lastImageHash = writtenHash;
  clipboard.writeImage(image);
  if (clearAfterSeconds > 0) {
    sensitiveClipboardOwnership = { format: 'image', hash: writtenHash };
    clipboardImageTimer = setTimeout(() => {
      if (sensitiveClipboardOwnership?.format === 'image' && sensitiveClipboardOwnership.hash === writtenHash) clearOwnedSensitiveClipboard();
      lastImageHash = '';
    }, Math.max(5, Number(clearAfterSeconds) || 30) * 1000);
  }
}

async function saveVaultMediaToComputer(ownerWindow, id, title = 'Сохранить расшифрованную копию') {
  const media = vault.getMediaInfo(id);
  const result = await dialog.showSaveDialog(ownerWindow, { title, defaultPath: media.name });
  if (result.canceled || !result.filePath) return { canceled: true };
  return vault.exportMedia(id, result.filePath);
}

async function saveBufferToComputer(ownerWindow, buffer, name, title = 'Сохранить файл') {
  const result = await dialog.showSaveDialog(ownerWindow, { title, defaultPath: name });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, buffer, { mode: 0o600 });
  return { saved: true, filePath: result.filePath };
}

async function importSelectedPaths(sources, requestedKind = 'auto', target = {}) {
  if (!vault.isUnlocked()) throw new Error('VAULT_LOCKED');
  const values = [];
  const seen = new Set();
  for (const source of Array.isArray(sources) ? sources : []) {
    const sourcePath = typeof source === 'string' ? source : source?.path;
    if (typeof sourcePath !== 'string' || !sourcePath) continue;
    const resolved = path.resolve(sourcePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    values.push({ path: resolved, name: typeof source === 'object' ? String(source.name || '') : path.basename(resolved) });
    if (values.length >= 100) break;
  }
  const files = [];
  for (const value of values) {
    try {
      if ((await fs.stat(value.path)).isFile()) files.push(value);
    } catch {}
  }
  const documents = files.filter((value) => vault.documentMimeFromPath(value.name || value.path));
  const media = files.filter((value) => vault.mimeFromPath(value.name || value.path));
  const targetSection = target?.section === 'media' || target?.section === 'documents' ? target.section : null;
  const targetFolderId = typeof target?.folderId === 'string' && target.folderId ? target.folderId : null;
  let snapshot = vault.getSnapshot();
  let added = 0;
  let documentsAdded = 0;
  let mediaAdded = 0;
  if (requestedKind !== 'media' && documents.length) {
    const result = await vault.importDocuments(documents, targetSection === 'documents' ? targetFolderId : null);
    snapshot = result.snapshot;
    added += result.added;
    documentsAdded += result.added;
  }
  if (requestedKind !== 'documents' && media.length) {
    const result = await vault.importMedia(media, targetSection === 'media' ? targetFolderId : null);
    snapshot = result.snapshot;
    added += result.added;
    mediaAdded += result.added;
  }
  return { snapshot, added, documentsAdded, mediaAdded, skipped: files.length - added };
}

async function captureScreenRegion(folderId = null) {
  if (!vault.isUnlocked()) throw new Error('VAULT_LOCKED');
  const initial = clipboard.readImage();
  const initialHash = initial.isEmpty() ? '' : hashImage(initial);
  screenCaptureActive = true;
  try {
    await shell.openExternal('ms-screenclip:');
    const image = await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const current = clipboard.readImage();
        if (!current.isEmpty() && hashImage(current) !== initialHash) {
          clearInterval(timer);
          resolve(current);
        } else if (Date.now() - startedAt > 45_000) {
          clearInterval(timer);
          reject(new Error('SCREEN_CAPTURE_CANCELLED'));
        }
      }, 200);
    });
    const png = safeClipboardPng(image);
    if (!png) throw new Error('CLIPBOARD_IMAGE_TOO_LARGE');
    const name = `Снимок ${new Date().toLocaleString('ru-RU').replace(/[.:]/g, '-').replace(', ', '_')}.png`;
    try {
      const snapshot = await vault.importMediaBuffer(png, name, 'image/png', folderId);
      const capturedHash = hashImage(image);
      const current = clipboard.readImage();
      if (!current.isEmpty() && hashImage(current) === capturedHash) clipboard.clear();
      lastImageHash = '';
      return snapshot;
    } finally { png.fill(0); }
  } finally { screenCaptureActive = false; }
}

async function deleteItems(section, ids) {
  const selected = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string'))].slice(0, 500);
  if (!selected.length) throw new Error('ITEM_NOT_FOUND');
  let snapshot = vault.getSnapshot();
  for (const id of selected) {
    if (section === 'passwords') snapshot = await vault.deleteEntry(id);
    else if (section === 'notes') snapshot = await vault.deleteNote(id);
    else if (section === 'otp') snapshot = await vault.deleteOtpAccount(id);
    else if (section === 'media' || section === 'documents') snapshot = await vault.deleteMedia(id);
    else throw new Error('INVALID_ORGANIZER_SECTION');
  }
  return snapshot;
}

function startClipboardMonitor() {
  lastClipboardText = clipboard.readText();
  const initialImage = clipboard.readImage();
  const initialPng = safeClipboardPng(initialImage);
  lastImageHash = initialPng ? crypto.createHash('sha256').update(initialPng).digest('hex') : '';
  clipboardMonitor = setInterval(async () => {
    try {
      const text = clipboard.readText();
      if (text !== lastClipboardText) {
        lastClipboardText = text;
        const containsOtpSecret = isSensitiveOtpPayload(text);
        if (text && !containsOtpSecret && text !== ignoredClipboardText && await activity.addText(text)) notifyActivity();
        if (text === ignoredClipboardText) ignoredClipboardText = null;
      }
      const image = clipboard.readImage();
      const png = safeClipboardPng(image);
      const hash = png ? crypto.createHash('sha256').update(png).digest('hex') : '';
      if (hash && hash !== lastImageHash) {
        lastImageHash = hash;
        let containsOtpSecret = false;
        try { containsOtpSecret = isSensitiveOtpPayload(decodeQrPayload(image)); } catch {}
        if (!screenCaptureActive && !containsOtpSecret && await activity.addScreenshot(png)) notifyActivity();
      } else if (!hash) lastImageHash = '';
    } catch (error) { console.error('[clipboard-monitor]', error.message); }
  }, 700);
}

function registerIpc() {
  ipcMain.on('session:activity', (event) => {
    if (isTrustedSender(event, 'session:activity') && vault?.isUnlocked() && Date.now() - lastVaultActivity >= 1_000) refreshVaultSession();
  });
  ipcMain.on('quick:session-activity', (event) => {
    if (isTrustedSender(event, 'quick:session-activity') && vault?.isUnlocked() && Date.now() - lastVaultActivity >= 1_000) refreshVaultSession();
  });
  safeHandle('app:bootstrap', async () => ({ version: app.getVersion(), exists: vault.exists(), unlocked: vault.isUnlocked(), snapshot: vault.isUnlocked() ? vault.getSnapshot() : null, quickUnlockAvailable: Boolean(vault.sessionQuickWrap), quickUnlockMode: currentQuickUnlockMode(), launchAtStartup: (await autostart.getStatus()).enabled, pendingExternalImports: pendingExternalImports.length, preferences: appPreferences.snapshot() }));
  safeHandle('vault:create', async (password) => { const created = await vault.create(password); refreshVaultSession(); quickWindow?.webContents.send('quick:vault-created'); return created; });
  safeHandle('vault:unlock', async (password) => trackSuccessfulUnlock(await vault.unlockWithPassword(password)));
  safeHandle('vault:recover', async (key) => trackSuccessfulUnlock(await vault.unlockWithRecovery(key)));
  safeHandle('vault:quick-unlock', async ({ mode, credential }) => trackSuccessfulUnlock(await vault.quickUnlock(mode, credential)));
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
  safeHandle('vault:add-folder', (input) => vault.addFolder(input));
  safeHandle('vault:rename-folder', ({ id, name }) => vault.renameFolder(id, name));
  safeHandle('vault:update-folder-metadata', (input) => vault.updateFolderMetadata(input));
  safeHandle('vault:move-folders', (input) => vault.moveFolders(input));
  safeHandle('vault:delete-folders', (ids) => vault.deleteFolders(ids));
  safeHandle('vault:update-item-metadata', (input) => vault.updateItemMetadata(input));
  safeHandle('vault:delete-items', ({ section, ids }) => deleteItems(section, ids));
  safeHandle('vault:save-settings', async (settings) => { const snapshot = await vault.saveSettings(settings); applyPrivacySettings(); refreshVaultSession(); return snapshot; });
  safeHandle('vault:verify-master-password', (password) => vault.verifyMasterPassword(password));
  safeHandle('vault:quick-configure', async ({ mode, credential, currentPassword }) => {
    const snapshot = await vault.configureQuickUnlock(mode, credential, currentPassword);
    quickWindow?.webContents.send('quick:unlock-mode', currentQuickUnlockMode());
    return snapshot;
  });
  safeHandle('vault:change-master-password', ({ currentPassword, newPassword }) => vault.changeMasterPassword(currentPassword, newPassword));
  safeHandle('vault:export-backup', async (currentPassword) => {
    vault.verifyMasterPassword(currentPassword);
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Экспорт хранилища', defaultPath: `Nocturne-${date}.nocturne`, filters: [{ name: 'Резервная копия Nocturne', extensions: ['nocturne'] }] });
    return result.canceled || !result.filePath ? { canceled: true } : vault.exportVaultBackup(result.filePath, currentPassword);
  });
  safeHandle('vault:import-backup', async (masterPassword) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Импорт хранилища', properties: ['openFile'], filters: [{ name: 'Резервная копия Nocturne', extensions: ['nocturne'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const snapshot = await vault.importVaultBackup(result.filePaths[0], masterPassword);
    applyPrivacySettings();
    notifyActivity();
    return { canceled: false, snapshot };
  });
  safeHandle('vault:destroy', async (currentPassword) => { await vault.destroyVaultAuthenticated(currentPassword); return true; });
  safeHandle('vault:import-media', async (folderId) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Добавить в защищённую медиатеку', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Фото, видео и аудио', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov', 'm4v', 'mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac'] }] });
    return result.canceled ? { canceled: true } : vault.importMedia(result.filePaths, folderId);
  });
  safeHandle('vault:import-documents', async (folderId) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Добавить в защищённые документы', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Документы', extensions: ['pdf', 'txt', 'md', 'rtf', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'] }] });
    return result.canceled ? { canceled: true } : vault.importDocuments(result.filePaths, folderId);
  });
  safeHandle('vault:import-paths', ({ files, paths, kind, target }) => importSelectedPaths(files || paths, kind, target));
  safeHandle('vault:consume-external-imports', async (target) => {
    const queued = pendingExternalImports;
    pendingExternalImports = [];
    return queued.length ? importSelectedPaths(queued, target?.section || 'auto', target) : { snapshot: vault.getSnapshot(), added: 0, skipped: 0 };
  });
  safeHandle('vault:capture-region', (folderId) => captureScreenRegion(folderId));
  safeHandle('vault:import-recorded-audio', async ({ bytes, name, type, folderId }) => {
    if (!vault.isUnlocked()) throw new Error('VAULT_LOCKED');
    const value = Buffer.from(bytes || []);
    try { return await vault.importRecordedAudio(value, name, type, folderId); }
    finally { value.fill(0); }
  });
  safeHandle('vault:import-note-photos', async (noteId) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Прикрепить фото к заметке', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
    return result.canceled ? { canceled: true } : vault.importNoteAttachments(noteId, result.filePaths);
  });
  safeHandle('vault:import-note-clipboard', async (noteId) => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return { empty: true };
    const png = safeClipboardPng(image);
    if (!png) throw new Error('CLIPBOARD_IMAGE_TOO_LARGE');
    return { snapshot: await vault.importNoteImageBuffer(noteId, png) };
  });
  safeHandle('vault:delete-media', (id) => vault.deleteMedia(id));
  safeHandle('vault:rename-media', ({ id, name }) => vault.renameMedia(id, name));
  safeHandle('vault:save-media', async (id) => {
    return saveVaultMediaToComputer(mainWindow, id);
  });
  safeHandle('vault:preview-document', async (id) => {
    const item = vault.getMediaInfo(id);
    if (item.kind !== 'document') throw new Error('DOCUMENT_NOT_FOUND');
    const versions = vault.getDocumentVersions(id);
    if (item.type === 'application/pdf') return { id, name: item.name, type: item.type, kind: 'pdf', url: `vaultmedia://${id}`, editable: false, versions };
    const isText = ['text/plain', 'text/markdown', 'text/csv'].includes(item.type);
    const isOffice = MODERN_OFFICE_MIMES.has(item.type);
    const isRtf = item.type === 'application/rtf';
    if (!isText && !isOffice && !isRtf) throw new Error('DOCUMENT_PREVIEW_UNSUPPORTED');
    if (item.size > (isText ? 5 * 1024 * 1024 : MAX_ARCHIVE_BYTES)) throw new Error('DOCUMENT_PREVIEW_TOO_LARGE');
    const media = await vault.getMedia(id);
    try {
      const text = isText ? media.buffer.toString('utf8') : isRtf ? extractRtfText(media.buffer) : extractOfficeText(media.buffer, item.type);
      return { id, name: media.name, type: media.mime, kind: isText ? 'text' : 'office', text, editable: isText, versions };
    } finally { media.buffer.fill(0); }
  });
  safeHandle('vault:save-text-document', ({ id, text }) => vault.saveTextDocument(id, text));
  safeHandle('vault:create-text-document', ({ name, type, text, folderId }) => vault.createTextDocument(name, type, text, folderId));
  safeHandle('vault:restore-document-version', ({ documentId, versionId }) => vault.restoreDocumentVersion(documentId, versionId));
  safeHandle('vault:restore-trash', (id) => vault.restoreTrashItem(id));
  safeHandle('vault:preview-trash', (id) => vault.getTrashPreview(id));
  safeHandle('vault:purge-trash', (id) => vault.permanentlyDeleteTrashItem(id));
  safeHandle('vault:empty-trash', () => vault.emptyTrash());
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
  safeHandle('app:set-autostart', async (enabled) => {
    if (!vault.isUnlocked()) throw new Error('VAULT_LOCKED');
    return autostart.setEnabled(Boolean(enabled));
  });
  safeHandle('app:save-preferences', async (preferences) => {
    const updated = await appPreferences.update(preferences);
    quickWindow?.webContents.send('quick:preferences', updated);
    return updated;
  });

  safeHandle('quick:bootstrap', async () => ({ expanded: quickExpanded, activity: quickActivitySnapshot(), vaultExists: vault.exists(), quickUnlockMode: currentQuickUnlockMode(), preferences: appPreferences.snapshot() }));
  safeHandle('quick:toggle', async () => { setQuickExpanded(!quickExpanded); return quickExpanded; });
  safeHandle('quick:collapse', async () => { setQuickExpanded(false); return true; });
  safeHandle('quick:show-context-menu', async () => {
    const menu = Menu.buildFromTemplate([{
      label: 'Скрыть',
      click: () => setQuickAccessEnabled(false).catch((error) => console.error('[quick-access]', error.message)),
    }]);
    menu.popup({ window: quickWindow });
    return true;
  });
  safeHandle('quick:delete', ({ section, id }) => { requireQuickUnlock(); return activity.deleteItem(section, id); });
  safeHandle('quick:clear', (section) => { requireQuickUnlock(); return activity.clear(section); });
  safeHandle('quick:copy', async (text) => { requireQuickUnlock(); writeTextToClipboard(text); return true; });
  safeHandle('quick:copy-secret', async (text) => { writeTextToClipboard(text, vault.payload?.settings.clipboardSeconds || 30); return true; });
  safeHandle('quick:copy-screenshot', async (id) => { requireQuickUnlock(); writeImageToClipboard(await activity.getScreenshot(id)); return true; });
  safeHandle('quick:save-screenshot', async (id) => { requireQuickUnlock(); return saveBufferToComputer(quickWindow, await activity.getScreenshot(id), `Скриншот-${id.slice(0, 8)}.png`, 'Сохранить скриншот'); });
  safeHandle('quick:unlock-vault', async ({ mode, credential }) => {
    if (!['password', 'pin', 'pattern'].includes(mode)) throw new Error('INVALID_QUICK_MODE');
    const result = mode === 'password'
      ? await vault.unlockWithPassword(String(credential || ''))
      : await vault.quickUnlock(mode, String(credential || ''));
    const snapshot = trackSuccessfulUnlock(result);
    return snapshot?.unlocked ? { ...snapshot, quickActivity: activity.getSnapshot() } : snapshot;
  });
  safeHandle('quick:delete-note', (id) => vault.deleteNote(id));
  safeHandle('quick:otp-codes', () => vault.getOtpCodes());
  safeHandle('quick:copy-media', async (id) => { const media = await vault.getMedia(id); if (!media.mime.startsWith('image/')) throw new Error('MEDIA_COPY_UNSUPPORTED'); try { writeImageToClipboard(media.buffer, vault.payload.settings.clipboardSeconds); return true; } finally { media.buffer.fill(0); } });
  safeHandle('quick:save-media', async (id) => saveVaultMediaToComputer(quickWindow, id));
  safeHandle('quick:preview-document', async (id) => {
    const item = vault.payload.media.find((media) => media.id === id && media.kind === 'document');
    if (!item) throw new Error('DOCUMENT_NOT_FOUND');
    if (!['text/plain', 'text/markdown', 'text/csv'].includes(item.type)) throw new Error('DOCUMENT_PREVIEW_UNSUPPORTED');
    if (item.size > 1024 * 1024) throw new Error('DOCUMENT_PREVIEW_TOO_LARGE');
    const media = await vault.getMedia(id);
    try {
      return { id, name: media.name, type: media.mime, text: media.buffer.toString('utf8') };
    } finally { media.buffer.fill(0); }
  });
  safeHandle('quick:open-main', async () => { showMain(); return true; });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.nocturne.vault');
  appPreferences = new AppPreferencesService(path.join(app.getPath('userData'), 'app-preferences.json'));
  await appPreferences.initialize();
  autostart = new WindowsAutostartService({ electronApp: app, executablePath: process.execPath });
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
    resetSensitiveSessionState();
    await activity.destroyAndReset();
    mainWindow?.webContents.send('vault:wiped');
    quickWindow?.webContents.send('quick:vault-wiped');
    notifyActivity();
  };

  protocol.handle('vaultmedia', async (request) => {
    try {
      const id = new URL(request.url).hostname;
      const media = vault.getMediaInfo(id);
      const size = Number(media.size);
      const range = parseByteRange(request.headers.get('range'), size);
      const commonHeaders = { 'Content-Type': media.type, 'Cache-Control': 'no-store, max-age=0', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
      if (range?.invalid) {
        return new Response(null, { status: 416, headers: { ...commonHeaders, 'Content-Range': `bytes */${size}` } });
      }
      const contentLength = range ? range.end - range.start + 1 : size;
      const headers = { ...commonHeaders, 'Content-Length': String(contentLength), ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}) };
      if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
      const start = range?.start || 0;
      const end = range?.end ?? size - 1;
      return new Response(Readable.toWeb(vault.createMediaStream(id, start, end)), { status: range ? 206 : 200, headers });
    }
    catch { return new Response('Locked or missing', { status: 404 }); }
  });
  protocol.handle('quickshot', async (request) => {
    try { return new Response(await activity.getScreenshot(new URL(request.url).hostname), { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store, max-age=0' } }); }
    catch { return new Response('Missing', { status: 404 }); }
  });

  registerIpc();
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return Boolean(webContents === mainWindow?.webContents && permission === 'media' && details?.mediaType === 'audio' && vault?.isUnlocked() && mainWindow?.isVisible());
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback(Boolean(webContents === mainWindow?.webContents && permission === 'media' && mediaTypes.length === 1 && mediaTypes[0] === 'audio' && vault?.isUnlocked() && mainWindow?.isVisible()));
  });
  createTray();
  createMainWindow(!launchedAtStartup);
  const startupImports = commandLineImports(process.argv);
  if (startupImports.length) queueExternalImports(startupImports);
  if (process.env.NOCTURNE_TEST_SHOW_QUICK) showQuick();
  startClipboardMonitor();
  powerMonitor.on('lock-screen', () => { if (vault?.payload?.settings.lockOnSystemLock) lockVault('system'); });
  powerMonitor.on('suspend', () => lockVault('system'));
  screen.on('display-metrics-changed', () => { if (quickWindow?.isVisible()) quickWindow.setBounds(quickExpanded ? expandedBounds() : collapsedBounds()); });
  app.on('activate', showMain);
});

app.on('second-instance', (_event, commandLine) => {
  const imports = commandLineImports(commandLine);
  if (imports.length) queueExternalImports(imports);
  else if (!commandLine.includes('--autostart')) showMain();
});
app.on('before-quit', () => { isQuitting = true; clearOwnedSensitiveClipboard(); clearInterval(clipboardMonitor); clearTimeout(clipboardTimer); clearTimeout(clipboardImageTimer); clearTimeout(quickBoundsTimer); clearTimeout(vaultSessionTimer); vault?.lock({ preserveQuickUnlock: false }); });
app.on('window-all-closed', () => {});
