const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultService } = require('../src/services/vault-service');

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

test('заметки и их фотографии зашифрованы и удаляются вместе', async (t) => {
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
