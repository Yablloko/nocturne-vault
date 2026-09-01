const assert = require('node:assert/strict');
const test = require('node:test');
const { WindowsAutostartService } = require('../src/services/windows-autostart-service');

function fixture(initialRegistry = null) {
  let registry = initialRegistry;
  const calls = [];
  const app = {
    isPackaged: true,
    setLoginItemSettings(settings) { calls.push(['electron:set', settings]); },
    getLoginItemSettings() { return { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] }; },
  };
  const run = async (_file, args) => {
    calls.push(['reg', args]);
    if (args[0] === 'QUERY') {
      if (!registry) throw new Error('missing');
      return { stdout: `    NocturneVault    REG_SZ    ${registry}\r\n` };
    }
    if (args[0] === 'ADD') registry = args[args.indexOf('/d') + 1];
    if (args[0] === 'DELETE') registry = null;
    return { stdout: '' };
  };
  return { app, calls, run, registry: () => registry };
}

test('регистрирует установленное приложение с флагом фонового запуска и проверяет запись', async () => {
  const f = fixture();
  const service = new WindowsAutostartService({ electronApp: f.app, executablePath: 'C:\\Program Files\\Nocturne Vault\\Nocturne Vault.exe', platform: 'win32', run: f.run });
  const status = await service.setEnabled(true);
  assert.equal(status.enabled, true);
  assert.equal(f.registry(), '"C:\\Program Files\\Nocturne Vault\\Nocturne Vault.exe" --autostart');
  assert.equal(f.calls[0][1].name, 'NocturneVault');
  assert.equal(f.calls[0][1].enabled, true);
});

test('отключение удаляет и Electron login item, и резервную Run-запись', async () => {
  const command = '"C:\\Nocturne\\Nocturne Vault.exe" --autostart';
  const f = fixture(command);
  const service = new WindowsAutostartService({ electronApp: f.app, executablePath: 'C:\\Nocturne\\Nocturne Vault.exe', platform: 'win32', run: f.run });
  const status = await service.setEnabled(false);
  assert.equal(status.enabled, false);
  assert.equal(f.registry(), null);
  assert.ok(f.calls.some((call) => call[0] === 'reg' && call[1][0] === 'DELETE'));
});

test('не регистрирует electron.exe из режима разработки', async () => {
  const f = fixture();
  f.app.isPackaged = false;
  const service = new WindowsAutostartService({ electronApp: f.app, executablePath: 'C:\\repo\\node_modules\\electron\\electron.exe', platform: 'win32', run: f.run });
  await assert.rejects(() => service.setEnabled(true), /AUTOSTART_REQUIRES_INSTALLED_APP/);
});

test('не считает отключённую в диспетчере задач запись рабочим автозапуском', async () => {
  const command = '"C:\\Nocturne\\Nocturne Vault.exe" --autostart';
  const f = fixture(command);
  f.app.getLoginItemSettings = () => ({
    openAtLogin: true,
    executableWillLaunchAtLogin: false,
    launchItems: [{ name: 'NocturneVault', path: 'C:\\Nocturne\\Nocturne Vault.exe', enabled: false }],
  });
  const service = new WindowsAutostartService({ electronApp: f.app, executablePath: 'C:\\Nocturne\\Nocturne Vault.exe', platform: 'win32', run: f.run });
  assert.equal((await service.getStatus()).enabled, false);
});
