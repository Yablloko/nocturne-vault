const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const HISTORY_LIMIT = 30;

function encode(value) { return Buffer.from(value).toString('base64'); }
function decode(value) { return Buffer.from(value, 'base64'); }

function encrypt(key, value, aad) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return { nonce: encode(nonce), ciphertext: encode(ciphertext), tag: encode(cipher.getAuthTag()) };
}

function decrypt(key, envelope, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, decode(envelope.nonce));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(decode(envelope.tag));
  return Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
}

class ActivityService {
  constructor(rootDir, keyProtector) {
    this.rootDir = path.resolve(rootDir);
    this.keyPath = path.join(this.rootDir, 'device.key');
    this.containerPath = path.join(this.rootDir, 'activity.nva');
    this.shotsDir = path.join(this.rootDir, 'screenshots');
    this.keyProtector = keyProtector;
    this.key = null;
    this.payload = { clipboard: [], screenshots: [] };
  }

  async initialize() {
    await fsp.mkdir(this.shotsDir, { recursive: true });
    if (fs.existsSync(this.keyPath)) {
      this.key = Buffer.from(this.keyProtector.unprotect(await fsp.readFile(this.keyPath)));
    } else {
      this.key = crypto.randomBytes(32);
      await this.atomicWrite(this.keyPath, this.keyProtector.protect(this.key));
    }
    if (fs.existsSync(this.containerPath)) {
      const envelope = JSON.parse(await fsp.readFile(this.containerPath, 'utf8'));
      const plain = decrypt(this.key, envelope, 'activity-v1');
      this.payload = JSON.parse(plain.toString('utf8'));
      plain.fill(0);
    } else {
      await this.persist();
    }
    this.payload.clipboard ||= [];
    this.payload.screenshots ||= [];
    return this.getSnapshot();
  }

  getSnapshot() {
    return {
      clipboard: this.payload.clipboard.map((item) => ({ ...item })),
      screenshots: this.payload.screenshots.map((item) => ({ ...item, url: `quickshot://${item.id}` })),
    };
  }

  async addText(text) {
    const value = String(text || '').trim();
    if (!value || this.payload.clipboard[0]?.text === value) return false;
    this.payload.clipboard.unshift({ id: crypto.randomUUID(), text: value.slice(0, 100000), createdAt: new Date().toISOString() });
    this.payload.clipboard = this.payload.clipboard.slice(0, HISTORY_LIMIT);
    await this.persist();
    return true;
  }

  async addScreenshot(png) {
    const buffer = Buffer.from(png);
    if (!buffer.length) return false;
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (this.payload.screenshots[0]?.hash === hash) return false;
    const id = crypto.randomUUID();
    await this.atomicWrite(path.join(this.shotsDir, `${id}.nvs`), JSON.stringify(encrypt(this.key, buffer, `quickshot:${id}`)));
    const item = { id, hash, size: buffer.length, createdAt: new Date().toISOString() };
    this.payload.screenshots.unshift(item);
    const removed = this.payload.screenshots.splice(HISTORY_LIMIT);
    for (const old of removed) await this.secureDelete(path.join(this.shotsDir, `${old.id}.nvs`));
    await this.persist();
    return true;
  }

  async getScreenshot(id) {
    if (!this.payload.screenshots.some((item) => item.id === id)) throw new Error('SCREENSHOT_NOT_FOUND');
    const envelope = JSON.parse(await fsp.readFile(path.join(this.shotsDir, `${id}.nvs`), 'utf8'));
    return decrypt(this.key, envelope, `quickshot:${id}`);
  }

  async deleteItem(section, id) {
    if (section === 'clipboard') this.payload.clipboard = this.payload.clipboard.filter((item) => item.id !== id);
    if (section === 'screenshots') {
      this.payload.screenshots = this.payload.screenshots.filter((item) => item.id !== id);
      await this.secureDelete(path.join(this.shotsDir, `${id}.nvs`));
    }
    await this.persist();
    return this.getSnapshot();
  }

  async clear(section) {
    if (section === 'clipboard') this.payload.clipboard = [];
    if (section === 'screenshots') {
      for (const item of this.payload.screenshots) await this.secureDelete(path.join(this.shotsDir, `${item.id}.nvs`));
      this.payload.screenshots = [];
    }
    await this.persist();
    return this.getSnapshot();
  }

  async destroyAndReset() {
    const resolvedRoot = path.resolve(this.rootDir);
    if (resolvedRoot.length < 12 || path.parse(resolvedRoot).root === resolvedRoot) throw new Error('UNSAFE_ACTIVITY_WIPE_PATH');
    for (const item of this.payload.screenshots) await this.secureDelete(path.join(this.shotsDir, `${item.id}.nvs`));
    await this.secureDelete(this.containerPath);
    await this.secureDelete(this.keyPath);
    if (this.key) this.key.fill(0);
    this.key = null;
    this.payload = { clipboard: [], screenshots: [] };
    await fsp.rm(resolvedRoot, { recursive: true, force: true });
    return this.initialize();
  }

  async persist() {
    const plain = Buffer.from(JSON.stringify(this.payload));
    const envelope = encrypt(this.key, plain, 'activity-v1');
    plain.fill(0);
    await this.atomicWrite(this.containerPath, JSON.stringify(envelope));
  }

  async atomicWrite(target, contents) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temporary, contents, { mode: 0o600 });
    await fsp.rename(temporary, target);
  }

  async secureDelete(target) {
    try {
      const stat = await fsp.stat(target);
      if (stat.size) await fsp.writeFile(target, crypto.randomBytes(stat.size));
      await fsp.unlink(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

module.exports = { ActivityService, HISTORY_LIMIT };
