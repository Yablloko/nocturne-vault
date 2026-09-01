const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function quoteWindowsArgument(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

class WindowsAutostartService {
  constructor({ electronApp, executablePath, platform = process.platform, run = execFileAsync, valueName = 'NocturneVault' }) {
    this.electronApp = electronApp;
    this.executablePath = executablePath;
    this.platform = platform;
    this.run = run;
    this.valueName = valueName;
    this.args = ['--autostart'];
  }

  loginItemOptions(openAtLogin) {
    return {
      openAtLogin,
      enabled: openAtLogin,
      name: this.valueName,
      path: this.executablePath,
      args: this.args,
    };
  }

  commandValue() {
    return `${quoteWindowsArgument(this.executablePath)} ${this.args.join(' ')}`;
  }

  async readRegistryValue() {
    if (this.platform !== 'win32') return null;
    try {
      const { stdout = '' } = await this.run('reg.exe', ['QUERY', RUN_KEY, '/v', this.valueName], { windowsHide: true, encoding: 'buffer' });
      const outputs = Buffer.isBuffer(stdout)
        ? ['utf-8', 'ibm866', 'windows-1252'].map((encoding) => new TextDecoder(encoding).decode(stdout))
        : [String(stdout)];
      const values = outputs.map((output) => output.match(/REG_(?:EXPAND_)?SZ\s+(.+)$/im)?.[1]?.trim()).filter(Boolean);
      return values.find((value) => value === this.commandValue()) || values[0] || null;
    } catch {
      return null;
    }
  }

  async getStatus() {
    if (this.platform !== 'win32') return { supported: false, enabled: false, needsRepair: false };
    const settings = this.electronApp.getLoginItemSettings({ path: this.executablePath, args: this.args });
    const registryValue = await this.readRegistryValue();
    const registryMatches = registryValue === this.commandValue();
    const matchingLaunchItem = Array.isArray(settings.launchItems)
      ? settings.launchItems.find((item) => item.name === this.valueName && item.path?.toLowerCase() === this.executablePath.toLowerCase())
      : null;
    const electronEnabled = Boolean(settings.openAtLogin && settings.executableWillLaunchAtLogin !== false && matchingLaunchItem?.enabled !== false);
    const enabled = electronEnabled || Boolean(registryMatches && matchingLaunchItem?.enabled !== false);
    return { supported: true, enabled, needsRepair: Boolean(registryValue && !registryMatches), registryValue };
  }

  async setEnabled(enabled) {
    if (this.platform !== 'win32') throw new Error('AUTOSTART_UNSUPPORTED');
    if (!this.electronApp.isPackaged && process.env.NOCTURNE_TEST_ALLOW_AUTOSTART !== '1') throw new Error('AUTOSTART_REQUIRES_INSTALLED_APP');
    const next = Boolean(enabled);
    this.electronApp.setLoginItemSettings(this.loginItemOptions(next));

    let status = await this.getStatus();
    if (next && !status.enabled) {
      await this.run('reg.exe', ['ADD', RUN_KEY, '/v', this.valueName, '/t', 'REG_SZ', '/d', this.commandValue(), '/f'], { windowsHide: true });
    } else if (!next && await this.readRegistryValue()) {
      await this.run('reg.exe', ['DELETE', RUN_KEY, '/v', this.valueName, '/f'], { windowsHide: true });
    }

    status = await this.getStatus();
    if (status.enabled !== next) throw new Error('AUTOSTART_REGISTRATION_FAILED');
    return status;
  }
}

module.exports = { RUN_KEY, WindowsAutostartService, quoteWindowsArgument };
