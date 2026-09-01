const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { generateTotp, normalizeBase32, parseOtpAuthUri } = require('./otp-service');

const VAULT_VERSION = 1;
const SCRYPT_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const MIN_MASTER_PASSWORD_LENGTH = 14;
const MAX_MEDIA_SIZE = 4 * 1024 * 1024 * 1024;
const MAX_NOTE_IMAGE_SIZE = 64 * 1024 * 1024;
const MAX_IN_MEMORY_MEDIA_SIZE = 64 * 1024 * 1024;
const MAX_EDITABLE_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_RECORDED_AUDIO_SIZE = 64 * 1024 * 1024;
const MAX_DOCUMENT_VERSIONS = 20;
const STORAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_MAGIC = Buffer.from('NVM2');
const MEDIA_HEADER_BYTES = 20;
const MEDIA_CHUNK_SIZE = 1024 * 1024;
const MEDIA_RECORD_OVERHEAD = 28;
const BACKUP_MAGIC = Buffer.from('NOCTWIN1');
const BACKUP_VERSION = 1;
const MAX_BACKUP_CONTAINER_BYTES = 16 * 1024 * 1024;
const MAX_BACKUP_FILES = 20_000;
const ORGANIZER_SECTIONS = new Set(['passwords', 'notes', 'media', 'documents', 'otp']);
const ENTITY_COLLECTIONS = {
  passwords: 'entries',
  notes: 'notes',
  media: 'media',
  documents: 'media',
  otp: 'otp',
};
const COMMON_MASTER_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'qwerty', 'qwerty123', 'qwertyuiop',
  '1234567890', '12345678901234', 'letmein', 'admin', 'welcome', 'iloveyou',
  'пароль', 'пароль123', 'йцукен', 'мастерпароль',
]);
const PREDICTABLE_SEQUENCES = [
  '0123456789', '9876543210',
  'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba',
  'qwertyuiopasdfghjklzxcvbnm', 'mnbvcxzlkjhgfdsaqpoiuytrewq',
  'йцукенгшщзхъфывапролджэячсмитьбю', 'юбьтимсчяэждлорпавыфъхзщшгнекуцй',
];

function encode(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function decode(value) {
  return Buffer.from(value, 'base64');
}

function decodeExactBase64(value, bytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('INVALID_QUICK_UNLOCK_STATE');
  const decoded = decode(value);
  try {
    if (decoded.length !== bytes || encode(decoded) !== value) throw new Error('INVALID_QUICK_UNLOCK_STATE');
  } finally { decoded.fill(0); }
}

function normalizeQuickUnlockState(value) {
  if (!value || typeof value !== 'object' || !['pin', 'pattern'].includes(value.mode)) throw new Error('INVALID_QUICK_UNLOCK_STATE');
  decodeExactBase64(value.salt, 16);
  if (!value.wrap || typeof value.wrap !== 'object') throw new Error('INVALID_QUICK_UNLOCK_STATE');
  decodeExactBase64(value.wrap.nonce, 12);
  decodeExactBase64(value.wrap.tag, 16);
  decodeExactBase64(value.wrap.ciphertext, 32);
  return {
    mode: value.mode,
    salt: value.salt,
    wrap: { nonce: value.wrap.nonce, ciphertext: value.wrap.ciphertext, tag: value.wrap.tag },
  };
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

function encryptMediaChunk(key, value, aad) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

function decryptMediaChunk(key, value, aad) {
  if (value.length < MEDIA_RECORD_OVERHEAD) throw new Error('MEDIA_CORRUPTED');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]);
}

function mediaHeader(size) {
  const header = Buffer.alloc(MEDIA_HEADER_BYTES);
  MEDIA_MAGIC.copy(header, 0);
  header.writeUInt32BE(MEDIA_CHUNK_SIZE, 4);
  header.writeBigUInt64BE(BigInt(size), 8);
  return header;
}

async function readFully(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (!result.bytesRead) break;
    offset += result.bytesRead;
  }
  return offset;
}

async function writeFully(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    if (!result.bytesWritten) throw new Error('SHORT_FILE_WRITE');
    offset += result.bytesWritten;
  }
}

async function readExact(handle, length, position) {
  const buffer = Buffer.alloc(length);
  if (await readFully(handle, buffer, position) !== length) {
    buffer.fill(0);
    throw new Error('BACKUP_TRUNCATED');
  }
  return buffer;
}

async function copyFileIntoHandle(sourcePath, targetHandle, position) {
  const source = await fsp.open(sourcePath, 'r');
  const buffer = Buffer.allocUnsafe(256 * 1024);
  let sourceOffset = 0;
  let targetOffset = position;
  try {
    const stat = await source.stat();
    while (sourceOffset < stat.size) {
      const length = Math.min(buffer.length, stat.size - sourceOffset);
      const { bytesRead } = await source.read(buffer, 0, length, sourceOffset);
      if (!bytesRead) throw new Error('BACKUP_SOURCE_CHANGED');
      await writeFully(targetHandle, buffer.subarray(0, bytesRead), targetOffset);
      sourceOffset += bytesRead;
      targetOffset += bytesRead;
    }
    return stat.size;
  } finally {
    buffer.fill(0);
    await source.close();
  }
}

async function copyHandleRange(sourceHandle, targetPath, position, length) {
  const target = await fsp.open(targetPath, 'wx', 0o600);
  const buffer = Buffer.allocUnsafe(256 * 1024);
  let sourceOffset = position;
  let targetOffset = 0;
  try {
    while (targetOffset < length) {
      const chunkLength = Math.min(buffer.length, length - targetOffset);
      const { bytesRead } = await sourceHandle.read(buffer, 0, chunkLength, sourceOffset);
      if (!bytesRead) throw new Error('BACKUP_TRUNCATED');
      await writeFully(target, buffer.subarray(0, bytesRead), targetOffset);
      sourceOffset += bytesRead;
      targetOffset += bytesRead;
    }
    await target.sync();
  } finally {
    buffer.fill(0);
    await target.close();
  }
}

function derivePasswordKey(secret, salt) {
  return crypto.scryptSync(secret.normalize('NFKC'), salt, 32, SCRYPT_OPTIONS);
}

function deriveRecoveryKey(recoveryBytes, salt) {
  return Buffer.from(crypto.hkdfSync('sha256', recoveryBytes, salt, Buffer.from('nocturne-recovery-v1'), 32));
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

function normalizeSection(value) {
  const section = String(value || 'passwords');
  if (!ORGANIZER_SECTIONS.has(section)) throw new Error('INVALID_ORGANIZER_SECTION');
  return section;
}

function normalizeTags(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const unique = new Map();
  for (const raw of values) {
    const tag = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    const key = tag.toLocaleLowerCase('ru-RU');
    if (tag && !unique.has(key)) unique.set(key, tag);
    if (unique.size >= 20) break;
  }
  return [...unique.values()];
}

function itemBelongsToSection(item, section) {
  if (section === 'documents') return item.kind === 'document' && !item.scope;
  if (section === 'media') return item.kind !== 'document' && !item.scope;
  return true;
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
      screenProtection: true,
      blurOnFocusLoss: true,
      trashRetentionDays: 30,
      wipeEnabled: false,
      wipeThreshold: 15,
    },
    folders: [
      { id: 'personal', name: 'Личное', icon: 'user', section: 'passwords', parentId: null, createdAt: now },
      { id: 'work', name: 'Работа', icon: 'briefcase', section: 'passwords', parentId: null, createdAt: now },
      { id: 'finance', name: 'Финансы', icon: 'wallet', section: 'passwords', parentId: null, createdAt: now },
    ],
    entries: [],
    notes: [],
    media: [],
    documentVersions: [],
    trash: [],
    pendingFileDeletes: [],
    otp: [],
    quickUnlockProfile: null,
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
    this.authenticationQueue = Promise.resolve();
    this.mediaMigrations = new Map();
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

    vaultKey.fill(0);
    passwordKey.fill(0);
    recoveryKey.fill(0);
    await this.persist();
    await this.writeSecurityState({ failedAttempts: 0 });
    const recoveryKeyText = formatRecoveryKey(recoveryBytes);
    recoveryBytes.fill(0);
    return { recoveryKey: recoveryKeyText };
  }

  validateMasterPassword(value) {
    if (typeof value !== 'string') throw new Error('WEAK_MASTER_PASSWORD');
    if (value.length > 256) throw new Error('MASTER_PASSWORD_TOO_LONG');
    const normalized = value.normalize('NFKC').trim();
    const classified = normalized.toLocaleLowerCase('ru-RU').replace(/\s+/g, '');
    if (normalized.length < MIN_MASTER_PASSWORD_LENGTH || COMMON_MASTER_PASSWORDS.has(classified)) throw new Error('WEAK_MASTER_PASSWORD');
    if (/^\d+$/u.test(classified)) throw new Error('WEAK_MASTER_PASSWORD');
    if (PREDICTABLE_SEQUENCES.some((sequence) => sequence.repeat(3).includes(classified))) throw new Error('WEAK_MASTER_PASSWORD');
    if (/^(.)\1+$/u.test(normalized)) throw new Error('WEAK_MASTER_PASSWORD');
    for (let size = 1; size <= Math.min(8, Math.floor(normalized.length / 2)); size += 1) {
      if (normalized.length % size === 0 && normalized === normalized.slice(0, size).repeat(normalized.length / size)) throw new Error('WEAK_MASTER_PASSWORD');
    }
  }

  serializeAuthentication(task) {
    const run = this.authenticationQueue.then(task, task);
    this.authenticationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async unlockWithPassword(masterPassword) {
    return this.serializeAuthentication(() => this.unlockWithPasswordLocked(masterPassword));
  }

  async unlockWithPasswordLocked(masterPassword) {
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
      return this.recordFailedAttemptLocked();
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

  async unlockWithRecovery(recoveryKeyText) {
    return this.serializeAuthentication(() => this.unlockWithRecoveryLocked(recoveryKeyText));
  }

  async unlockWithRecoveryLocked(recoveryKeyText) {
    const container = await this.readContainer();
    const recoveryBytes = parseRecoveryKey(recoveryKeyText);
    const recoveryKey = deriveRecoveryKey(recoveryBytes, decode(container.recovery.salt));
    let vaultKey;
    try {
      try {
        vaultKey = aesDecrypt(recoveryKey, container.recovery.wrap, 'recovery-wrap-v1');
      } catch { throw new Error('INVALID_RECOVERY_KEY'); }
      try {
        await this.finishUnlock(container, vaultKey);
        await this.writeSecurityState({ failedAttempts: 0, lockedUntil: 0 });
        return this.getSnapshot();
      }
      catch {
        this.lock({ preserveQuickUnlock: false });
        throw new Error('VAULT_CORRUPTED');
      }
    } finally {
      vaultKey?.fill(0);
      recoveryBytes.fill(0);
      recoveryKey.fill(0);
    }
  }

  async finishUnlock(container, vaultKey) {
    const plain = aesDecrypt(vaultKey, container.payload, 'vault-payload-v1');
    let payload;
    try { payload = JSON.parse(plain.toString('utf8')); }
    finally { plain.fill(0); }
    if (!payload || typeof payload !== 'object' || !payload.settings || !Array.isArray(payload.folders) || !Array.isArray(payload.entries)) throw new Error('VAULT_CORRUPTED');
    payload.notes = Array.isArray(payload.notes) ? payload.notes : [];
    payload.media = Array.isArray(payload.media) ? payload.media : [];
    payload.documentVersions = Array.isArray(payload.documentVersions) ? payload.documentVersions : [];
    payload.trash = Array.isArray(payload.trash) ? payload.trash : [];
    payload.pendingFileDeletes = Array.isArray(payload.pendingFileDeletes) ? payload.pendingFileDeletes.filter((id) => STORAGE_ID_PATTERN.test(id)) : [];
    payload.otp = Array.isArray(payload.otp) ? payload.otp : [];
    payload.folders = payload.folders
      .filter((folder) => folder && typeof folder.id === 'string' && typeof folder.name === 'string')
      .map((folder) => ({
        ...folder,
        section: ORGANIZER_SECTIONS.has(folder.section) ? folder.section : 'passwords',
        parentId: typeof folder.parentId === 'string' ? folder.parentId : null,
        favorite: Boolean(folder.favorite),
      }));
    const folderIds = new Set(payload.folders.map((folder) => folder.id));
    for (const folder of payload.folders) {
      if (!folder.parentId || !folderIds.has(folder.parentId) || folder.parentId === folder.id) folder.parentId = null;
    }
    const normalizeItems = (items, section) => {
      const sectionFolders = new Set(payload.folders.filter((folder) => folder.section === section).map((folder) => folder.id));
      for (const item of items) {
        if (!itemBelongsToSection(item, section)) continue;
        item.folderId = sectionFolders.has(item.folderId) ? item.folderId : null;
        item.tags = normalizeTags(item.tags);
        item.favorite = Boolean(item.favorite);
      }
    };
    normalizeItems(payload.entries, 'passwords');
    normalizeItems(payload.notes, 'notes');
    normalizeItems(payload.media, 'media');
    normalizeItems(payload.media, 'documents');
    normalizeItems(payload.otp, 'otp');
    let quickProfileChanged = false;
    this.clearQuickUnlock();
    if (payload.quickUnlockProfile) {
      try { this.restoreQuickUnlockState(payload.quickUnlockProfile); }
      catch {
        payload.quickUnlockProfile = null;
        payload.settings.quickUnlockMode = 'none';
        quickProfileChanged = true;
      }
    } else if (payload.settings.quickUnlockMode === 'pin' || payload.settings.quickUnlockMode === 'pattern') {
      payload.settings.quickUnlockMode = 'none';
      quickProfileChanged = true;
    }
    payload.settings.screenProtection = payload.settings.screenProtection !== false;
    payload.settings.blurOnFocusLoss = payload.settings.blurOnFocusLoss !== false;
    payload.settings.trashRetentionDays = [1, 7, 30, 90].includes(Number(payload.settings.trashRetentionDays)) ? Number(payload.settings.trashRetentionDays) : 30;
    this.container = container;
    this.key = Buffer.from(vaultKey);
    this.payload = payload;
    if ((await this.purgeExpiredTrash()) || quickProfileChanged) await this.persist();
    await this.flushPendingFileDeletes();
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

  exportQuickUnlockState() {
    return this.sessionQuickWrap ? normalizeQuickUnlockState(this.sessionQuickWrap) : null;
  }

  restoreQuickUnlockState(value) {
    this.sessionQuickWrap = normalizeQuickUnlockState(value);
    return this.sessionQuickWrap.mode;
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
      this.payload.quickUnlockProfile = null;
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
    this.payload.quickUnlockProfile = this.exportQuickUnlockState();
    this.payload.settings.quickUnlockMode = mode;
    await this.persist();
    return this.getSnapshot();
  }

  async quickUnlock(mode, credential) {
    return this.serializeAuthentication(() => this.quickUnlockLocked(mode, credential));
  }

  async quickUnlockLocked(mode, credential) {
    if (!this.sessionQuickWrap || this.sessionQuickWrap.mode !== mode) throw new Error('QUICK_UNLOCK_UNAVAILABLE');
    const state = await this.readSecurityState();
    if (Number(state.lockedUntil) > Date.now()) {
      return { unlocked: false, failedAttempts: state.failedAttempts || 0, retryAfterSeconds: Math.ceil((state.lockedUntil - Date.now()) / 1000) };
    }
    const quickKey = derivePasswordKey(`quick:${mode}:${credential}`, decode(this.sessionQuickWrap.salt));
    let vaultKey;
    try {
      vaultKey = aesDecrypt(quickKey, this.sessionQuickWrap.wrap, 'quick-wrap-v1');
    } catch {
      return this.recordFailedAttemptLocked();
    } finally {
      quickKey.fill(0);
    }
    try {
      const container = await this.readContainer();
      await this.finishUnlock(container, vaultKey);
      await this.writeSecurityState({ failedAttempts: 0, lockedUntil: 0 });
      return this.getSnapshot();
    } catch {
      this.lock({ preserveQuickUnlock: false });
      throw new Error('VAULT_CORRUPTED');
    } finally { vaultKey.fill(0); }
  }

  async recordFailedAttempt() {
    return this.serializeAuthentication(() => this.recordFailedAttemptLocked());
  }

  async recordFailedAttemptLocked() {
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
      documents: this.payload.media.filter((item) => item.kind === 'document' && !item.scope).map((item) => ({
        ...item,
        versionCount: this.payload.documentVersions.filter((version) => version.documentId === item.id).length,
      })),
      otp: this.payload.otp.map(({ secret: _secret, ...item }) => ({ ...item })),
      trash: this.payload.trash.map((record) => ({
        id: record.id,
        entityType: record.entityType,
        name: record.name,
        deletedAt: record.deletedAt,
        size: Number(record.data?.media?.size || 0),
        attachmentCount: Array.isArray(record.data?.attachments) ? record.data.attachments.length : 0,
      })),
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
      folderId: this.payload.folders.some((folder) => folder.id === entry.folderId && folder.section === 'otp') ? entry.folderId : (previous?.folderId || null),
      tags: normalizeTags(entry.tags ?? previous?.tags),
      favorite: entry.favorite === undefined ? Boolean(previous?.favorite) : Boolean(entry.favorite),
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
    const item = this.payload.otp.find((candidate) => candidate.id === id);
    if (!item) throw new Error('OTP_NOT_FOUND');
    const previousOtp = [...this.payload.otp];
    const previousTrash = [...this.payload.trash];
    try {
      this.payload.otp = this.payload.otp.filter((candidate) => candidate.id !== id);
      await this.moveToTrash('otp', item.issuer || item.account || 'TOTP', { otp: item });
      await this.persist();
    } catch (error) {
      this.payload.otp = previousOtp;
      this.payload.trash = previousTrash;
      throw error;
    }
    return this.getSnapshot();
  }

  async saveSettings(settings) {
    this.assertUnlocked();
    const allowed = ['autoLockMinutes', 'lockOnMinimize', 'lockOnSystemLock', 'clipboardSeconds', 'screenProtection', 'blurOnFocusLoss', 'trashRetentionDays', 'wipeEnabled', 'wipeThreshold'];
    for (const key of allowed) {
      if (Object.hasOwn(settings, key)) this.payload.settings[key] = settings[key];
    }
    this.payload.settings.autoLockMinutes = Math.max(1, Math.min(120, Number(this.payload.settings.autoLockMinutes) || 5));
    this.payload.settings.clipboardSeconds = Math.max(5, Math.min(120, Number(this.payload.settings.clipboardSeconds) || 30));
    this.payload.settings.screenProtection = this.payload.settings.screenProtection !== false;
    this.payload.settings.blurOnFocusLoss = this.payload.settings.blurOnFocusLoss !== false;
    this.payload.settings.trashRetentionDays = [1, 7, 30, 90].includes(Number(this.payload.settings.trashRetentionDays)) ? Number(this.payload.settings.trashRetentionDays) : 30;
    this.payload.settings.wipeThreshold = Math.max(10, Math.min(50, Number(this.payload.settings.wipeThreshold) || 15));
    const queuedDeletes = await this.purgeExpiredTrash();
    await this.persist();
    if (queuedDeletes) await this.flushPendingFileDeletes();
    await this.writeSecurityState({ failedAttempts: 0 });
    return this.getSnapshot();
  }

  async addFolder(input) {
    this.assertUnlocked();
    const value = typeof input === 'string' ? { name: input, section: 'passwords' } : input || {};
    const section = normalizeSection(value.section);
    const name = String(value.name || '').trim().replace(/\s+/g, ' ').slice(0, 64);
    if (!name) throw new Error('INVALID_FOLDER_NAME');
    const parent = value.parentId ? this.payload.folders.find((folder) => folder.id === value.parentId && folder.section === section) : null;
    if (value.parentId && !parent) throw new Error('FOLDER_NOT_FOUND');
    const duplicate = this.payload.folders.some((folder) => folder.section === section && folder.parentId === (parent?.id || null) && folder.name.toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU'));
    if (duplicate) throw new Error('FOLDER_ALREADY_EXISTS');
    this.payload.folders.push({ id: crypto.randomUUID(), name, icon: 'folder', section, parentId: parent?.id || null, favorite: false, createdAt: new Date().toISOString() });
    await this.persist();
    return this.getSnapshot();
  }

  async renameFolder(id, name) {
    this.assertUnlocked();
    const folder = this.payload.folders.find((candidate) => candidate.id === id);
    if (!folder) throw new Error('FOLDER_NOT_FOUND');
    const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 64);
    if (!clean) throw new Error('INVALID_FOLDER_NAME');
    const duplicate = this.payload.folders.some((candidate) => candidate.id !== id && candidate.section === folder.section && candidate.parentId === folder.parentId && candidate.name.toLocaleLowerCase('ru-RU') === clean.toLocaleLowerCase('ru-RU'));
    if (duplicate) throw new Error('FOLDER_ALREADY_EXISTS');
    folder.name = clean;
    folder.updatedAt = new Date().toISOString();
    await this.persist();
    return this.getSnapshot();
  }

  async updateFolderMetadata({ ids, favorite }) {
    this.assertUnlocked();
    const selected = new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string').slice(0, 500));
    if (!selected.size) throw new Error('FOLDER_NOT_FOUND');
    const folders = this.payload.folders.filter((folder) => selected.has(folder.id));
    if (!folders.length) throw new Error('FOLDER_NOT_FOUND');
    for (const folder of folders) {
      if (favorite !== undefined) folder.favorite = Boolean(favorite);
      folder.updatedAt = new Date().toISOString();
    }
    await this.persist();
    return this.getSnapshot();
  }

  folderTreeIds(ids) {
    const selected = new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string'));
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of this.payload.folders) {
        if (folder.parentId && selected.has(folder.parentId) && !selected.has(folder.id)) {
          selected.add(folder.id);
          changed = true;
        }
      }
    }
    return selected;
  }

  async deleteFolders(ids) {
    this.assertUnlocked();
    const folderIds = this.folderTreeIds(ids);
    const folders = this.payload.folders.filter((folder) => folderIds.has(folder.id));
    if (!folders.length) throw new Error('FOLDER_NOT_FOUND');
    const previousFolders = [...this.payload.folders];
    const previousEntries = [...this.payload.entries];
    const previousNotes = [...this.payload.notes];
    const previousOtp = [...this.payload.otp];
    const previousMedia = [...this.payload.media];
    const previousVersions = [...this.payload.documentVersions];
    const previousTrash = [...this.payload.trash];
    try {
      for (const entry of previousEntries.filter((item) => folderIds.has(item.folderId))) {
        this.payload.entries = this.payload.entries.filter((item) => item.id !== entry.id);
        await this.moveToTrash('entry', entry.title, { entry });
      }
      for (const note of previousNotes.filter((item) => folderIds.has(item.folderId))) {
        const attachments = this.payload.media.filter((item) => item.scope === 'note' && item.noteId === note.id);
        this.payload.notes = this.payload.notes.filter((item) => item.id !== note.id);
        this.payload.media = this.payload.media.filter((item) => !(item.scope === 'note' && item.noteId === note.id));
        await this.moveToTrash('note', note.title, { note, attachments });
      }
      for (const account of previousOtp.filter((item) => folderIds.has(item.folderId))) {
        this.payload.otp = this.payload.otp.filter((item) => item.id !== account.id);
        await this.moveToTrash('otp', account.issuer || account.account || 'TOTP', { otp: account });
      }
      for (const media of previousMedia.filter((item) => !item.scope && folderIds.has(item.folderId))) {
        const versions = media.kind === 'document' ? this.payload.documentVersions.filter((version) => version.documentId === media.id) : [];
        this.payload.media = this.payload.media.filter((item) => item.id !== media.id);
        if (versions.length) this.payload.documentVersions = this.payload.documentVersions.filter((version) => version.documentId !== media.id);
        await this.moveToTrash(media.kind === 'document' ? 'document' : 'media', media.name, { media, versions });
      }
      this.payload.folders = this.payload.folders.filter((folder) => !folderIds.has(folder.id));
      await this.persist();
    } catch (error) {
      this.payload.folders = previousFolders;
      this.payload.entries = previousEntries;
      this.payload.notes = previousNotes;
      this.payload.otp = previousOtp;
      this.payload.media = previousMedia;
      this.payload.documentVersions = previousVersions;
      this.payload.trash = previousTrash;
      throw error;
    }
    return this.getSnapshot();
  }

  sectionItems(section) {
    const normalized = normalizeSection(section);
    const collection = this.payload[ENTITY_COLLECTIONS[normalized]];
    return normalized === 'media' || normalized === 'documents'
      ? collection.filter((item) => itemBelongsToSection(item, normalized))
      : collection;
  }

  targetFolderId(section, folderId) {
    if (!folderId) return null;
    const folder = this.payload.folders.find((candidate) => candidate.id === folderId && candidate.section === normalizeSection(section));
    if (!folder) throw new Error('FOLDER_NOT_FOUND');
    return folder.id;
  }

  async moveFolders({ ids, parentId = null }) {
    this.assertUnlocked();
    const selected = new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string').slice(0, 500));
    const folders = this.payload.folders.filter((folder) => selected.has(folder.id));
    if (!folders.length) throw new Error('FOLDER_NOT_FOUND');
    const sections = new Set(folders.map((folder) => folder.section));
    if (sections.size !== 1) throw new Error('INVALID_ORGANIZER_SECTION');
    const section = folders[0].section;
    const parent = parentId ? this.payload.folders.find((folder) => folder.id === parentId && folder.section === section) : null;
    if (parentId && !parent) throw new Error('FOLDER_NOT_FOUND');
    const movingTrees = this.folderTreeIds([...selected]);
    if (parent && movingTrees.has(parent.id)) throw new Error('FOLDER_CYCLE');
    const roots = folders.filter((folder) => !folder.parentId || !selected.has(folder.parentId));
    const now = new Date().toISOString();
    for (const folder of roots) {
      folder.parentId = parent?.id || null;
      folder.updatedAt = now;
    }
    await this.persist();
    return this.getSnapshot();
  }

  async updateItemMetadata({ section, ids, folderId, tags, favorite }) {
    this.assertUnlocked();
    const normalized = normalizeSection(section);
    const selected = new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string').slice(0, 500));
    if (!selected.size) throw new Error('ITEM_NOT_FOUND');
    const folder = folderId ? this.payload.folders.find((candidate) => candidate.id === folderId && candidate.section === normalized) : null;
    if (folderId && !folder) throw new Error('FOLDER_NOT_FOUND');
    const items = this.sectionItems(normalized).filter((item) => selected.has(item.id));
    if (!items.length) throw new Error('ITEM_NOT_FOUND');
    for (const item of items) {
      if (folderId !== undefined) item.folderId = folder?.id || null;
      if (tags !== undefined) item.tags = normalizeTags(tags);
      if (favorite !== undefined) item.favorite = Boolean(favorite);
      item.updatedAt = new Date().toISOString();
    }
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
      folderId: this.payload.folders.some((folder) => folder.id === entry.folderId && folder.section === 'passwords') ? entry.folderId : null,
      tags: normalizeTags(entry.tags),
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
    const entry = this.payload.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error('ENTRY_NOT_FOUND');
    const previousEntries = [...this.payload.entries];
    const previousTrash = [...this.payload.trash];
    try {
      this.payload.entries = this.payload.entries.filter((candidate) => candidate.id !== id);
      await this.moveToTrash('entry', entry.title, { entry });
      await this.persist();
    } catch (error) {
      this.payload.entries = previousEntries;
      this.payload.trash = previousTrash;
      throw error;
    }
    return this.getSnapshot();
  }

  async saveNote(note) {
    this.assertUnlocked();
    const now = new Date().toISOString();
    const safeNote = {
      id: note.id || crypto.randomUUID(),
      title: String(note.title || '').trim().slice(0, 160),
      body: String(note.body || '').slice(0, 100000),
      folderId: this.payload.folders.some((folder) => folder.id === note.folderId && folder.section === 'notes') ? note.folderId : null,
      tags: normalizeTags(note.tags),
      favorite: Boolean(note.favorite),
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
    const note = this.payload.notes.find((candidate) => candidate.id === id);
    if (!note) throw new Error('NOTE_NOT_FOUND');
    const attachments = this.payload.media.filter((item) => item.scope === 'note' && item.noteId === id);
    const previousNotes = [...this.payload.notes];
    const previousMedia = [...this.payload.media];
    const previousTrash = [...this.payload.trash];
    try {
      this.payload.notes = this.payload.notes.filter((candidate) => candidate.id !== id);
      this.payload.media = this.payload.media.filter((item) => !(item.scope === 'note' && item.noteId === id));
      await this.moveToTrash('note', note.title, { note, attachments });
      await this.persist();
    } catch (error) {
      this.payload.notes = previousNotes;
      this.payload.media = previousMedia;
      this.payload.trash = previousTrash;
      throw error;
    }
    return this.getSnapshot();
  }

  async importNoteAttachments(noteId, filePaths) {
    this.assertUnlocked();
    if (!this.payload.notes.some((note) => note.id === noteId)) throw new Error('NOTE_NOT_FOUND');
    const added = [];
    for (const filePath of filePaths) {
      const stat = await fsp.stat(filePath);
      const mime = this.mimeFromPath(filePath);
      if (!stat.isFile() || stat.size > MAX_NOTE_IMAGE_SIZE || !mime?.startsWith('image/')) continue;
      const id = crypto.randomUUID();
      const size = await this.writeEncryptedMediaFromFile(filePath, id, MAX_NOTE_IMAGE_SIZE);
      const item = { id, name: path.basename(filePath).slice(0, 240), type: mime, size, format: 2, scope: 'note', noteId, createdAt: new Date().toISOString() };
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
    if (!plain.length || plain.length > MAX_NOTE_IMAGE_SIZE) throw new Error('INVALID_MEDIA');
    const id = crypto.randomUUID();
    try { await this.writeEncryptedMediaFromBuffer(plain, id); }
    finally { plain.fill(0); }
    this.payload.media.unshift({ id, name: String(name).slice(0, 240), type: 'image/png', size: buffer.length, format: 2, scope: 'note', noteId, createdAt: new Date().toISOString() });
    await this.persist();
    return this.getSnapshot();
  }

  async importMedia(filePaths, folderId = null) {
    this.assertUnlocked();
    const targetFolderId = this.targetFolderId('media', folderId);
    const added = [];
    for (const source of filePaths) {
      const filePath = typeof source === 'string' ? source : source?.path;
      const sourceName = typeof source === 'object' && source?.name ? path.basename(source.name) : path.basename(filePath || '');
      if (!filePath) continue;
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_MEDIA_SIZE) continue;
      const mime = this.mimeFromPath(sourceName || filePath);
      if (!mime) continue;
      const id = crypto.randomUUID();
      const size = await this.writeEncryptedMediaFromFile(filePath, id, MAX_MEDIA_SIZE);
      const item = { id, name: sourceName.slice(0, 240), type: mime, size, format: 2, folderId: targetFolderId, tags: [], favorite: false, createdAt: new Date().toISOString() };
      this.payload.media.unshift(item);
      added.push(item);
    }
    await this.persist();
    return { snapshot: this.getSnapshot(), added: added.length };
  }

  async importMediaBuffer(buffer, name = 'Снимок экрана.png', type = 'image/png', folderId = null) {
    this.assertUnlocked();
    const targetFolderId = this.targetFolderId('media', folderId);
    const plain = Buffer.from(buffer || []);
    const mime = String(type || '').toLowerCase();
    if (!plain.length || plain.length > MAX_NOTE_IMAGE_SIZE || !mime.startsWith('image/')) {
      plain.fill(0);
      throw new Error('INVALID_MEDIA');
    }
    const id = crypto.randomUUID();
    const cleanName = String(name || 'Снимок экрана.png').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 220) || 'Снимок экрана.png';
    const item = { id, name: cleanName, type: mime, size: plain.length, format: 2, folderId: targetFolderId, tags: [], favorite: false, createdAt: new Date().toISOString() };
    let committed = false;
    try {
      await this.writeEncryptedMediaFromBuffer(plain, id);
      this.payload.media.unshift(item);
      await this.persist();
      committed = true;
      return this.getSnapshot();
    } finally {
      plain.fill(0);
      if (!committed) {
        this.payload.media = this.payload.media.filter((candidate) => candidate.id !== id);
        await this.secureDeleteFile(path.join(this.mediaDir, `${id}.nvm`)).catch(() => {});
      }
    }
  }

  async importRecordedAudio(buffer, name, type, folderId = null) {
    this.assertUnlocked();
    const targetFolderId = this.targetFolderId('media', folderId);
    const plain = Buffer.from(buffer);
    const mime = String(type || '').split(';')[0].toLowerCase();
    if (!plain.length || plain.length > MAX_RECORDED_AUDIO_SIZE || !['audio/webm', 'audio/ogg', 'audio/mp4'].includes(mime)) {
      plain.fill(0);
      throw new Error('INVALID_RECORDED_AUDIO');
    }
    const extension = mime === 'audio/ogg' ? '.ogg' : mime === 'audio/mp4' ? '.m4a' : '.webm';
    const id = crypto.randomUUID();
    const item = {
      id,
      name: `${String(name || 'Голосовая запись').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 200) || 'Голосовая запись'}${extension}`,
      type: mime,
      size: buffer.length,
      format: 2,
      createdAt: new Date().toISOString(),
      folderId: targetFolderId,
      tags: [],
      favorite: false,
    };
    let committed = false;
    try {
      await this.writeEncryptedMediaFromBuffer(plain, id);
      this.payload.media.unshift(item);
      await this.persist();
      committed = true;
    } catch (error) {
      this.payload.media = this.payload.media.filter((candidate) => candidate.id !== id);
      throw error;
    } finally {
      plain.fill(0);
      if (!committed) await this.secureDeleteFile(path.join(this.mediaDir, `${id}.nvm`)).catch(() => {});
    }
    return this.getSnapshot();
  }

  async importDocuments(filePaths, folderId = null) {
    this.assertUnlocked();
    const targetFolderId = this.targetFolderId('documents', folderId);
    const added = [];
    try {
      for (const source of filePaths) {
        const filePath = typeof source === 'string' ? source : source?.path;
        const sourceName = typeof source === 'object' && source?.name ? path.basename(source.name) : path.basename(filePath || '');
        if (!filePath) continue;
        const stat = await fsp.stat(filePath);
        if (!stat.isFile() || stat.size > MAX_MEDIA_SIZE) continue;
        const mime = this.documentMimeFromPath(sourceName || filePath);
        if (!mime) continue;
        const id = crypto.randomUUID();
        const size = await this.writeEncryptedMediaFromFile(filePath, id, MAX_MEDIA_SIZE);
        const item = { id, name: sourceName.slice(0, 240), type: mime, kind: 'document', size, format: 2, folderId: targetFolderId, tags: [], favorite: false, createdAt: new Date().toISOString() };
        this.payload.media.unshift(item);
        added.push(item);
      }
      await this.persist();
    } catch (error) {
      const ids = new Set(added.map((item) => item.id));
      this.payload.media = this.payload.media.filter((item) => !ids.has(item.id));
      for (const item of added) await this.secureDeleteFile(path.join(this.mediaDir, `${item.id}.nvm`)).catch(() => {});
      throw error;
    }
    return { snapshot: this.getSnapshot(), added: added.length };
  }

  async getMedia(id) {
    this.assertUnlocked();
    const item = this.getMediaInfo(id);
    if (Number(item.size) > MAX_IN_MEMORY_MEDIA_SIZE) throw new Error('MEDIA_TOO_LARGE_FOR_MEMORY');
    if (Number(item.size) === 0) return { buffer: Buffer.alloc(0), mime: item.type, name: item.name };
    const chunks = [];
    for await (const chunk of this.createMediaStream(id, 0, Math.max(0, item.size - 1))) chunks.push(chunk);
    try { return { buffer: Buffer.concat(chunks), mime: item.type, name: item.name }; }
    finally { for (const chunk of chunks) chunk.fill(0); }
  }

  getMediaInfo(id) {
    this.assertUnlocked();
    const item = this.payload.media.find((media) => media.id === id)
      || this.payload.documentVersions.find((version) => version.id === id)
      || this.payload.trash.map((record) => record.data?.media).find((media) => media?.id === id)
      || this.payload.trash.flatMap((record) => record.data?.attachments || []).find((media) => media?.id === id)
      || this.payload.trash.flatMap((record) => record.data?.versions || []).find((version) => version?.id === id);
    if (!item) throw new Error('MEDIA_NOT_FOUND');
    return { ...item };
  }

  createMediaStream(id, start = 0, end = null) {
    this.assertUnlocked();
    const item = this.getMediaInfo(id);
    const size = Number(item.size);
    const storageId = item.storageId || item.id;
    if (size === 0) return Readable.from([]);
    const safeStart = Number(start);
    const safeEnd = end === null ? size - 1 : Number(end);
    if (!Number.isSafeInteger(safeStart) || !Number.isSafeInteger(safeEnd) || safeStart < 0 || safeEnd < safeStart || safeEnd >= size) throw new Error('INVALID_MEDIA_RANGE');
    if (item.format !== 2) {
      return Readable.from((async function* migrateAndRead(service) {
        await service.ensureMediaV2(id);
        for await (const chunk of service.createMediaStream(id, safeStart, safeEnd)) yield chunk;
      })(this));
    }
    const service = this;
    return Readable.from((async function* streamChunks() {
      const handle = await fsp.open(path.join(service.mediaDir, `${storageId}.nvm`), 'r');
      try {
        const header = Buffer.alloc(MEDIA_HEADER_BYTES);
        if (await readFully(handle, header, 0) !== header.length || !header.subarray(0, 4).equals(MEDIA_MAGIC)) throw new Error('MEDIA_CORRUPTED');
        const chunkSize = header.readUInt32BE(4);
        const storedSize = Number(header.readBigUInt64BE(8));
        if (chunkSize !== MEDIA_CHUNK_SIZE || storedSize !== size) throw new Error('MEDIA_CORRUPTED');
        const firstChunk = Math.floor(safeStart / chunkSize);
        const lastChunk = Math.floor(safeEnd / chunkSize);
        for (let index = firstChunk; index <= lastChunk; index += 1) {
          if (!service.isUnlocked()) throw new Error('VAULT_LOCKED');
          const plainLength = Math.min(chunkSize, size - index * chunkSize);
          const encryptedLength = MEDIA_RECORD_OVERHEAD + plainLength;
          const encrypted = Buffer.allocUnsafe(encryptedLength);
          const position = MEDIA_HEADER_BYTES + index * (MEDIA_RECORD_OVERHEAD + chunkSize);
          if (await readFully(handle, encrypted, position) !== encryptedLength) { encrypted.fill(0); throw new Error('MEDIA_CORRUPTED'); }
          let plain;
          try {
            plain = decryptMediaChunk(service.key, encrypted, `media:${storageId}:chunk:${index}:v2`);
            const from = index === firstChunk ? safeStart % chunkSize : 0;
            const to = index === lastChunk ? (safeEnd % chunkSize) + 1 : plain.length;
            yield Buffer.from(plain.subarray(from, to));
          } finally {
            encrypted.fill(0);
            plain?.fill(0);
          }
        }
      } finally { await handle.close(); }
    })());
  }

  async exportMedia(id, targetPath) {
    const item = this.getMediaInfo(id);
    const resolvedTarget = path.resolve(targetPath);
    const relativeToVault = path.relative(this.rootDir, resolvedTarget);
    if (!relativeToVault.startsWith('..') && !path.isAbsolute(relativeToVault)) throw new Error('UNSAFE_EXPORT_PATH');
    const temporary = path.join(path.dirname(resolvedTarget), `.${path.basename(resolvedTarget)}.${crypto.randomUUID()}.nocturne-export`);
    const backup = `${temporary}.backup`;
    let movedOriginal = false;
    try {
      await pipeline(this.createMediaStream(id, 0, Math.max(0, item.size - 1)), fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
      try { await fsp.rename(resolvedTarget, backup); movedOriginal = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await fsp.rename(temporary, resolvedTarget); }
      catch (error) {
        if (movedOriginal) await fsp.rename(backup, resolvedTarget).catch(() => {});
        throw error;
      }
      if (movedOriginal) await fsp.rm(backup, { force: true }).catch(() => {});
      return { saved: true, filePath: resolvedTarget };
    } catch (error) {
      await this.secureDeleteFile(temporary).catch(() => {});
      if (movedOriginal && !fs.existsSync(resolvedTarget)) await fsp.rename(backup, resolvedTarget).catch(() => {});
      throw error;
    }
  }

  backupStorageIds() {
    this.assertUnlocked();
    const ids = new Set();
    for (const item of this.payload.media) if (item.id) ids.add(item.storageId || item.id);
    for (const version of this.payload.documentVersions) if (version.id) ids.add(version.storageId || version.id);
    for (const record of this.payload.trash) for (const id of this.trashFileIds(record)) ids.add(id);
    for (const id of this.payload.pendingFileDeletes || []) ids.delete(id);
    return [...ids].filter((id) => STORAGE_ID_PATTERN.test(id)).sort();
  }

  async exportVaultBackup(targetPath, currentPassword) {
    this.assertUnlocked();
    this.verifyMasterPassword(currentPassword);
    await this.persist();
    const resolvedTarget = path.resolve(targetPath);
    const relativeToVault = path.relative(this.rootDir, resolvedTarget);
    if (!relativeToVault.startsWith('..') && !path.isAbsolute(relativeToVault)) throw new Error('UNSAFE_EXPORT_PATH');
    const temporary = `${resolvedTarget}.${crypto.randomUUID()}.tmp`;
    const containerBytes = await fsp.readFile(this.containerPath);
    if (!containerBytes.length || containerBytes.length > MAX_BACKUP_CONTAINER_BYTES) throw new Error('BACKUP_METADATA_TOO_LARGE');
    const ids = this.backupStorageIds();
    if (ids.length > MAX_BACKUP_FILES) throw new Error('BACKUP_TOO_MANY_FILES');
    const handle = await fsp.open(temporary, 'wx', 0o600);
    let position = 0;
    try {
      await writeFully(handle, BACKUP_MAGIC, position); position += BACKUP_MAGIC.length;
      const header = Buffer.alloc(12);
      header.writeUInt32BE(BACKUP_VERSION, 0);
      header.writeUInt32BE(containerBytes.length, 4);
      header.writeUInt32BE(ids.length, 8);
      await writeFully(handle, header, position); position += header.length;
      await writeFully(handle, containerBytes, position); position += containerBytes.length;
      for (const id of ids) {
        const sourcePath = path.join(this.mediaDir, `${id}.nvm`);
        const stat = await fsp.stat(sourcePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MEDIA_SIZE + 1024 * 1024) throw new Error('BACKUP_BLOB_INVALID');
        const record = Buffer.alloc(46);
        record.writeUInt16BE(36, 0);
        record.write(id, 2, 36, 'ascii');
        record.writeBigUInt64BE(BigInt(stat.size), 38);
        await writeFully(handle, record, position); position += record.length;
        position += await copyFileIntoHandle(sourcePath, handle, position);
      }
      await handle.sync();
      await handle.close();
      await fsp.rename(temporary, resolvedTarget);
      return { saved: true, filePath: resolvedTarget, files: ids.length };
    } catch (error) {
      await handle.close().catch(() => {});
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw error;
    } finally {
      containerBytes.fill(0);
    }
  }

  async importVaultBackup(sourcePath, masterPassword) {
    const resolvedSource = path.resolve(sourcePath);
    const parent = path.dirname(this.rootDir);
    const staging = path.join(parent, `vault-import-${crypto.randomUUID()}`);
    const previous = path.join(parent, `vault-previous-${crypto.randomUUID()}`);
    const source = await fsp.open(resolvedSource, 'r');
    let installed = false;
    let hadCurrent = false;
    try {
      const sourceStat = await source.stat();
      if (!sourceStat.isFile() || sourceStat.size < 20) throw new Error('INVALID_BACKUP');
      let position = 0;
      const magic = await readExact(source, BACKUP_MAGIC.length, position); position += magic.length;
      const validMagic = crypto.timingSafeEqual(magic, BACKUP_MAGIC);
      magic.fill(0);
      if (!validMagic) throw new Error('INVALID_BACKUP');
      const header = await readExact(source, 12, position); position += header.length;
      const version = header.readUInt32BE(0);
      const containerLength = header.readUInt32BE(4);
      const count = header.readUInt32BE(8);
      header.fill(0);
      if (version !== BACKUP_VERSION) throw new Error('UNSUPPORTED_BACKUP_VERSION');
      if (!containerLength || containerLength > MAX_BACKUP_CONTAINER_BYTES || count > MAX_BACKUP_FILES) throw new Error('INVALID_BACKUP');
      const containerBytes = await readExact(source, containerLength, position); position += containerLength;
      try {
        const parsed = JSON.parse(containerBytes.toString('utf8'));
        if (parsed.version !== VAULT_VERSION) throw new Error('UNSUPPORTED_VAULT_VERSION');
      } catch (error) {
        if (error.message === 'UNSUPPORTED_VAULT_VERSION') throw error;
        throw new Error('INVALID_BACKUP');
      }
      await fsp.mkdir(path.join(staging, 'media'), { recursive: true });
      await fsp.writeFile(path.join(staging, 'vault.nvlt'), containerBytes, { mode: 0o600 });
      containerBytes.fill(0);
      const seen = new Set();
      for (let index = 0; index < count; index += 1) {
        const record = await readExact(source, 46, position); position += record.length;
        const idLength = record.readUInt16BE(0);
        const id = record.subarray(2, 38).toString('ascii');
        const length = Number(record.readBigUInt64BE(38));
        record.fill(0);
        if (idLength !== 36 || !STORAGE_ID_PATTERN.test(id) || seen.has(id) || !Number.isSafeInteger(length) || length <= 0 || length > MAX_MEDIA_SIZE + 1024 * 1024) throw new Error('INVALID_BACKUP');
        if (position + length > sourceStat.size) throw new Error('BACKUP_TRUNCATED');
        seen.add(id);
        await copyHandleRange(source, path.join(staging, 'media', `${id}.nvm`), position, length);
        position += length;
      }
      if (position !== sourceStat.size) throw new Error('BACKUP_TRAILING_DATA');
      const candidate = new VaultService(staging);
      const candidateSnapshot = await candidate.unlockWithPassword(String(masterPassword || ''));
      if (!candidateSnapshot?.unlocked) throw new Error('WRONG_BACKUP_PASSWORD');
      const referenced = new Set(candidate.backupStorageIds());
      if ([...referenced].some((id) => !seen.has(id))) throw new Error('BACKUP_FILE_SET_MISMATCH');
      candidate.lock({ preserveQuickUnlock: false });
      this.lock({ preserveQuickUnlock: false });
      hadCurrent = fs.existsSync(this.rootDir);
      if (hadCurrent) await fsp.rename(this.rootDir, previous);
      try { await fsp.rename(staging, this.rootDir); }
      catch (error) {
        if (hadCurrent) await fsp.rename(previous, this.rootDir).catch(() => {});
        throw error;
      }
      installed = true;
      const snapshot = await this.unlockWithPassword(String(masterPassword || ''));
      if (!snapshot?.unlocked) throw new Error('WRONG_BACKUP_PASSWORD');
      if (hadCurrent && fs.existsSync(previous)) {
        for (const file of await this.collectFiles(previous)) await this.secureDeleteFile(file);
        await fsp.rm(previous, { recursive: true, force: true });
      }
      return snapshot;
    } finally {
      await source.close().catch(() => {});
      if (!installed) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  async ensureMediaV2(id) {
    const item = this.payload.media.find((media) => media.id === id) || this.payload.documentVersions.find((version) => version.id === id);
    if (!item) throw new Error('MEDIA_NOT_FOUND');
    if (item.format === 2) return;
    if (this.mediaMigrations.has(id)) return this.mediaMigrations.get(id);
    const migration = this.migrateLegacyMedia(id).finally(() => this.mediaMigrations.delete(id));
    this.mediaMigrations.set(id, migration);
    return migration;
  }

  async migrateLegacyMedia(id) {
    this.assertUnlocked();
    const item = this.payload.media.find((media) => media.id === id) || this.payload.documentVersions.find((version) => version.id === id);
    if (!item) throw new Error('MEDIA_NOT_FOUND');
    const storageId = item.storageId || item.id;
    const targetPath = path.join(this.mediaDir, `${storageId}.nvm`);
    const backup = `${targetPath}.legacy-backup`;
    if (!fs.existsSync(targetPath) && fs.existsSync(backup)) await fsp.rename(backup, targetPath);
    for (const name of await fsp.readdir(this.mediaDir)) {
      if (name.startsWith(`${id}.nvm.`) && name.endsWith('.migration')) await fsp.rm(path.join(this.mediaDir, name), { force: true });
    }
    let source = await fsp.open(targetPath, 'r');
    const stat = await source.stat();
    const prefix = Buffer.alloc(Math.min(4096, stat.size));
    const tail = Buffer.alloc(Math.min(4096, stat.size));
    await readFully(source, prefix, 0);
    if (prefix.subarray(0, 4).equals(MEDIA_MAGIC)) {
      await source.close();
      source = null;
      item.format = 2;
      await this.persist();
      await fsp.rm(backup, { force: true }).catch(() => {});
      return;
    }
    await readFully(source, tail, stat.size - tail.length);
    const prefixMatch = /^\{"nonce":"([A-Za-z0-9+/=]+)","ciphertext":"/.exec(prefix.toString('ascii'));
    const suffixMatch = /","tag":"([A-Za-z0-9+/=]+)"\}\s*$/.exec(tail.toString('ascii'));
    if (!prefixMatch || !suffixMatch) { await source.close(); throw new Error('MEDIA_CORRUPTED'); }
    const ciphertextStart = Buffer.byteLength(prefixMatch[0], 'ascii');
    const ciphertextEnd = stat.size - tail.length + suffixMatch.index;
    const ciphertextLength = ciphertextEnd - ciphertextStart;
    if (ciphertextLength <= 0 || ciphertextLength % 4 !== 0) { await source.close(); throw new Error('MEDIA_CORRUPTED'); }
    const nonce = decode(prefixMatch[1]);
    const tag = decode(suffixMatch[1]);
    if (nonce.length !== 12 || tag.length !== 16) { nonce.fill(0); tag.fill(0); await source.close(); throw new Error('MEDIA_CORRUPTED'); }
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAAD(Buffer.from(`media:${storageId}`));
    decipher.setAuthTag(tag);
    nonce.fill(0);
    tag.fill(0);

    const temporary = `${targetPath}.${process.pid}.${crypto.randomUUID()}.migration`;
    let target;
    let backupCreated = false;
    let pending = Buffer.alloc(0);
    let plainSize = 0;
    let encryptedOffset = MEDIA_HEADER_BYTES;
    let chunkIndex = 0;
    const writePlain = async (value, final = false) => {
      const combined = Buffer.concat([pending, value]);
      pending.fill(0);
      value.fill(0);
      pending = combined;
      while (pending.length >= MEDIA_CHUNK_SIZE || (final && pending.length)) {
        const length = Math.min(MEDIA_CHUNK_SIZE, pending.length);
        const chunk = Buffer.from(pending.subarray(0, length));
        const remainder = Buffer.from(pending.subarray(length));
        pending.fill(0);
        pending = remainder;
        const encrypted = encryptMediaChunk(this.key, chunk, `media:${storageId}:chunk:${chunkIndex}:v2`);
        chunk.fill(0);
        try { await writeFully(target, encrypted, encryptedOffset); }
        finally { encrypted.fill(0); }
        plainSize += length;
        encryptedOffset += MEDIA_RECORD_OVERHEAD + length;
        chunkIndex += 1;
      }
    };

    try {
      target = await fsp.open(temporary, 'wx', 0o600);
      await writeFully(target, mediaHeader(item.size), 0);
      const encodedBlockSize = 4 * 349525;
      let encodedOffset = 0;
      while (encodedOffset < ciphertextLength) {
        const length = Math.min(encodedBlockSize, ciphertextLength - encodedOffset);
        const encoded = Buffer.allocUnsafe(length);
        if (await readFully(source, encoded, ciphertextStart + encodedOffset) !== length) { encoded.fill(0); throw new Error('MEDIA_CORRUPTED'); }
        const decoded = Buffer.from(encoded.toString('ascii'), 'base64');
        encoded.fill(0);
        let plain;
        try { plain = decipher.update(decoded); }
        finally { decoded.fill(0); }
        await writePlain(plain);
        encodedOffset += length;
      }
      await writePlain(decipher.final(), true);
      if (plainSize !== Number(item.size)) throw new Error('MEDIA_CORRUPTED');
      await target.sync();
      await target.close();
      target = null;
      await source.close();
      source = null;
      await fsp.rm(backup, { force: true });
      await fsp.rename(targetPath, backup);
      backupCreated = true;
      try { await fsp.rename(temporary, targetPath); }
      catch (error) { await fsp.rename(backup, targetPath); backupCreated = false; throw error; }
      item.format = 2;
      await this.persist();
      backupCreated = false;
      await fsp.rm(backup, { force: true }).catch(() => {});
    } catch (error) {
      pending.fill(0);
      await target?.close().catch(() => {});
      await source?.close().catch(() => {});
      await fsp.rm(temporary, { force: true }).catch(() => {});
      if (backupCreated) {
        await fsp.rm(targetPath, { force: true }).catch(() => {});
        await fsp.rename(backup, targetPath).catch(() => {});
        delete item.format;
      }
      throw error;
    }
  }

  async deleteMedia(id) {
    this.assertUnlocked();
    const item = this.payload.media.find((candidate) => candidate.id === id);
    if (!item) throw new Error('MEDIA_NOT_FOUND');
    const versions = item.kind === 'document'
      ? this.payload.documentVersions.filter((version) => version.documentId === id)
      : [];
    const previousMedia = [...this.payload.media];
    const previousVersions = [...this.payload.documentVersions];
    const previousTrash = [...this.payload.trash];
    try {
      this.payload.media = this.payload.media.filter((candidate) => candidate.id !== id);
      if (versions.length) this.payload.documentVersions = this.payload.documentVersions.filter((version) => version.documentId !== id);
      await this.moveToTrash(item.kind === 'document' ? 'document' : 'media', item.name, { media: item, versions });
      await this.persist();
    } catch (error) {
      this.payload.media = previousMedia;
      this.payload.documentVersions = previousVersions;
      this.payload.trash = previousTrash;
      throw error;
    }
    return this.getSnapshot();
  }

  async saveTextDocument(id, text) {
    this.assertUnlocked();
    const item = this.payload.media.find((candidate) => candidate.id === id && candidate.kind === 'document');
    if (!item) throw new Error('DOCUMENT_NOT_FOUND');
    if (!['text/plain', 'text/markdown', 'text/csv'].includes(item.type)) throw new Error('DOCUMENT_EDIT_UNSUPPORTED');
    const next = Buffer.from(String(text ?? ''), 'utf8');
    if (next.length > MAX_EDITABLE_DOCUMENT_SIZE) { next.fill(0); throw new Error('DOCUMENT_TOO_LARGE_TO_EDIT'); }
    const newStorageId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const oldStorageId = item.storageId || item.id;
    const previous = { storageId: item.storageId, size: item.size, updatedAt: item.updatedAt };
    const previousVersions = [...this.payload.documentVersions];
    const previousPendingDeletes = [...this.payload.pendingFileDeletes];
    let committed = false;
    try {
      await this.writeEncryptedMediaFromBuffer(next, newStorageId);
      const now = new Date().toISOString();
      this.payload.documentVersions.unshift({
        id: versionId,
        storageId: oldStorageId,
        documentId: id,
        name: item.name,
        type: item.type,
        size: Number(item.size),
        format: item.format,
        createdAt: item.updatedAt || item.createdAt || now,
      });
      item.storageId = newStorageId;
      item.size = next.length;
      item.format = 2;
      item.updatedAt = now;
      await this.pruneDocumentVersions(id);
      await this.persist();
      committed = true;
    } catch (error) {
      this.payload.documentVersions = previousVersions;
      this.payload.pendingFileDeletes = previousPendingDeletes;
      if (previous.storageId === undefined) delete item.storageId; else item.storageId = previous.storageId;
      item.size = previous.size;
      item.updatedAt = previous.updatedAt;
      throw error;
    } finally {
      if (!committed) await this.secureDeleteFile(path.join(this.mediaDir, `${newStorageId}.nvm`)).catch(() => {});
      next.fill(0);
    }
    await this.flushPendingFileDeletes();
    return this.getSnapshot();
  }

  async createTextDocument(name, type = 'text/markdown', text = '', folderId = null) {
    this.assertUnlocked();
    const targetFolderId = this.targetFolderId('documents', folderId);
    const mime = ['text/plain', 'text/markdown'].includes(type) ? type : 'text/markdown';
    const extension = mime === 'text/plain' ? '.txt' : '.md';
    const clean = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 200);
    if (!clean) throw new Error('INVALID_MEDIA_NAME');
    const plain = Buffer.from(String(text ?? ''), 'utf8');
    if (plain.length > MAX_EDITABLE_DOCUMENT_SIZE) { plain.fill(0); throw new Error('DOCUMENT_TOO_LARGE_TO_EDIT'); }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const item = { id, name: path.extname(clean) ? clean : `${clean}${extension}`, type: mime, kind: 'document', size: plain.length, format: 2, folderId: targetFolderId, tags: [], favorite: false, createdAt: now, updatedAt: now };
    let committed = false;
    try {
      await this.writeEncryptedMediaFromBuffer(plain, id);
      this.payload.media.unshift(item);
      await this.persist();
      committed = true;
    } catch (error) {
      this.payload.media = this.payload.media.filter((candidate) => candidate.id !== id);
      throw error;
    } finally {
      plain.fill(0);
      if (!committed) await this.secureDeleteFile(path.join(this.mediaDir, `${id}.nvm`)).catch(() => {});
    }
    return this.getSnapshot();
  }

  getDocumentVersions(documentId) {
    this.assertUnlocked();
    const trashVersions = this.payload.trash.flatMap((record) => record.data?.media?.id === documentId ? (record.data?.versions || []) : []);
    return [...this.payload.documentVersions, ...trashVersions]
      .filter((version) => version.documentId === documentId)
      .map(({ id, name, type, size, createdAt }) => ({ id, name, type, size, createdAt }));
  }

  async restoreDocumentVersion(documentId, versionId) {
    this.assertUnlocked();
    const item = this.payload.media.find((candidate) => candidate.id === documentId && candidate.kind === 'document');
    const version = this.payload.documentVersions.find((candidate) => candidate.id === versionId && candidate.documentId === documentId);
    if (!item || !version) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
    const previous = {
      itemStorageId: item.storageId,
      itemSize: item.size,
      itemFormat: item.format,
      itemUpdatedAt: item.updatedAt,
      versionStorageId: version.storageId,
      versionSize: version.size,
      versionFormat: version.format,
      versionCreatedAt: version.createdAt,
    };
    try {
      const now = new Date().toISOString();
      item.storageId = version.storageId || version.id;
      item.size = version.size;
      item.format = version.format;
      item.updatedAt = now;
      version.storageId = previous.itemStorageId || item.id;
      version.size = previous.itemSize;
      version.format = previous.itemFormat;
      version.createdAt = previous.itemUpdatedAt || now;
      await this.persist();
      return this.getSnapshot();
    } catch (error) {
      if (previous.itemStorageId === undefined) delete item.storageId; else item.storageId = previous.itemStorageId;
      item.size = previous.itemSize;
      item.format = previous.itemFormat;
      item.updatedAt = previous.itemUpdatedAt;
      if (previous.versionStorageId === undefined) delete version.storageId; else version.storageId = previous.versionStorageId;
      version.size = previous.versionSize;
      version.format = previous.versionFormat;
      version.createdAt = previous.versionCreatedAt;
      throw error;
    }
  }

  async pruneDocumentVersions(documentId) {
    const versions = this.payload.documentVersions.filter((version) => version.documentId === documentId);
    for (const version of versions.slice(MAX_DOCUMENT_VERSIONS)) {
      this.payload.documentVersions = this.payload.documentVersions.filter((candidate) => candidate.id !== version.id);
      this.queueFileDeletes([version.storageId || version.id]);
    }
  }

  queueFileDeletes(ids) {
    const safeIds = ids.filter((id) => typeof id === 'string' && STORAGE_ID_PATTERN.test(id));
    this.payload.pendingFileDeletes = [...new Set([...this.payload.pendingFileDeletes, ...safeIds])];
  }

  async flushPendingFileDeletes() {
    this.assertUnlocked();
    const before = [...this.payload.pendingFileDeletes];
    if (!before.length) return false;
    const completed = [];
    let firstError = null;
    for (const id of before) {
      try {
        await this.secureDeleteFile(path.join(this.mediaDir, `${id}.nvm`));
        completed.push(id);
      } catch (error) {
        firstError ||= error;
      }
    }
    if (completed.length) {
      const completedIds = new Set(completed);
      this.payload.pendingFileDeletes = before.filter((id) => !completedIds.has(id));
      try { await this.persist(); }
      catch (error) {
        this.payload.pendingFileDeletes = before;
        throw error;
      }
    }
    if (firstError) throw firstError;
    return completed.length > 0;
  }

  async moveToTrash(entityType, name, data) {
    const record = { id: crypto.randomUUID(), entityType, name: String(name || 'Без названия').slice(0, 240), deletedAt: new Date().toISOString(), data };
    this.payload.trash.unshift(record);
    return record;
  }

  getTrashPreview(id, now = Date.now()) {
    this.assertUnlocked();
    const record = this.payload.trash.find((candidate) => candidate.id === id);
    if (!record) throw new Error('TRASH_ITEM_NOT_FOUND');
    const data = record.data || {};
    if (record.entityType === 'entry' && data.entry) return { recordId: id, entityType: 'entry', item: { ...data.entry } };
    if (record.entityType === 'note' && data.note) return { recordId: id, entityType: 'note', item: { ...data.note }, attachments: (data.attachments || []).map((item) => ({ ...item, url: `vaultmedia://${item.id}` })) };
    if (record.entityType === 'otp' && data.otp) {
      const { secret: _secret, ...item } = data.otp;
      return { recordId: id, entityType: 'otp', item: { ...item, ...generateTotp(data.otp, now) } };
    }
    if (['media', 'document'].includes(record.entityType) && data.media) return { recordId: id, entityType: record.entityType, item: { ...data.media, url: `vaultmedia://${data.media.id}` } };
    throw new Error('TRASH_ITEM_CORRUPTED');
  }

  trashFileIds(record) {
    const ids = [];
    if (record.data?.media?.id) ids.push(record.data.media.storageId || record.data.media.id);
    for (const item of record.data?.attachments || []) if (item.id) ids.push(item.storageId || item.id);
    for (const version of record.data?.versions || []) if (version.id) ids.push(version.storageId || version.id);
    return [...new Set(ids)];
  }

  purgeTrashRecord(record) {
    this.queueFileDeletes(this.trashFileIds(record));
    this.payload.trash = this.payload.trash.filter((candidate) => candidate.id !== record.id);
  }

  async purgeExpiredTrash() {
    if (!this.payload) return false;
    const retention = [1, 7, 30, 90].includes(Number(this.payload.settings.trashRetentionDays)) ? Number(this.payload.settings.trashRetentionDays) : 30;
    const cutoff = Date.now() - retention * 24 * 60 * 60 * 1000;
    const expired = this.payload.trash.filter((record) => Number.isFinite(Date.parse(record.deletedAt)) && Date.parse(record.deletedAt) <= cutoff);
    for (const record of expired) this.purgeTrashRecord(record);
    return expired.length > 0;
  }

  async restoreTrashItem(id) {
    this.assertUnlocked();
    const record = this.payload.trash.find((candidate) => candidate.id === id);
    if (!record) throw new Error('TRASH_ITEM_NOT_FOUND');
    const previous = {
      entries: [...this.payload.entries], notes: [...this.payload.notes], otp: [...this.payload.otp],
      media: [...this.payload.media], versions: [...this.payload.documentVersions], trash: [...this.payload.trash],
    };
    try {
      const data = record.data || {};
      const restoreMetadata = (item) => {
        if (item.folderId && !this.payload.folders.some((folder) => folder.id === item.folderId)) item.folderId = null;
        item.tags = normalizeTags(item.tags);
        item.favorite = Boolean(item.favorite);
        return item;
      };
      if (record.entityType === 'entry' && data.entry) this.payload.entries.unshift(restoreMetadata(data.entry));
      else if (record.entityType === 'note' && data.note) {
        this.payload.notes.unshift(restoreMetadata(data.note));
        this.payload.media.unshift(...(data.attachments || []));
      } else if (record.entityType === 'otp' && data.otp) this.payload.otp.unshift(restoreMetadata(data.otp));
      else if (['media', 'document'].includes(record.entityType) && data.media) {
        const media = restoreMetadata({ ...data.media });
        if (media.scope === 'note' && !this.payload.notes.some((note) => note.id === media.noteId)) { delete media.scope; delete media.noteId; }
        this.payload.media.unshift(media);
        if (record.entityType === 'document') this.payload.documentVersions.unshift(...(data.versions || []));
      } else throw new Error('TRASH_ITEM_CORRUPTED');
      this.payload.trash = this.payload.trash.filter((candidate) => candidate.id !== id);
      await this.persist();
    } catch (error) {
      this.payload.entries = previous.entries;
      this.payload.notes = previous.notes;
      this.payload.otp = previous.otp;
      this.payload.media = previous.media;
      this.payload.documentVersions = previous.versions;
      this.payload.trash = previous.trash;
      throw error;
    }
    return this.getSnapshot();
  }

  async permanentlyDeleteTrashItem(id) {
    this.assertUnlocked();
    const record = this.payload.trash.find((candidate) => candidate.id === id);
    if (!record) throw new Error('TRASH_ITEM_NOT_FOUND');
    const previousTrash = [...this.payload.trash];
    const previousPending = [...this.payload.pendingFileDeletes];
    try {
      this.purgeTrashRecord(record);
      await this.persist();
    } catch (error) {
      this.payload.trash = previousTrash;
      this.payload.pendingFileDeletes = previousPending;
      throw error;
    }
    await this.flushPendingFileDeletes();
    return this.getSnapshot();
  }

  async emptyTrash() {
    this.assertUnlocked();
    const previousTrash = [...this.payload.trash];
    const previousPending = [...this.payload.pendingFileDeletes];
    try {
      for (const record of [...this.payload.trash]) this.purgeTrashRecord(record);
      await this.persist();
    } catch (error) {
      this.payload.trash = previousTrash;
      this.payload.pendingFileDeletes = previousPending;
      throw error;
    }
    await this.flushPendingFileDeletes();
    return this.getSnapshot();
  }

  async writeEncryptedMediaFromFile(sourcePath, id, maxSize) {
    const source = await fsp.open(sourcePath, 'r');
    const targetPath = path.join(this.mediaDir, `${id}.nvm`);
    const temporary = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let target;
    try {
      const stat = await source.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > maxSize) throw new Error('MEDIA_TOO_LARGE');
      await fsp.mkdir(this.mediaDir, { recursive: true });
      target = await fsp.open(temporary, 'wx', 0o600);
      await writeFully(target, mediaHeader(stat.size), 0);
      let plainOffset = 0;
      let encryptedOffset = MEDIA_HEADER_BYTES;
      let index = 0;
      while (plainOffset < stat.size) {
        const expected = Math.min(MEDIA_CHUNK_SIZE, stat.size - plainOffset);
        const plain = Buffer.allocUnsafe(expected);
        if (await readFully(source, plain, plainOffset) !== expected) { plain.fill(0); throw new Error('MEDIA_CHANGED_DURING_IMPORT'); }
        const encrypted = encryptMediaChunk(this.key, plain, `media:${id}:chunk:${index}:v2`);
        plain.fill(0);
        try { await writeFully(target, encrypted, encryptedOffset); }
        finally { encrypted.fill(0); }
        plainOffset += expected;
        encryptedOffset += MEDIA_RECORD_OVERHEAD + expected;
        index += 1;
      }
      const finalStat = await source.stat();
      if (finalStat.size !== stat.size) throw new Error('MEDIA_CHANGED_DURING_IMPORT');
      await target.sync();
      await target.close();
      target = null;
      await fsp.rename(temporary, targetPath);
      return stat.size;
    } catch (error) {
      await target?.close().catch(() => {});
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw error;
    } finally { await source.close(); }
  }

  async writeEncryptedMediaFromBuffer(value, id) {
    const targetPath = path.join(this.mediaDir, `${id}.nvm`);
    const temporary = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let target;
    try {
      await fsp.mkdir(this.mediaDir, { recursive: true });
      target = await fsp.open(temporary, 'wx', 0o600);
      await writeFully(target, mediaHeader(value.length), 0);
      let plainOffset = 0;
      let encryptedOffset = MEDIA_HEADER_BYTES;
      let index = 0;
      while (plainOffset < value.length) {
        const plain = value.subarray(plainOffset, Math.min(value.length, plainOffset + MEDIA_CHUNK_SIZE));
        const encrypted = encryptMediaChunk(this.key, plain, `media:${id}:chunk:${index}:v2`);
        try { await writeFully(target, encrypted, encryptedOffset); }
        finally { encrypted.fill(0); }
        plainOffset += plain.length;
        encryptedOffset += encrypted.length;
        index += 1;
      }
      await target.sync();
      await target.close();
      target = null;
      await fsp.rename(temporary, targetPath);
    } catch (error) {
      await target?.close().catch(() => {});
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
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

  async destroyVaultAuthenticated(currentPassword) {
    this.assertUnlocked();
    this.verifyMasterPassword(currentPassword);
    return this.destroyVault();
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
        const random = crypto.randomBytes(length);
        try { await writeFully(handle, random, offset); }
        finally { random.fill(0); }
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
