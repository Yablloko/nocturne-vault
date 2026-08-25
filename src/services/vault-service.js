const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { generateTotp, normalizeBase32, parseOtpAuthUri } = require('./otp-service');

const VAULT_VERSION = 1;
const SCRYPT_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const MAX_MEDIA_SIZE = 1024 * 1024 * 1024;

function encode(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function decode(value) {
  return Buffer.from(value, 'base64');
}

function aesEncrypt(key, value, aad = '') {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return {
    nonce: encode(nonce),
    ciphertext: encode(ciphertext),
    tag: encode(cipher.getAuthTag()),
  };
}

function aesDecrypt(key, envelope, aad = '') {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, decode(envelope.nonce));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(decode(envelope.tag));
  return Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
}

function derivePasswordKey(secret, salt) {
  return crypto.scryptSync(secret.normalize('NFKC'), salt, 32, SCRYPT_OPTIONS);
}

function deriveRecoveryKey(recoveryBytes, salt) {
  return crypto.hkdfSync('sha256', recoveryBytes, salt, Buffer.from('nocturne-recovery-v1'), 32);
}

function formatRecoveryKey(bytes) {
  const body = bytes.toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
  return `NV1-${body}`;
}

function parseRecoveryKey(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/^NV1-/, '').replaceAll('-', '');
  if (!/^[A-F0-9]{64}$/.test(normalized)) throw new Error('INVALID_RECOVERY_KEY');
  return Buffer.from(normalized, 'hex');
}

function defaultPayload() {
  const now = new Date().toISOString();
  return {
    settings: {
      autoLockMinutes: 5,
      lockOnMinimize: false,
      lockOnSystemLock: true,
      clipboardSeconds: 30,
      quickUnlockMode: 'none',
      wipeEnabled: false,
      wipeThreshold: 15,
    },
    folders: [
      { id: 'personal', name: 'Личное', icon: 'user', createdAt: now },
      { id: 'work', name: 'Работа', icon: 'briefcase', createdAt: now },
      { id: 'finance', name: 'Финансы', icon: 'wallet', createdAt: now },
    ],
    entries: [],
    notes: [],
    media: [],
    otp: [],
    createdAt: now,
    updatedAt: now,
  };
}

class VaultService {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.containerPath = path.join(this.rootDir, 'vault.nvlt');
    this.securityPath = path.join(this.rootDir, 'security.json');
    this.mediaDir = path.join(this.rootDir, 'media');
    this.key = null;
    this.payload = null;
    this.container = null;
    this.sessionQuickWrap = null;
    this.onWiped = null;
  }

  exists() {
    return fs.existsSync(this.containerPath);
  }

  isUnlocked() {
    return Boolean(this.key && this.payload);
  }

  async create(masterPassword) {
    if (this.exists()) throw new Error('VAULT_EXISTS');
    this.validateMasterPassword(masterPassword);
    await fsp.mkdir(this.mediaDir, { recursive: true });

    const vaultKey = crypto.randomBytes(32);
    const recoveryBytes = crypto.randomBytes(32);
    const passwordSalt = crypto.randomBytes(16);
    const recoverySalt = crypto.randomBytes(16);
    const passwordKey = derivePasswordKey(masterPassword, passwordSalt);
    const recoveryKey = deriveRecoveryKey(recoveryBytes, recoverySalt);

    this.key = Buffer.from(vaultKey);
    this.payload = defaultPayload();
    this.container = {
      version: VAULT_VERSION,
      kdf: { name: 'scrypt', salt: encode(passwordSalt), N: SCRYPT_OPTIONS.N, r: SCRYPT_OPTIONS.r, p: SCRYPT_OPTIONS.p },
      passwordWrap: aesEncrypt(passwordKey, vaultKey, 'password-wrap-v1'),
      recovery: { salt: encode(recoverySalt), wrap: aesEncrypt(recoveryKey, vaultKey, 'recovery-wrap-v1') },
      payload: null,
    };

    passwordKey.fill(0);
    recoveryKey.fill?.(0);
    await this.persist();
    await this.writeSecurityState({ failedAttempts: 0 });
    const recoveryKeyText = formatRecoveryKey(recoveryBytes);
    recoveryBytes.fill(0);
    return { recoveryKey: recoveryKeyText };
  }

  validateMasterPassword(value) {
    if (typeof value !== 'string' || value.length < 10) throw new Error('WEAK_MASTER_PASSWORD');
    if (value.length > 256) throw new Error('MASTER_PASSWORD_TOO_LONG');
  }

  async unlockWithPassword(masterPassword) {
    const security = await this.readSecurityState();
    if (Number(security.lockedUntil) > Date.now()) {
      return { unlocked: false, failedAttempts: security.failedAttempts || 0, retryAfterSeconds: Math.ceil((security.lockedUntil - Date.now()) / 1000) };
    }
    const container = await this.readContainer();
    const passwordKey = derivePasswordKey(masterPassword, decode(container.kdf.salt));
    let vaultKey;
    try {
      vaultKey = aesDecrypt(passwordKey, container.passwordWrap, 'password-wrap-v1');
    } catch {
      return this.handleInvalidAttempt(security);
    } finally {
      passwordKey.fill(0);
    }

    try {
      await this.finishUnlock(container, vaultKey);
      await this.writeSecurityState({ failedAttempts: 0, lockedUntil: 0 });
      return this.getSnapshot();
    } catch {
      this.lock({ preserveQuickUnlock: false });
      throw new Error('VAULT_CORRUPTED');
    } finally {
      vaultKey.fill(0);
    }
  }

  async handleInvalidAttempt(security) {
    const nextAttempts = (security.failedAttempts || 0) + 1;
    const publicSettings = await this.getPublicSecuritySettings();
    if (publicSettings.wipeEnabled && nextAttempts >= publicSettings.wipeThreshold) {
      await this.destroyVault();
      return { wiped: true };
    }
    const retryAfterSeconds = nextAttempts >= 10 ? 60 : nextAttempts >= 5 ? 15 : 0;
    await this.writeSecurityState({ failedAttempts: nextAttempts, lockedUntil: retryAfterSeconds ? Date.now() + retryAfterSeconds * 1000 : 0 });
    return { unlocked: false, failedAttempts: nextAttempts, retryAfterSeconds };
  }

  async unlockWithRecovery(recoveryKeyText) {
    const container = await this.readContainer();
    const recoveryBytes = parseRecoveryKey(recoveryKeyText);
    const recoveryKey = deriveRecoveryKey(recoveryBytes, decode(container.recovery.salt));
    try {
      const vaultKey = aesDecrypt(recoveryKey, container.recovery.wrap, 'recovery-wrap-v1');
      await this.finishUnlock(container, vaultKey);
      await this.writeSecurityState({ failedAttempts: 0 });
      return this.getSnapshot();
    } finally {
      recoveryBytes.fill(0);
      recoveryKey.fill?.(0);
    }
  }

  async finishUnlock(container, vaultKey) {
    const plain = aesDecrypt(vaultKey, container.payload, 'vault-payload-v1');
    this.container = container;
    this.key = Buffer.from(vaultKey);
    this.payload = JSON.parse(plain.toString('utf8'));
    this.payload.notes ||= [];
    this.payload.media ||= [];
    this.payload.otp ||= [];
    plain.fill(0);
  }

  lock({ preserveQuickUnlock = true } = {}) {
    if (this.key) this.key.fill(0);
    this.key = null;
    this.payload = null;
    this.container = null;
    if (!preserveQuickUnlock) this.clearQuickUnlock();
  }

  clearQuickUnlock() {
    if (this.sessionQuickWrap?.keyMaterial) this.sessionQuickWrap.keyMaterial.fill(0);
    this.sessionQuickWrap = null;
  }

  verifyMasterPassword(currentPassword) {
    this.assertUnlocked();
    const passwordKey = derivePasswordKey(String(currentPassword || ''), decode(this.container.kdf.salt));
    let candidateKey;
    try {
      candidateKey = aesDecrypt(passwordKey, this.container.passwordWrap, 'password-wrap-v1');
      if (candidateKey.length !== this.key.length || !crypto.timingSafeEqual(candidateKey, this.key)) throw new Error('INVALID_CURRENT_PASSWORD');
      return true;
    } catch {
      throw new Error('INVALID_CURRENT_PASSWORD');
    } finally {
      passwordKey.fill(0);
      candidateKey?.fill(0);
    }
  }

  async configureQuickUnlock(mode, credential, currentPassword) {
    this.assertUnlocked();
    this.verifyMasterPassword(currentPassword);
    if (!['none', 'pin', 'pattern'].includes(mode)) throw new Error('INVALID_QUICK_MODE');
    if (mode === 'none') {
      this.clearQuickUnlock();
      this.payload.settings.quickUnlockMode = 'none';
      await this.persist();
      return this.getSnapshot();
    }
    if (mode === 'pin' && !/^\d{6,12}$/.test(credential)) throw new Error('INVALID_PIN');
    if (mode === 'pattern') {
      const nodes = String(credential).split('-');
      if (nodes.length < 5 || new Set(nodes).size !== nodes.length || nodes.some((node) => !/^[0-8]$/.test(node))) {
        throw new Error('INVALID_PATTERN');
      }
    }
    const salt = crypto.randomBytes(16);
    const quickKey = derivePasswordKey(`quick:${mode}:${credential}`, salt);
    this.sessionQuickWrap = { mode, salt: encode(salt), wrap: aesEncrypt(quickKey, this.key, 'quick-wrap-v1') };
    quickKey.fill(0);
    this.payload.settings.quickUnlockMode = mode;
    await this.persist();
    return this.getSnapshot();
  }

  async quickUnlock(mode, credential) {
    if (!this.sessionQuickWrap || this.sessionQuickWrap.mode !== mode) throw new Error('QUICK_UNLOCK_UNAVAILABLE');
    const quickKey = derivePasswordKey(`quick:${mode}:${credential}`, decode(this.sessionQuickWrap.salt));
    try {
      const vaultKey = aesDecrypt(quickKey, this.sessionQuickWrap.wrap, 'quick-wrap-v1');
      const container = await this.readContainer();
      await this.finishUnlock(container, vaultKey);
      vaultKey.fill(0);
      await this.writeSecurityState({ failedAttempts: 0 });
      return this.getSnapshot();
    } catch {
      return this.recordFailedAttempt();
    } finally {
      quickKey.fill(0);
    }
  }

  async recordFailedAttempt() {
    const state = await this.readSecurityState();
    if (Number(state.lockedUntil) > Date.now()) {
      return { unlocked: false, failedAttempts: state.failedAttempts || 0, retryAfterSeconds: Math.ceil((state.lockedUntil - Date.now()) / 1000) };
    }
    const nextAttempts = (state.failedAttempts || 0) + 1;
    const settings = await this.getPublicSecuritySettings();
    if (settings.wipeEnabled && nextAttempts >= settings.wipeThreshold) {
      await this.destroyVault();
      return { wiped: true };
    }
    const retryAfterSeconds = nextAttempts >= 10 ? 60 : nextAttempts >= 5 ? 15 : 0;
    await this.writeSecurityState({ failedAttempts: nextAttempts, lockedUntil: retryAfterSeconds ? Date.now() + retryAfterSeconds * 1000 : 0 });
    return { unlocked: false, failedAttempts: nextAttempts, retryAfterSeconds };
  }

  async changeMasterPassword(currentPassword, newPassword) {
    this.assertUnlocked();
    this.verifyMasterPassword(currentPassword);
    this.validateMasterPassword(newPassword);
    const salt = crypto.randomBytes(16);
    const passwordKey = derivePasswordKey(newPassword, salt);
    this.container.kdf = { name: 'scrypt', salt: encode(salt), N: SCRYPT_OPTIONS.N, r: SCRYPT_OPTIONS.r, p: SCRYPT_OPTIONS.p };
    this.container.passwordWrap = aesEncrypt(passwordKey, this.key, 'password-wrap-v1');
    passwordKey.fill(0);
    await this.persist();
  }

  getSnapshot() {
    this.assertUnlocked();
    return {
      unlocked: true,
      settings: { ...this.payload.settings, quickUnlockAvailable: Boolean(this.sessionQuickWrap) },
      folders: this.payload.folders.map((folder) => ({ ...folder })),
      entries: this.payload.entries.map((entry) => ({ ...entry })),
      notes: this.payload.notes.map((note) => ({
        ...note,
        attachments: this.payload.media.filter((item) => item.scope === 'note' && item.noteId === note.id).map((item) => ({ ...item, url: `vaultmedia://${item.id}` })),
      })),
      media: this.payload.media.filter((item) => !item.scope && item.kind !== 'document').map((item) => ({ ...item, url: `vaultmedia://${item.id}` })),
      documents: this.payload.media.filter((item) => item.kind === 'document').map((item) => ({ ...item })),
      otp: this.payload.otp.map(({ secret: _secret, ...item }) => ({ ...item })),
    };
  }

  async saveOtpAccount(entry) {
    this.assertUnlocked();
    const now = new Date().toISOString();
    const index = this.payload.otp.findIndex((item) => item.id === entry.id);
    const previous = index >= 0 ? this.payload.otp[index] : null;
    const secret = normalizeBase32(entry.secret || previous?.secret);
    const algorithm = String(entry.algorithm || previous?.algorithm || 'SHA1').toUpperCase();
    const digits = Number(entry.digits || previous?.digits || 6);
    const period = Number(entry.period || previous?.period || 30);
    generateTotp({ secret, algorithm, digits, period });
    const safeEntry = {
      id: previous?.id || crypto.randomUUID(),
      issuer: String(entry.issuer || '').trim().slice(0, 100),
      account: String(entry.account || '').trim().slice(0, 180),
      secret,
      algorithm,
      digits,
      period,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    if (!safeEntry.account && !safeEntry.issuer) throw new Error('OTP_NAME_REQUIRED');
    if (!previous && this.payload.otp.some((item) => item.secret === secret && item.account === safeEntry.account && item.issuer === safeEntry.issuer)) throw new Error('OTP_ALREADY_EXISTS');
    if (index >= 0) this.payload.otp[index] = safeEntry;
    else this.payload.otp.unshift(safeEntry);
    await this.persist();
    return this.getSnapshot();
  }

  async importOtpUri(uri) {
    return this.saveOtpAccount(parseOtpAuthUri(uri));
  }

  getOtpCodes(now = Date.now()) {
    this.assertUnlocked();
    return this.payload.otp.map((item) => ({ id: item.id, ...generateTotp(item, now) }));
  }

  async deleteOtpAccount(id) {
    this.assertUnlocked();
    this.payload.otp = this.payload.otp.filter((item) => item.id !== id);
    await this.persist();
    return this.getSnapshot();
  }

  async saveSettings(settings) {
    this.assertUnlocked();
    const allowed = ['autoLockMinutes', 'lockOnMinimize', 'lockOnSystemLock', 'clipboardSeconds', 'wipeEnabled', 'wipeThreshold'];
    for (const key of allowed) {
      if (Object.hasOwn(settings, key)) this.payload.settings[key] = settings[key];
    }
    this.payload.settings.autoLockMinutes = Math.max(1, Math.min(120, Number(this.payload.settings.autoLockMinutes) || 5));
    this.payload.settings.clipboardSeconds = Math.max(5, Math.min(120, Number(this.payload.settings.clipboardSeconds) || 30));
    this.payload.settings.wipeThreshold = Math.max(10, Math.min(50, Number(this.payload.settings.wipeThreshold) || 15));
    await this.persist();
    await this.writeSecurityState({ failedAttempts: 0 });
    return this.getSnapshot();
  }

  async addFolder(name) {
    this.assertUnlocked();
    const clean = String(name || '').trim().slice(0, 48);
    if (!clean) throw new Error('INVALID_FOLDER_NAME');
    const folder = { id: crypto.randomUUID(), name: clean, icon: 'folder', createdAt: new Date().toISOString() };
    this.payload.folders.push(folder);
    await this.persist();
    return this.getSnapshot();
  }

  async saveEntry(entry) {
    this.assertUnlocked();
    const now = new Date().toISOString();
    const safeEntry = {
      id: entry.id || crypto.randomUUID(),
      title: String(entry.title || '').trim().slice(0, 120),
      username: String(entry.username || '').slice(0, 300),
      password: String(entry.password || '').slice(0, 1000),
      url: String(entry.url || '').slice(0, 1000),
      notes: String(entry.notes || '').slice(0, 10000),
      folderId: this.payload.folders.some((folder) => folder.id === entry.folderId) ? entry.folderId : 'personal',
      favorite: Boolean(entry.favorite),
      createdAt: entry.createdAt || now,
      updatedAt: now,
    };
    const index = this.payload.entries.findIndex((item) => item.id === safeEntry.id);
    if (!safeEntry.title) throw new Error('ENTRY_TITLE_REQUIRED');
    if (index >= 0 && safeEntry.password !== this.payload.entries[index].password && String(entry.currentPassword || '') !== this.payload.entries[index].password) {
      throw new Error('INVALID_CURRENT_ENTRY_PASSWORD');
    }
    if (index >= 0) this.payload.entries[index] = safeEntry;
    else this.payload.entries.unshift(safeEntry);
    await this.persist();
    return this.getSnapshot();
  }

  async deleteEntry(id) {
    this.assertUnlocked();
    this.payload.entries = this.payload.entries.filter((entry) => entry.id !== id);
    await this.persist();
    return this.getSnapshot();
  }

  async saveNote(note) {
    this.assertUnlocked();
    const now = new Date().toISOString();
    const safeNote = {
      id: note.id || crypto.randomUUID(),
      title: String(note.title || '').trim().slice(0, 160),
      body: String(note.body || '').slice(0, 100000),
      createdAt: note.createdAt || now,
      updatedAt: now,
    };
    if (!safeNote.title) throw new Error('NOTE_TITLE_REQUIRED');
    const index = this.payload.notes.findIndex((item) => item.id === safeNote.id);
    if (index >= 0) this.payload.notes[index] = safeNote;
    else this.payload.notes.unshift(safeNote);
    await this.persist();
    return this.getSnapshot();
  }

  async deleteNote(id) {
    this.assertUnlocked();
    const attachments = this.payload.media.filter((item) => item.scope === 'note' && item.noteId === id);
    this.payload.notes = this.payload.notes.filter((note) => note.id !== id);
    this.payload.media = this.payload.media.filter((item) => !(item.scope === 'note' && item.noteId === id));
    for (const item of attachments) await this.secureDeleteFile(path.join(this.mediaDir, `${item.id}.nvm`));
    await this.persist();
    return this.getSnapshot();
  }

  async importNoteAttachments(noteId, filePaths) {
    this.assertUnlocked();
    if (!this.payload.notes.some((note) => note.id === noteId)) throw new Error('NOTE_NOT_FOUND');
    const added = [];
    for (const filePath of filePaths) {
      const stat = await fsp.stat(filePath);
      const mime = this.mimeFromPath(filePath);
      if (!stat.isFile() || stat.size > MAX_MEDIA_SIZE || !mime?.startsWith('image/')) continue;
      const plain = await fsp.readFile(filePath);
      const id = crypto.randomUUID();
      const envelope = aesEncrypt(this.key, plain, `media:${id}`);
      plain.fill(0);
      await this.atomicWrite(path.join(this.mediaDir, `${id}.nvm`), JSON.stringify(envelope));
      const item = { id, name: path.basename(filePath).slice(0, 240), type: mime, size: stat.size, scope: 'note', noteId, createdAt: new Date().toISOString() };
      this.payload.media.unshift(item);
      added.push(item);
    }
    await this.persist();
    return { snapshot: this.getSnapshot(), added: added.length };
  }

  async importNoteImageBuffer(noteId, buffer, name = 'Изображение из буфера.png') {
    this.assertUnlocked();
    if (!this.payload.notes.some((note) => note.id === noteId)) throw new Error('NOTE_NOT_FOUND');
    const plain = Buffer.from(buffer);
    if (!plain.length || plain.length > MAX_MEDIA_SIZE) throw new Error('INVALID_MEDIA');
    const id = crypto.randomUUID();
    const envelope = aesEncrypt(this.key, plain, `media:${id}`);
    plain.fill(0);
    await this.atomicWrite(path.join(this.mediaDir, `${id}.nvm`), JSON.stringify(envelope));
    this.payload.media.unshift({ id, name: String(name).slice(0, 240), type: 'image/png', size: buffer.length, scope: 'note', noteId, createdAt: new Date().toISOString() });
    await this.persist();
    return this.getSnapshot();
  }

  async importMedia(filePaths) {
    this.assertUnlocked();
    const added = [];
    for (const filePath of filePaths) {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_MEDIA_SIZE) continue;
      const mime = this.mimeFromPath(filePath);
      if (!mime) continue;
      const plain = await fsp.readFile(filePath);
      const id = crypto.randomUUID();
      const envelope = aesEncrypt(this.key, plain, `media:${id}`);
      plain.fill(0);
      await this.atomicWrite(path.join(this.mediaDir, `${id}.nvm`), JSON.stringify(envelope));
      const item = { id, name: path.basename(filePath).slice(0, 240), type: mime, size: stat.size, createdAt: new Date().toISOString() };
      this.payload.media.unshift(item);
      added.push(item);
    }
    await this.persist();
    return { snapshot: this.getSnapshot(), added: added.length };
  }

  async importDocuments(filePaths) {
    this.assertUnlocked();
    const added = [];
    for (const filePath of filePaths) {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_MEDIA_SIZE) continue;
      const mime = this.documentMimeFromPath(filePath);
      if (!mime) continue;
      const plain = await fsp.readFile(filePath);
      const id = crypto.randomUUID();
      const envelope = aesEncrypt(this.key, plain, `media:${id}`);
      plain.fill(0);
      await this.atomicWrite(path.join(this.mediaDir, `${id}.nvm`), JSON.stringify(envelope));
      const item = { id, name: path.basename(filePath).slice(0, 240), type: mime, kind: 'document', size: stat.size, createdAt: new Date().toISOString() };
      this.payload.media.unshift(item);
      added.push(item);
    }
    await this.persist();
    return { snapshot: this.getSnapshot(), added: added.length };
  }

  async getMedia(id) {
    this.assertUnlocked();
    const item = this.payload.media.find((media) => media.id === id);
    if (!item) throw new Error('MEDIA_NOT_FOUND');
    const envelope = JSON.parse(await fsp.readFile(path.join(this.mediaDir, `${id}.nvm`), 'utf8'));
    return { buffer: aesDecrypt(this.key, envelope, `media:${id}`), mime: item.type, name: item.name };
  }

  async deleteMedia(id) {
    this.assertUnlocked();
    this.payload.media = this.payload.media.filter((item) => item.id !== id);
    await this.secureDeleteFile(path.join(this.mediaDir, `${id}.nvm`));
    await this.persist();
    return this.getSnapshot();
  }

  async renameMedia(id, name) {
    this.assertUnlocked();
    const item = this.payload.media.find((media) => media.id === id);
    if (!item) throw new Error('MEDIA_NOT_FOUND');
    const clean = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 220);
    if (!clean) throw new Error('INVALID_MEDIA_NAME');
    const currentExtension = path.extname(item.name);
    item.name = path.extname(clean) ? clean : `${clean}${currentExtension}`;
    await this.persist();
    return this.getSnapshot();
  }

  mimeFromPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ({
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
      '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.aac': 'audio/aac',
    })[ext] || null;
  }

  documentMimeFromPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ({
      '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.rtf': 'application/rtf', '.csv': 'text/csv',
      '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet', '.odp': 'application/vnd.oasis.opendocument.presentation',
    })[ext] || null;
  }

  async persist() {
    this.assertUnlocked();
    this.payload.updatedAt = new Date().toISOString();
    const plain = Buffer.from(JSON.stringify(this.payload));
    this.container.payload = aesEncrypt(this.key, plain, 'vault-payload-v1');
    plain.fill(0);
    await this.atomicWrite(this.containerPath, JSON.stringify(this.container));
  }

  async readContainer() {
    if (!this.exists()) throw new Error('VAULT_NOT_FOUND');
    const parsed = JSON.parse(await fsp.readFile(this.containerPath, 'utf8'));
    if (parsed.version !== VAULT_VERSION) throw new Error('UNSUPPORTED_VAULT_VERSION');
    return parsed;
  }

  async atomicWrite(targetPath, contents) {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(tempPath, contents, { mode: 0o600 });
    await fsp.rename(tempPath, targetPath);
  }

  async readSecurityState() {
    try {
      return JSON.parse(await fsp.readFile(this.securityPath, 'utf8'));
    } catch {
      return { failedAttempts: 0 };
    }
  }

  async getPublicSecuritySettings() {
    if (this.payload) return this.payload.settings;
    try {
      const state = await this.readSecurityState();
      return { wipeEnabled: Boolean(state.wipeEnabled), wipeThreshold: Number(state.wipeThreshold) || 15 };
    } catch {
      return { wipeEnabled: false, wipeThreshold: 15 };
    }
  }

  async writeSecurityState(patch) {
    const previous = await this.readSecurityState();
    const settings = this.payload?.settings;
    const state = {
      ...previous,
      ...patch,
      wipeEnabled: settings ? Boolean(settings.wipeEnabled) : Boolean(previous.wipeEnabled),
      wipeThreshold: settings ? Number(settings.wipeThreshold) : Number(previous.wipeThreshold || 15),
    };
    await this.atomicWrite(this.securityPath, JSON.stringify(state));
  }

  async destroyVault() {
    this.lock({ preserveQuickUnlock: false });
    const resolvedRoot = path.resolve(this.rootDir);
    if (resolvedRoot.length < 12 || path.parse(resolvedRoot).root === resolvedRoot) throw new Error('UNSAFE_WIPE_PATH');
    if (fs.existsSync(resolvedRoot)) {
      const files = await this.collectFiles(resolvedRoot);
      for (const file of files) await this.secureDeleteFile(file);
      await fsp.rm(resolvedRoot, { recursive: true, force: true });
    }
    if (typeof this.onWiped === 'function') await this.onWiped();
  }

  async collectFiles(directory) {
    const output = [];
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) output.push(...await this.collectFiles(fullPath));
      else if (entry.isFile()) output.push(fullPath);
    }
    return output;
  }

  async secureDeleteFile(filePath) {
    try {
      const stat = await fsp.stat(filePath);
      const handle = await fsp.open(filePath, 'r+');
      const chunkSize = Math.min(1024 * 1024, Math.max(1, stat.size));
      let offset = 0;
      while (offset < stat.size) {
        const length = Math.min(chunkSize, stat.size - offset);
        await handle.write(crypto.randomBytes(length), 0, length, offset);
        offset += length;
      }
      await handle.sync();
      await handle.close();
      await fsp.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  assertUnlocked() {
    if (!this.isUnlocked()) throw new Error('VAULT_LOCKED');
  }
}

module.exports = { VaultService, formatRecoveryKey, parseRecoveryKey };
