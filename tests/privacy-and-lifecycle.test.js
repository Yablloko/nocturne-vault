const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('защита экрана применяется к обоим окнам и шторка управляется только main-процессом', () => {
  const main = source('src/main.js');
  const preload = source('src/preload.js');
  assert.match(main, /mainWindow\.setContentProtection\(true\)/);
  assert.match(main, /quickWindow\.setContentProtection/);
  assert.match(main, /webContents\.send\('privacy:conceal'/);
  assert.match(preload, /onPrivacyConceal/);
});

test('автозапуск использует скрытый аргумент и не разблокирует хранилище', () => {
  const main = source('src/main.js');
  const autostart = source('src/services/windows-autostart-service.js');
  assert.match(main, /process\.argv\.includes\('--autostart'\)/);
  assert.match(main, /createMainWindow\(!launchedAtStartup\)/);
  assert.match(main, /autostart\.setEnabled\(Boolean\(enabled\)\)/);
  assert.match(autostart, /setLoginItemSettings\(this\.loginItemOptions\(next\)\)/);
  assert.match(autostart, /'reg\.exe', \['ADD', RUN_KEY/);
  assert.match(autostart, /AUTOSTART_REGISTRATION_FAILED/);
  assert.match(main, /second-instance[\s\S]*commandLine\.includes\('--autostart'\)/);
  const autoStartSlice = main.slice(main.indexOf("safeHandle('app:set-autostart'"), main.indexOf("safeHandle('quick:bootstrap'"));
  assert.equal(autoStartSlice.includes('unlockWithPassword'), false);
});

test('быстрый доступ управляется из трея и скрывается через контекстное меню стрелки', () => {
  const main = source('src/main.js');
  const quick = source('src/quick/quick.jsx');
  assert.match(main, /Отключить быстрый доступ/);
  assert.match(main, /Включить быстрый доступ/);
  assert.match(main, /safeHandle\('quick:show-context-menu'/);
  assert.match(quick, /onContextMenu=\{\(event\)/);
  assert.match(main, /appPreferences\.setQuickAccessEnabled\(next\)/);
});

test('история буфера и снимков в быстрой панели доступна только после разблокировки', () => {
  const main = source('src/main.js');
  const quick = source('src/quick/quick.jsx');
  assert.match(main, /function quickActivitySnapshot\(\)[\s\S]*vault\?\.isUnlocked\(\)/);
  assert.match(main, /function requireQuickUnlock\(\)/);
  assert.match(main, /safeHandle\('quick:copy-screenshot',[\s\S]*requireQuickUnlock\(\)/);
  assert.match(quick, /const protectedTabs = \['clip', 'shots', 'notes', 'passwords', 'otp', 'documents'\]/);
  assert.match(quick, /setActivity\(\{ clipboard: \[\], screenshots: \[\] \}\)/);
});

test('сворачивание быстрой панели сохраняет авторизацию до общей автоблокировки', () => {
  const main = source('src/main.js');
  const quick = source('src/quick/quick.jsx');
  const collapseSlice = main.slice(main.indexOf('function setQuickExpanded'), main.indexOf('function createQuickWindow'));
  assert.equal(collapseSlice.includes("lockVault('quick')"), false);
  assert.equal(quick.includes('if (!value) setSnapshot(null)'), false);
  assert.equal(quick.includes('if (!protectedTabs.includes(id)) setSnapshot(null)'), false);
  assert.match(quick, /api\.onVaultLocked\(\(data\) => \{ setSnapshot\(null\)/);
});

test('быстрая панель использует настроенный рисунок, а мастер-пароль остаётся запасным способом', () => {
  const main = source('src/main.js');
  const preload = source('src/quick/preload.js');
  const quick = source('src/quick/quick.jsx');
  assert.match(main, /quickUnlockMode: currentQuickUnlockMode\(\)/);
  assert.match(main, /vault\.quickUnlock\(mode, String\(credential \|\| ''\)\)/);
  assert.match(preload, /unlockVault: \(mode, credential\)/);
  assert.match(quick, /data-pattern-node/);
  assert.match(quick, /Войти мастер-паролем/);
  assert.match(quick, /onPointerUp=\{finish\}/);
});

test('после перезапуска профиль рисунка активируется только успешным мастер-входом', () => {
  const main = source('src/main.js');
  const renderer = source('src/renderer/app.js');
  const vault = source('src/services/vault-service.js');
  assert.equal(main.includes('quick-unlock.dpapi'), false);
  assert.match(vault, /payload\.quickUnlockProfile = this\.exportQuickUnlockState\(\)/);
  assert.match(vault, /if \(payload\.quickUnlockProfile\)[\s\S]*this\.restoreQuickUnlockState/);
  assert.match(main, /quickUnlockMode: currentQuickUnlockMode\(\)/);
  assert.match(renderer, /state\.quickUnlockMode = data\.quickUnlockMode \|\| 'password'/);
});

test('микрофон разрешён только доверенному окну, без видео и только при открытом хранилище', () => {
  const main = source('src/main.js');
  const requestHandler = main.slice(main.indexOf('setPermissionRequestHandler'), main.indexOf('createTray();'));
  assert.match(requestHandler, /webContents === mainWindow\?\.webContents/);
  assert.match(requestHandler, /mediaTypes\.length === 1/);
  assert.match(requestHandler, /mediaTypes\[0\] === 'audio'/);
  assert.match(requestHandler, /vault\?\.isUnlocked\(\)/);
});

test('PDF остаётся внутри приложения, а единственный внешний URI запускает системный захват области', () => {
  const index = source('src/renderer/index.html');
  const main = source('src/main.js');
  assert.match(index, /frame-src vaultmedia:/);
  assert.match(index, /object-src 'none'/);
  assert.equal(main.includes('shell.openPath'), false);
  assert.match(main, /shell\.openExternal\('ms-screenclip:'\)/);
  assert.equal((main.match(/shell\.openExternal/g) || []).length, 1);
});

test('импорт из проводника передаёт только выбранные пути через отдельный аргумент', () => {
  const main = source('src/main.js');
  const preload = source('src/preload.js');
  const installer = source('build/installer.nsh');
  assert.match(main, /function commandLineImports\(args\)/);
  assert.match(main, /args\[index\]\.startsWith\('--import='\)/);
  assert.match(main, /args\[index\] === '--import'/);
  assert.match(main, /path\.resolve\(value\.replace/);
  assert.match(preload, /webUtils\.getPathForFile\(file\)/);
  assert.match(preload, /name: file\.name/);
  assert.match(installer, /Software\\Classes\\\*\\shell\\NocturneVault/);
  assert.match(installer, /"MUIVerb" "Добавить в Nocturne"/);
  assert.match(installer, /"MultiSelectModel" "Player"/);
  assert.match(installer, /--import "%1"/);
  assert.match(installer, /DeleteRegKey HKCU/);
});

test('NSIS обновляет прежнюю установку и не удаляет пользовательское хранилище', () => {
  const packageConfig = JSON.parse(source('package.json'));
  assert.equal(packageConfig.build.appId, 'com.nocturne.vault');
  assert.equal(packageConfig.build.nsis.oneClick, false);
  assert.equal(packageConfig.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(packageConfig.build.nsis.perMachine, false);
});

test('блокировка Windows немедленно закрывает хранилище', () => {
  const main = source('src/main.js');
  assert.match(main, /powerMonitor\.on\('lock-screen'/);
  assert.match(main, /lockVault\('system'\)/);
});
