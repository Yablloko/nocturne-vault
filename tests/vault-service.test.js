const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultService } = require('../src/services/vault-service');

function encryptEnvelope(key, value, aad) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return { nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-vault-test-'));
  const vault = new VaultService(path.join(root, 'data'));
  const password = 'очень длинная тестовая фраза 2026';
  const created = await vault.create(password);
  return { root, vault, password, recoveryKey: created.recoveryKey };
}

test('создаёт контейнер без открытых секретов и открывает его мастер-паролем', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  await fixture.vault.saveEntry({
    title: 'Личная почта',
    username: 'owner@example.com',
    password: 'secret-value-123',
    folderId: 'personal',
  });
  const raw = await fs.readFile(fixture.vault.containerPath, 'utf8');
  assert.equal(raw.includes('Личная почта'), false);
  assert.equal(raw.includes('secret-value-123'), false);
  assert.equal(raw.includes(fixture.password), false);
  assert.equal(raw.includes(fixture.recoveryKey), false);

  fixture.vault.lock();
  const failed = await fixture.vault.unlockWithPassword('совершенно неверный пароль');
  assert.equal(failed.unlocked, false);
  const unlocked = await fixture.vault.unlockWithPassword(fixture.password);
  assert.equal(unlocked.unlocked, true);
  assert.equal(unlocked.entries[0].title, 'Личная почта');
});

test('восстанавливает доступ независимым recovery-ключом', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  fixture.vault.lock({ preserveQuickUnlock: false });
  const snapshot = await fixture.vault.unlockWithRecovery(fixture.recoveryKey);
  assert.equal(snapshot.unlocked, true);
});

test('быстрая разблокировка существует только в текущем объекте-сеансе', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  await fixture.vault.configureQuickUnlock('pin', '629104', fixture.password);
  fixture.vault.lock();
  const snapshot = await fixture.vault.quickUnlock('pin', '629104');
  assert.equal(snapshot.unlocked, true);

  const restarted = new VaultService(fixture.vault.rootDir);
  await assert.rejects(() => restarted.quickUnlock('pin', '629104'), /QUICK_UNLOCK_UNAVAILABLE/);
});

test('защищённый профиль активирует рисунок после первого мастер-входа нового процесса', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  await fixture.vault.configureQuickUnlock('pattern', '0-1-4-7-8', fixture.password);
  const container = await fs.readFile(fixture.vault.containerPath);
  assert.equal(container.includes(Buffer.from('0-1-4-7-8')), false);
  fixture.vault.lock({ preserveQuickUnlock: false });

  const restarted = new VaultService(fixture.vault.rootDir);
  await assert.rejects(() => restarted.quickUnlock('pattern', '0-1-4-7-8'), /QUICK_UNLOCK_UNAVAILABLE/);
  const master = await restarted.unlockWithPassword(fixture.password);
  assert.equal(master.unlocked, true);
  assert.equal(master.settings.quickUnlockAvailable, true);
  assert.equal(master.settings.quickUnlockMode, 'pattern');
  restarted.lock();
  const quick = await restarted.quickUnlock('pattern', '0-1-4-7-8');
  assert.equal(quick.unlocked, true);
});

test('медиафайл сохраняется только в зашифрованном виде', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const marker = Buffer.from('not-a-real-image::plain-secret-marker');
  const source = path.join(fixture.root, 'sample.png');
  await fs.writeFile(source, marker);
  const result = await fixture.vault.importMedia([source]);
  assert.equal(result.added, 1);
  const item = result.snapshot.media[0];
  const encrypted = await fs.readFile(path.join(fixture.vault.mediaDir, `${item.id}.nvm`));
  assert.equal(encrypted.includes(marker), false);
  await fs.rm(source);
  const decrypted = await fixture.vault.getMedia(item.id);
  assert.deepEqual(decrypted.buffer, marker);
});

test('требует текущий мастер-пароль перед сменой мастер-пароля и быстрого входа', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    () => fixture.vault.configureQuickUnlock('pin', '629104', 'неверный текущий пароль'),
    /INVALID_CURRENT_PASSWORD/,
  );
  await assert.rejects(
    () => fixture.vault.changeMasterPassword('неверный текущий пароль', 'другая длинная тестовая фраза 2026'),
    /INVALID_CURRENT_PASSWORD/,
  );

  const nextPassword = 'другая длинная тестовая фраза 2026';
  await fixture.vault.changeMasterPassword(fixture.password, nextPassword);
  fixture.vault.lock({ preserveQuickUnlock: false });
  const oldResult = await fixture.vault.unlockWithPassword(fixture.password);
  assert.equal(oldResult.unlocked, false);
  const newResult = await fixture.vault.unlockWithPassword(nextPassword);
  assert.equal(newResult.unlocked, true);
});

test('требует старый пароль записи только при изменении самого пароля', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  let snapshot = await fixture.vault.saveEntry({ title: 'Сервис', password: 'old-secret', folderId: 'personal' });
  const entry = snapshot.entries[0];
  snapshot = await fixture.vault.saveEntry({ ...entry, title: 'Новое название' });
  assert.equal(snapshot.entries[0].title, 'Новое название');
  await assert.rejects(
    () => fixture.vault.saveEntry({ ...snapshot.entries[0], password: 'new-secret', currentPassword: 'wrong-secret' }),
    /INVALID_CURRENT_ENTRY_PASSWORD/,
  );
  snapshot = await fixture.vault.saveEntry({ ...snapshot.entries[0], password: 'new-secret', currentPassword: 'old-secret' });
  assert.equal(snapshot.entries[0].password, 'new-secret');
});

test('при достижении лимита уничтожает ключ и все локальные файлы хранилища', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  await fixture.vault.saveSettings({ wipeEnabled: true, wipeThreshold: 10 });
  await fixture.vault.writeSecurityState({ failedAttempts: 9, lockedUntil: 0 });
  fixture.vault.lock();
  const result = await fixture.vault.unlockWithPassword('неверный пароль для уничтожения');
  assert.equal(result.wiped, true);
  await assert.rejects(() => fs.access(fixture.vault.rootDir));
});

test('не считает повреждение контейнера неверным паролем и не запускает уничтожение', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  await fixture.vault.saveSettings({ wipeEnabled: true, wipeThreshold: 10 });
  fixture.vault.lock();
  const container = JSON.parse(await fs.readFile(fixture.vault.containerPath, 'utf8'));
  const first = container.payload.ciphertext[0];
  container.payload.ciphertext = `${first === 'A' ? 'B' : 'A'}${container.payload.ciphertext.slice(1)}`;
  await fs.writeFile(fixture.vault.containerPath, JSON.stringify(container));

  await assert.rejects(() => fixture.vault.unlockWithPassword(fixture.password), /VAULT_CORRUPTED/);
  const security = await fixture.vault.readSecurityState();
  assert.equal(security.failedAttempts, 0);
  await fs.access(fixture.vault.containerPath);
});

test('заметки и их фотографии перемещаются и восстанавливаются из зашифрованной корзины вместе', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  let snapshot = await fixture.vault.saveNote({ title: 'План поездки', body: 'секретный маршрут через озеро' });
  const note = snapshot.notes[0];
  const source = path.join(fixture.root, 'attached.png');
  const marker = Buffer.from('private-note-photo-marker');
  await fs.writeFile(source, marker);
  const result = await fixture.vault.importNoteAttachments(note.id, [source]);
  assert.equal(result.snapshot.notes[0].attachments.length, 1);
  assert.equal(result.snapshot.media.length, 0);

  const raw = await fs.readFile(fixture.vault.containerPath, 'utf8');
  assert.equal(raw.includes('План поездки'), false);
  assert.equal(raw.includes('секретный маршрут'), false);
  const attachment = result.snapshot.notes[0].attachments[0];
  const encrypted = await fs.readFile(path.join(fixture.vault.mediaDir, `${attachment.id}.nvm`));
  assert.equal(encrypted.includes(marker), false);

  snapshot = await fixture.vault.deleteNote(note.id);
  assert.equal(snapshot.notes.length, 0);
  assert.equal(snapshot.trash.length, 1);
  await fs.access(path.join(fixture.vault.mediaDir, `${attachment.id}.nvm`));
  snapshot = await fixture.vault.restoreTrashItem(snapshot.trash[0].id);
  assert.equal(snapshot.notes[0].title, 'План поездки');
  assert.equal(snapshot.notes[0].attachments.length, 1);
  snapshot = await fixture.vault.deleteNote(note.id);
  await fixture.vault.permanentlyDeleteTrashItem(snapshot.trash[0].id);
  await assert.rejects(() => fs.access(path.join(fixture.vault.mediaDir, `${attachment.id}.nvm`)));
});

test('добавляет фото заметки из буфера и переименовывает его без смены расширения', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const snapshot = await fixture.vault.saveNote({ title: 'Фото', body: 'вложение из буфера' });
  const note = snapshot.notes[0];
  const marker = Buffer.from('clipboard-image-marker');
  const withImage = await fixture.vault.importNoteImageBuffer(note.id, marker);
  const attachment = withImage.notes[0].attachments[0];
  assert.equal(attachment.name, 'Изображение из буфера.png');

  const renamed = await fixture.vault.renameMedia(attachment.id, 'Чек за август');
  assert.equal(renamed.notes[0].attachments[0].name, 'Чек за август.png');
  const decrypted = await fixture.vault.getMedia(attachment.id);
  assert.deepEqual(decrypted.buffer, marker);
});

test('документы хранятся зашифрованно и отделены от медиатеки', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const marker = Buffer.from('%PDF-1.7\nprivate-document-marker');
  const source = path.join(fixture.root, 'Договор.pdf');
  await fs.writeFile(source, marker);
  const result = await fixture.vault.importDocuments([source]);
  assert.equal(result.added, 1);
  assert.equal(result.snapshot.documents.length, 1);
  assert.equal(result.snapshot.media.length, 0);
  const document = result.snapshot.documents[0];
  const encrypted = await fs.readFile(path.join(fixture.vault.mediaDir, `${document.id}.nvm`));
  assert.equal(encrypted.includes(marker), false);
  await fs.rm(source);
  const decrypted = await fixture.vault.getMedia(document.id);
  assert.deepEqual(decrypted.buffer, marker);
});

test('текстовый редактор хранит историю как отдельные зашифрованные версии и восстанавливает её', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  let snapshot = await fixture.vault.createTextDocument('Дневник', 'text/markdown', 'первая секретная версия');
  const document = snapshot.documents[0];
  snapshot = await fixture.vault.saveTextDocument(document.id, 'вторая секретная версия');
  assert.equal(snapshot.documents[0].versionCount, 1);
  const versions = fixture.vault.getDocumentVersions(document.id);
  const storedVersion = fixture.vault.payload.documentVersions.find((version) => version.id === versions[0].id);
  const encryptedVersion = await fs.readFile(path.join(fixture.vault.mediaDir, `${storedVersion.storageId}.nvm`));
  assert.equal(encryptedVersion.includes(Buffer.from('первая секретная версия')), false);
  let active = await fixture.vault.getMedia(document.id);
  assert.equal(active.buffer.toString(), 'вторая секретная версия');
  active.buffer.fill(0);

  snapshot = await fixture.vault.restoreDocumentVersion(document.id, versions[0].id);
  assert.equal(snapshot.documents[0].versionCount, 1);
  active = await fixture.vault.getMedia(document.id);
  assert.equal(active.buffer.toString(), 'первая секретная версия');
  active.buffer.fill(0);
});

test('ошибка фиксации новой версии не меняет активный документ и не оставляет файл-сироту', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const snapshot = await fixture.vault.createTextDocument('Транзакция', 'text/plain', 'исходный текст');
  const documentId = snapshot.documents[0].id;
  const filesBefore = (await fs.readdir(fixture.vault.mediaDir)).sort();
  const realPersist = fixture.vault.persist.bind(fixture.vault);
  fixture.vault.persist = async () => { throw new Error('SIMULATED_WRITE_FAILURE'); };

  await assert.rejects(() => fixture.vault.saveTextDocument(documentId, 'несохранённый текст'), /SIMULATED_WRITE_FAILURE/);
  fixture.vault.persist = realPersist;
  const active = await fixture.vault.getMedia(documentId);
  assert.equal(active.buffer.toString(), 'исходный текст');
  active.buffer.fill(0);
  assert.deepEqual((await fs.readdir(fixture.vault.mediaDir)).sort(), filesBefore);
  assert.equal(fixture.vault.getDocumentVersions(documentId).length, 0);
});

test('корзина восстанавливает записи, а окончательная очистка уничтожает связанные файлы и версии', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  let snapshot = await fixture.vault.saveEntry({ title: 'Почта', password: 'private', folderId: 'personal' });
  const entryId = snapshot.entries[0].id;
  snapshot = await fixture.vault.createTextDocument('Черновик', 'text/plain', 'текст документа');
  const documentId = snapshot.documents[0].id;
  await fixture.vault.saveTextDocument(documentId, 'новый текст');
  snapshot = await fixture.vault.deleteEntry(entryId);
  const entryTrash = snapshot.trash.find((item) => item.entityType === 'entry');
  snapshot = await fixture.vault.deleteMedia(documentId);
  const documentTrash = snapshot.trash.find((item) => item.entityType === 'document');
  assert.equal(snapshot.documents.length, 0);
  assert.equal(snapshot.trash.length, 2);

  snapshot = await fixture.vault.restoreTrashItem(entryTrash.id);
  assert.equal(snapshot.entries[0].title, 'Почта');
  snapshot = await fixture.vault.permanentlyDeleteTrashItem(documentTrash.id);
  await assert.rejects(() => fs.access(path.join(fixture.vault.mediaDir, `${documentId}.nvm`)));
  assert.equal(snapshot.trash.length, 0);
});

test('окончательная очистка сначала фиксирует tombstone и не теряет файл при ошибке контейнера', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const source = path.join(fixture.root, 'transactional.png');
  await fs.writeFile(source, 'encrypted-trash-payload');
  let result = await fixture.vault.importMedia([source]);
  const mediaId = result.snapshot.media[0].id;
  result = { snapshot: await fixture.vault.deleteMedia(mediaId) };
  const trashId = result.snapshot.trash[0].id;
  const encryptedPath = path.join(fixture.vault.mediaDir, `${mediaId}.nvm`);
  const realPersist = fixture.vault.persist.bind(fixture.vault);
  fixture.vault.persist = async () => { throw new Error('SIMULATED_WRITE_FAILURE'); };

  await assert.rejects(() => fixture.vault.permanentlyDeleteTrashItem(trashId), /SIMULATED_WRITE_FAILURE/);
  fixture.vault.persist = realPersist;
  assert.equal(fixture.vault.getSnapshot().trash.some((item) => item.id === trashId), true);
  await fs.access(encryptedPath);
  await fixture.vault.permanentlyDeleteTrashItem(trashId);
  await assert.rejects(() => fs.access(encryptedPath));
});

test('очередь физического удаления принимает только внутренние UUID хранилища', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const safeId = crypto.randomUUID();
  fixture.vault.queueFileDeletes(['..\\outside', '../../outside', '------------------------------------', safeId]);
  assert.deepEqual(fixture.vault.payload.pendingFileDeletes, [safeId]);
});

test('истёкшие элементы корзины очищаются вместе с зашифрованными файлами', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const source = path.join(fixture.root, 'old.png');
  await fs.writeFile(source, 'old-media');
  let result = await fixture.vault.importMedia([source]);
  const id = result.snapshot.media[0].id;
  let snapshot = await fixture.vault.deleteMedia(id);
  fixture.vault.payload.trash[0].deletedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  await fixture.vault.persist();
  snapshot = await fixture.vault.saveSettings({ trashRetentionDays: 7 });
  assert.equal(snapshot.trash.length, 0);
  await assert.rejects(() => fs.access(path.join(fixture.vault.mediaDir, `${id}.nvm`)));
});

test('аудиофайлы принимаются медиатекой и остаются зашифрованными', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const marker = Buffer.from('ID3-private-audio-marker');
  const source = path.join(fixture.root, 'Запись.mp3');
  await fs.writeFile(source, marker);
  const result = await fixture.vault.importMedia([source]);
  assert.equal(result.added, 1);
  assert.equal(result.snapshot.media[0].type, 'audio/mpeg');
  const encrypted = await fs.readFile(path.join(fixture.vault.mediaDir, `${result.snapshot.media[0].id}.nvm`));
  assert.equal(encrypted.includes(marker), false);
});

test('запись с микрофона импортируется из памяти без открытого временного файла', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const marker = Buffer.from('webm-audio-secret-marker');
  const snapshot = await fixture.vault.importRecordedAudio(marker, 'Диктофон', 'audio/webm;codecs=opus');
  const item = snapshot.media[0];
  assert.equal(item.name, 'Диктофон.webm');
  assert.equal(item.type, 'audio/webm');
  const encrypted = await fs.readFile(path.join(fixture.vault.mediaDir, `${item.id}.nvm`));
  assert.equal(encrypted.includes(marker), false);
  assert.equal((await fs.readdir(fixture.root)).some((name) => name.includes('Диктофон')), false);
});

test('TOTP-секрет хранится только внутри зашифрованного payload и не попадает в snapshot', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const secret = 'JBSWY3DPEHPK3PXP';

  const snapshot = await fixture.vault.saveOtpAccount({ issuer: 'Example', account: 'alice@example.com', secret, algorithm: 'SHA1', digits: 6, period: 30 });
  assert.equal(snapshot.otp.length, 1);
  assert.equal(Object.hasOwn(snapshot.otp[0], 'secret'), false);
  const raw = await fs.readFile(fixture.vault.containerPath, 'utf8');
  assert.equal(raw.includes(secret), false);

  const codes = fixture.vault.getOtpCodes(59_000);
  assert.equal(codes[0].code, '996554');
  assert.equal(codes[0].remaining, 1);
  fixture.vault.lock();
  assert.throws(() => fixture.vault.getOtpCodes(), /VAULT_LOCKED/);
});

test('импортирует стандартный otpauth URI и удаляет OTP-запись', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  let snapshot = await fixture.vault.importOtpUri('otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP&issuer=GitHub');
  assert.equal(snapshot.otp[0].issuer, 'GitHub');
  assert.equal(snapshot.otp[0].account, 'octocat');
  snapshot = await fixture.vault.deleteOtpAccount(snapshot.otp[0].id);
  assert.equal(snapshot.otp.length, 0);
});

test('папки, теги и избранное работают во всех разделах', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  let snapshot = await fixture.vault.addFolder({ name: 'Проекты', section: 'notes' });
  const parent = snapshot.folders.find((folder) => folder.name === 'Проекты');
  snapshot = await fixture.vault.addFolder({ name: 'Архив', section: 'notes', parentId: parent.id });
  const child = snapshot.folders.find((folder) => folder.name === 'Архив');
  snapshot = await fixture.vault.updateFolderMetadata({ ids: [parent.id, child.id], favorite: true });
  assert.equal(snapshot.folders.find((folder) => folder.id === parent.id).favorite, true);
  assert.equal(snapshot.folders.find((folder) => folder.id === child.id).favorite, true);
  snapshot = await fixture.vault.saveNote({ title: 'План', body: 'текст', folderId: child.id, tags: 'Работа, важно, работа', favorite: true });
  assert.equal(snapshot.notes[0].folderId, child.id);
  assert.deepEqual(snapshot.notes[0].tags, ['Работа', 'важно']);
  assert.equal(snapshot.notes[0].favorite, true);

  snapshot = await fixture.vault.updateItemMetadata({ section: 'notes', ids: [snapshot.notes[0].id], folderId: parent.id, tags: ['новое'], favorite: false });
  assert.equal(snapshot.notes[0].folderId, parent.id);
  assert.deepEqual(snapshot.notes[0].tags, ['новое']);
  assert.equal(snapshot.notes[0].favorite, false);
});

test('удаление родительской папки перемещает вложенные папки и содержимое в корзину', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  let snapshot = await fixture.vault.addFolder({ name: 'Клиенты', section: 'passwords' });
  const parent = snapshot.folders.find((folder) => folder.name === 'Клиенты');
  snapshot = await fixture.vault.addFolder({ name: 'Старые', section: 'passwords', parentId: parent.id });
  const child = snapshot.folders.find((folder) => folder.name === 'Старые');
  snapshot = await fixture.vault.saveEntry({ title: 'Портал', password: 'secret', folderId: child.id });
  snapshot = await fixture.vault.deleteFolders([parent.id]);
  assert.equal(snapshot.folders.some((folder) => folder.id === parent.id || folder.id === child.id), false);
  assert.equal(snapshot.entries.some((entry) => entry.title === 'Портал'), false);
  assert.equal(snapshot.trash.some((item) => item.name === 'Портал'), true);
});

test('импорт по отображаемому имени сохраняет файл в открытую папку', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const backingPath = path.join(fixture.root, 'dragged-file-without-extension');
  await fs.writeFile(backingPath, Buffer.from('dragged-image'));
  let snapshot = await fixture.vault.addFolder({ name: 'Входящие', section: 'media' });
  const folder = snapshot.folders.find((item) => item.name === 'Входящие');
  const result = await fixture.vault.importMedia([{ path: backingPath, name: 'Скриншот.png' }], folder.id);
  assert.equal(result.added, 1);
  assert.equal(result.snapshot.media[0].name, 'Скриншот.png');
  assert.equal(result.snapshot.media[0].folderId, folder.id);
});

test('перемещает выбранные папки и запрещает циклическую вложенность', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  let snapshot = await fixture.vault.addFolder({ name: 'Источник', section: 'documents' });
  const source = snapshot.folders.find((item) => item.name === 'Источник');
  snapshot = await fixture.vault.addFolder({ name: 'Вложенная', section: 'documents', parentId: source.id });
  const child = snapshot.folders.find((item) => item.name === 'Вложенная');
  snapshot = await fixture.vault.addFolder({ name: 'Назначение', section: 'documents' });
  const destination = snapshot.folders.find((item) => item.name === 'Назначение');
  snapshot = await fixture.vault.moveFolders({ ids: [source.id], parentId: destination.id });
  assert.equal(snapshot.folders.find((item) => item.id === source.id).parentId, destination.id);
  await assert.rejects(() => fixture.vault.moveFolders({ ids: [source.id], parentId: child.id }), /FOLDER_CYCLE/);
});

test('удалённые документы доступны только для просмотра до очистки корзины', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  let snapshot = await fixture.vault.createTextDocument('Удалённый текст', 'text/plain', 'содержимое');
  const document = snapshot.documents[0];
  snapshot = await fixture.vault.deleteMedia(document.id);
  const record = snapshot.trash.find((item) => item.entityType === 'document');
  const preview = fixture.vault.getTrashPreview(record.id);
  assert.equal(preview.item.id, document.id);
  const media = await fixture.vault.getMedia(document.id);
  assert.equal(media.buffer.toString('utf8'), 'содержимое');
  media.buffer.fill(0);
});

test('снимок области импортируется напрямую из памяти', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const marker = Buffer.from('screen-capture-secret');
  const snapshot = await fixture.vault.importMediaBuffer(marker, 'Область.png');
  const item = snapshot.media[0];
  assert.equal(item.name, 'Область.png');
  const encrypted = await fs.readFile(path.join(fixture.vault.mediaDir, `${item.id}.nvm`));
  assert.equal(encrypted.includes(marker), false);
});

test('экспортирует и импортирует полную зашифрованную резервную копию', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await fixture.vault.saveEntry({ title: 'Почта из копии', username: 'backup@example.test', password: 'backup-secret' });
  await fixture.vault.importMediaBuffer(Buffer.from('private-image-bytes'), 'backup.png');
  const backupPath = path.join(fixture.root, 'vault.nocturne');
  await fixture.vault.exportVaultBackup(backupPath, fixture.password);
  const raw = await fs.readFile(backupPath);
  assert.equal(raw.includes(Buffer.from('backup-secret')), false);
  assert.equal(raw.includes(Buffer.from('private-image-bytes')), false);

  const restored = new VaultService(path.join(fixture.root, 'restored'));
  await assert.rejects(() => restored.importVaultBackup(backupPath, 'неверный мастер пароль 2026'), /WRONG_BACKUP_PASSWORD/);
  const snapshot = await restored.importVaultBackup(backupPath, fixture.password);
  assert.equal(snapshot.entries[0].title, 'Почта из копии');
  assert.equal(snapshot.media[0].name, 'backup.png');
  const media = await restored.getMedia(snapshot.media[0].id);
  assert.equal(media.buffer.toString(), 'private-image-bytes');
  media.buffer.fill(0);
});

test('не принимает короткие, распространённые и повторяющиеся новые мастер-пароли', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-password-policy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const password of ['1234567890', '12345678901234', 'aaaaaaaaaaaaaa', 'abcabcabcabcabc', 'abcdefghijklmn', 'qwertyuiopasdf', '23456789012345']) {
    const vault = new VaultService(path.join(root, crypto.randomUUID()));
    await assert.rejects(() => vault.create(password), /WEAK_MASTER_PASSWORD/);
  }
});

test('сериализует параллельные неверные попытки без потери счётчика', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  fixture.vault.lock();
  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => fixture.vault.unlockWithPassword(`неверная фраза номер ${index}`)));
  assert.deepEqual(results.map((result) => result.failedAttempts), [1, 2, 3, 4]);
  assert.equal((await fixture.vault.readSecurityState()).failedAttempts, 4);
});

test('активная блокировка запрещает проверку даже правильного PIN', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await fixture.vault.configureQuickUnlock('pin', '629104', fixture.password);
  fixture.vault.lock();
  await fixture.vault.writeSecurityState({ failedAttempts: 5, lockedUntil: Date.now() + 60_000 });
  const result = await fixture.vault.quickUnlock('pin', '629104');
  assert.equal(result.unlocked, false);
  assert.equal(result.failedAttempts, 5);
  assert.equal(fixture.vault.isUnlocked(), false);
});

test('потоковый формат расшифровывает только запрошенный диапазон между блоками', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const marker = Buffer.alloc(1024 * 1024 + 4096);
  for (let index = 0; index < marker.length; index += 1) marker[index] = index % 251;
  const source = path.join(fixture.root, 'large.mp4');
  await fs.writeFile(source, marker);
  const result = await fixture.vault.importMedia([source]);
  const item = result.snapshot.media[0];
  assert.equal(item.format, 2);
  const encrypted = await fs.readFile(path.join(fixture.vault.mediaDir, `${item.id}.nvm`));
  assert.equal(encrypted.subarray(0, 4).toString(), 'NVM2');
  assert.equal(encrypted.includes(marker.subarray(0, 1024)), false);
  const start = 1024 * 1024 - 37;
  const end = 1024 * 1024 + 91;
  const chunks = [];
  for await (const chunk of fixture.vault.createMediaStream(item.id, start, end)) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), marker.subarray(start, end + 1));
});

test('потоково мигрирует legacy-видео больше 64 МБ без потери доступа', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const id = crypto.randomUUID();
  const size = 65 * 1024 * 1024;
  const plain = Buffer.alloc(size, 0x5a);
  const envelope = encryptEnvelope(fixture.vault.key, plain, `media:${id}`);
  plain.fill(0);
  await fs.writeFile(path.join(fixture.vault.mediaDir, `${id}.nvm`), JSON.stringify(envelope));
  fixture.vault.payload.media.unshift({ id, name: 'legacy.mp4', type: 'video/mp4', size, createdAt: new Date().toISOString() });
  await fixture.vault.persist();
  const legacyPath = path.join(fixture.vault.mediaDir, `${id}.nvm`);
  await fs.rename(legacyPath, `${legacyPath}.legacy-backup`);
  const chunks = [];
  for await (const chunk of fixture.vault.createMediaStream(id, size - 128, size - 1)) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), Buffer.alloc(128, 0x5a));
  assert.equal((await fs.readFile(legacyPath)).subarray(0, 4).toString(), 'NVM2');
  await assert.rejects(() => fs.access(`${legacyPath}.legacy-backup`));
  assert.equal(fixture.vault.getMediaInfo(id).format, 2);
});

test('не оставляет частично расшифрованный экспорт при повреждении позднего блока', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const source = path.join(fixture.root, 'corrupt.mp4');
  await fs.writeFile(source, Buffer.alloc(2 * 1024 * 1024, 0x41));
  const imported = await fixture.vault.importMedia([source]);
  const id = imported.snapshot.media[0].id;
  const encryptedPath = path.join(fixture.vault.mediaDir, `${id}.nvm`);
  const handle = await fs.open(encryptedPath, 'r+');
  const position = 20 + (28 + 1024 * 1024) + 28 + 10;
  const byte = Buffer.alloc(1);
  await handle.read(byte, 0, 1, position);
  byte[0] ^= 0xff;
  await handle.write(byte, 0, 1, position);
  await handle.close();
  const exportPath = path.join(fixture.root, 'existing-export.mp4');
  await fs.writeFile(exportPath, 'keep-existing');
  await assert.rejects(() => fixture.vault.exportMedia(id, exportPath));
  assert.equal(await fs.readFile(exportPath, 'utf8'), 'keep-existing');
  assert.equal((await fs.readdir(fixture.root)).some((name) => name.includes('.nocturne-export')), false);
});

test('повреждённый payload при recovery не оставляет ключ в памяти', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const container = JSON.parse(await fs.readFile(fixture.vault.containerPath, 'utf8'));
  container.payload = encryptEnvelope(fixture.vault.key, Buffer.from('{invalid json'), 'vault-payload-v1');
  await fs.writeFile(fixture.vault.containerPath, JSON.stringify(container));
  fixture.vault.lock({ preserveQuickUnlock: false });
  await assert.rejects(() => fixture.vault.unlockWithRecovery(fixture.recoveryKey), /VAULT_CORRUPTED/);
  assert.equal(fixture.vault.key, null);
  assert.equal(fixture.vault.payload, null);
  assert.equal(fixture.vault.container, null);
});

test('ошибка сохранения security state после recovery закрывает уже развёрнутый ключ', async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  fixture.vault.lock({ preserveQuickUnlock: false });
  await fs.rm(fixture.vault.securityPath, { force: true });
  await fs.mkdir(fixture.vault.securityPath);
  await assert.rejects(() => fixture.vault.unlockWithRecovery(fixture.recoveryKey), /VAULT_CORRUPTED/);
  assert.equal(fixture.vault.key, null);
  assert.equal(fixture.vault.payload, null);
  assert.equal(fixture.vault.container, null);
});
