const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULTS = Object.freeze({ quickAccessEnabled: true, locale: 'ru', theme: 'light' });

class AppPreferencesService {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.values = { ...DEFAULTS };
  }

  async initialize() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.values.quickAccessEnabled = parsed?.quickAccessEnabled !== false;
      this.values.locale = parsed?.locale === 'en' ? 'en' : 'ru';
      this.values.theme = ['light', 'dark', 'system'].includes(parsed?.theme) ? parsed.theme : 'light';
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      await this.persist();
    }
    return this.snapshot();
  }

  snapshot() {
    return { quickAccessEnabled: this.values.quickAccessEnabled !== false, locale: this.values.locale, theme: this.values.theme };
  }

  async setQuickAccessEnabled(enabled) {
    this.values.quickAccessEnabled = Boolean(enabled);
    await this.persist();
    return this.snapshot();
  }

  async update(patch = {}) {
    if (patch.locale !== undefined) this.values.locale = patch.locale === 'en' ? 'en' : 'ru';
    if (patch.theme !== undefined) this.values.theme = ['light', 'dark', 'system'].includes(patch.theme) ? patch.theme : 'light';
    await this.persist();
    return this.snapshot();
  }

  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(this.snapshot()), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }
}

module.exports = { AppPreferencesService };
