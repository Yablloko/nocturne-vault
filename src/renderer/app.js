const appRoot = document.querySelector('#app');
const entryDialog = document.querySelector('#entry-dialog');
const entryForm = document.querySelector('#entry-form');
const simpleDialog = document.querySelector('#simple-dialog');
const simpleContent = document.querySelector('#simple-dialog-content');
const mediaDialog = document.querySelector('#media-dialog');
const mediaContent = document.querySelector('#media-dialog-content');
const noteDialog = document.querySelector('#note-dialog');
const noteForm = document.querySelector('#note-form');

const state = {
  version: '0.3.1',
  exists: false,
  unlocked: false,
  snapshot: null,
  lastSettings: null,
  quickUnlockAvailable: false,
  page: 'passwords',
  query: '',
  folderFilter: null,
  selectedEntryId: null,
  selectedNoteId: null,
  selectedDocumentId: null,
  mediaFilter: 'all',
  settingsSection: 'lock',
  pattern: [],
  patternDrawing: false,
  patternPointerId: null,
  patternEnrollmentFirst: null,
  patternMasterPassword: '',
  patternContext: null,
  viewerMediaId: null,
  otpCodes: {},
  recoveryKey: null,
  recoverySaved: false,
  lastActivity: Date.now(),
  busy: false,
};

const iconPaths = {
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8"/><path d="m16 7 2 2"/><path d="m14 9 2 2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 15-4-4L5 20"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.4.34.75.6 1 .3.28.7.42 1.1.4h.09v4h-.09a1.7 1.7 0 0 0-1.7.6Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  shield: '<path d="M12 3 5 6v5c0 4.8 2.9 8.2 7 10 4.1-1.8 7-5.2 7-10V6Z"/><path d="m9 12 2 2 4-4"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
  warning: '<path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  sparkle: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2ZM18 14l.7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7Z"/>',
  note: '<path d="M5 3h11l3 3v15H5Z"/><path d="M15 3v4h4M8 11h8M8 15h6"/>',
  document: '<path d="M6 3h9l4 4v14H6Z"/><path d="M15 3v5h5M9 12h7M9 16h7"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"/>',
  audio: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  otp: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M12 3V1M21 12h2M12 21v2M3 12H1"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.lock}</svg>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(new Date(value));
}

function allMedia() {
  return [...(state.snapshot?.media || []), ...(state.snapshot?.documents || []), ...(state.snapshot?.notes || []).flatMap((note) => note.attachments || [])];
}

function findMedia(id) {
  return allMedia().find((item) => item.id === id);
}

async function apiCall(promise) {
  const response = await promise;
  if (!response?.ok) throw new Error(response?.error || 'UNKNOWN_ERROR');
  return response.data;
}

function friendlyError(code) {
  return ({
    WEAK_MASTER_PASSWORD: 'Мастер-пароль должен содержать не менее 10 символов.',
    MASTER_PASSWORD_TOO_LONG: 'Мастер-пароль слишком длинный.',
    INVALID_RECOVERY_KEY: 'Неверный формат ключа восстановления.',
    QUICK_UNLOCK_UNAVAILABLE: 'Быстрая разблокировка доступна только до полного закрытия приложения.',
    INVALID_PIN: 'PIN должен содержать от 6 до 12 цифр.',
    INVALID_PATTERN: 'Выберите не менее 5 разных точек.',
    INVALID_CURRENT_PASSWORD: 'Текущий мастер-пароль неверен.',
    INVALID_CURRENT_ENTRY_PASSWORD: 'Чтобы изменить пароль записи, введите её текущий пароль.',
    ENTRY_TITLE_REQUIRED: 'Укажите название записи.',
    NOTE_TITLE_REQUIRED: 'Укажите название заметки.',
    INVALID_FOLDER_NAME: 'Введите название папки.',
    INVALID_MEDIA_NAME: 'Введите допустимое название файла.',
    MEDIA_COPY_UNSUPPORTED: 'В буфер можно скопировать только изображение.',
    DOCUMENT_PREVIEW_UNSUPPORTED: 'Этот формат нельзя безопасно показать внутри Nocturne. Его можно только явно сохранить на компьютер.',
    DOCUMENT_PREVIEW_TOO_LARGE: 'Документ слишком большой для внутреннего просмотра.',
    DOCUMENT_NOT_FOUND: 'Документ не найден в хранилище.',
    INVALID_OTP_SECRET: 'Секрет TOTP должен быть корректной строкой Base32.',
    INVALID_OTP_URI: 'Не удалось прочитать ссылку otpauth://.',
    UNSUPPORTED_OTP_URI: 'Поддерживаются только стандартные TOTP-коды.',
    INVALID_OTP_ALGORITHM: 'Поддерживаются SHA1, SHA256 и SHA512.',
    INVALID_OTP_DIGITS: 'Код должен содержать 6 или 8 цифр.',
    INVALID_OTP_PERIOD: 'Период обновления должен быть от 15 до 120 секунд.',
    OTP_NAME_REQUIRED: 'Укажите сервис или имя аккаунта.',
    OTP_ALREADY_EXISTS: 'Этот TOTP-аккаунт уже добавлен.',
    OTP_QR_EMPTY: 'В буфере обмена нет изображения или ссылки otpauth://.',
    OTP_QR_NOT_FOUND: 'На изображении не найден QR-код TOTP.',
    OTP_CODE_UNAVAILABLE: 'Код временно недоступен. Проверьте системное время.',
    VAULT_CORRUPTED: 'Контейнер повреждён или изменён. Автоматическое удаление не запущено.',
  })[code] || 'Операция не выполнена. Проверьте данные и повторите попытку.';
}

function toast(message, type = 'normal') {
  const element = document.createElement('div');
  element.className = `toast${type === 'danger' ? ' toast--danger' : ''}`;
  element.innerHTML = `<span>${escapeHtml(message)}</span>`;
  document.querySelector('#toast-region').append(element);
  setTimeout(() => element.classList.add('is-leaving'), 2600);
  setTimeout(() => element.remove(), 2850);
}

function setBusy(value) {
  state.busy = value;
  document.querySelectorAll('[data-busy-button]').forEach((button) => { button.disabled = value; });
}

function renderAuthShell(content, _footer = '', step = 'locked') {
  const steps = [
    { id: 'create', number: '01', label: 'Мастер-пароль' },
    { id: 'recovery', number: '02', label: 'Ключ восстановления' },
    { id: 'ready', number: '03', label: 'Готово' },
  ];
  const stepIndex = steps.findIndex((item) => item.id === step);
  const progress = stepIndex >= 0
    ? `<ol class="auth-steps">${steps.map((item, index) => `<li class="${index === stepIndex ? 'is-active' : ''} ${index < stepIndex ? 'is-complete' : ''}"><span>${item.number}</span><em>${item.label}</em></li>`).join('')}</ol>`
    : `<div class="auth-spine-state"><span>${step === 'recover' ? 'RECOVERY' : 'LOCKED'}</span><small>LOCAL VAULT</small></div>`;
  const showProgress = stepIndex >= 0;
  return `<div class="auth-shell auth-shell--${step} ${showProgress ? '' : 'auth-shell--solo'}">
    <header class="auth-header"><div class="auth-brand"><b>N</b><span>Nocturne Vault</span></div></header>
    <main class="auth-main"><section class="auth-panel">${content}</section>${showProgress ? `<aside class="auth-progress">${progress}</aside>` : ''}</main>
    <footer class="auth-footer"><span>v${escapeHtml(state.version)}</span></footer>
  </div>`;
}

function renderOnboarding() {
  appRoot.innerHTML = renderAuthShell(`
      <div class="auth-panel__code">VAULT / CREATE</div>
      <h1>Создание хранилища</h1>
      <p class="muted auth-description">Задайте мастер-пароль. После создания приложение один раз покажет ключ восстановления.</p>
      <form class="auth-form" id="create-form">
        <label class="field"><span>Мастер-пароль</span><div class="password-reveal"><input name="password" type="password" minlength="10" maxlength="256" autocomplete="new-password" required placeholder="Не менее 10 символов"><button type="button" data-toggle-password="password" aria-label="Показать пароль">${icon('eye')}</button></div><div class="password-meter"><span></span></div></label>
        <label class="field"><span>Повторите пароль</span><div class="password-reveal"><input name="confirm" type="password" minlength="10" maxlength="256" autocomplete="new-password" required><button type="button" data-toggle-password="confirm" aria-label="Показать пароль">${icon('eye')}</button></div></label>
        <p class="field-hint">Лучше использовать длинную фразу, которой нет в других сервисах.</p>
        <button class="button button--primary" type="submit" data-busy-button>Продолжить</button>
      </form>
      <div class="auth-security-note">${icon('shield')}<span>Пароль и содержимое не покидают компьютер.</span></div>
  `, 'Первый запуск', 'create');
}

function renderRecoveryStep() {
  appRoot.innerHTML = renderAuthShell(`
      <div class="auth-panel__code">VAULT / RECOVERY</div>
      <h1>Ключ восстановления</h1>
      <p class="muted auth-description">Сохраните ключ отдельно. После перехода дальше он больше не будет отображаться.</p>
      <div class="recovery-box">
        <div class="micro">Recovery key</div>
        <div class="recovery-key">${escapeHtml(state.recoveryKey)}</div>
        <div class="inline-actions">
          <button class="button button--secondary button--compact" data-action="save-recovery">${icon('upload')} Сохранить файл</button>
          <button class="button button--ghost button--compact" data-action="copy-recovery">${icon('copy')} Скопировать</button>
        </div>
      </div>
      <label class="check-row"><input type="checkbox" id="recovery-confirm"><span>Я сохранил ключ отдельно и понимаю, что без мастер-пароля или этого ключа данные восстановить невозможно.</span></label>
      <button class="button button--primary button--block-spaced" data-action="finish-onboarding" disabled>Перейти в хранилище</button>
  `, 'Ключ показывается один раз', 'recovery');
}

function patternMarkup(context = 'generic') {
  return `<div class="pattern-grid" data-pattern-surface data-pattern-context="${context}">
    <svg class="pattern-lines" aria-hidden="true"><polyline data-pattern-polyline points=""></polyline><line data-pattern-preview></line></svg>
    ${Array.from({ length: 9 }, (_, index) => `<button type="button" class="pattern-node" data-pattern-node="${index}" aria-label="Точка ${index + 1}"></button>`).join('')}
  </div>`;
}

function renderLockScreen() {
  clearSensitiveOverlays();
  state.unlocked = false;
  state.snapshot = null;
  state.pattern = [];
  const quickMode = state.quickUnlockAvailable ? state.lastSettings?.quickUnlockMode : 'none';
  const mode = quickMode === 'pin' || quickMode === 'pattern' ? quickMode : 'password';
  let body;
  if (mode === 'pattern') {
    body = `<div class="auth-form" id="pattern-unlock-form">
      ${patternMarkup('unlock')}
      <div class="pattern-feedback" data-pattern-message>Проведите рисунок</div>
    </div>`;
  } else {
    body = `<form class="auth-form" id="unlock-form" data-mode="${mode}">
      <label class="field"><span>${mode === 'pin' ? 'PIN-код' : 'Мастер-пароль'}</span><div class="password-reveal"><input name="credential" type="password" ${mode === 'pin' ? 'inputmode="numeric" pattern="[0-9]{6,12}" minlength="6" maxlength="12" data-pin-input' : 'maxlength="256"'} autocomplete="off" required autofocus><button type="button" data-toggle-password="credential" aria-label="Показать">${icon('eye')}</button></div></label>
      <button class="button button--primary" type="submit" data-busy-button>${icon('lock')} Открыть хранилище</button>
    </form>`;
  }
  appRoot.innerHTML = renderAuthShell(`
      <div class="auth-panel__code">VAULT / LOCKED</div>
      <h1>Хранилище заблокировано</h1>
      <p class="muted auth-description">Введите данные для доступа.</p>
      ${body}
      <div class="auth-switch"><button class="link-button" data-action="show-recovery">Войти с ключом восстановления</button></div>
  `, 'Данные остаются зашифрованными до разблокировки', 'locked');
}

function clearSensitiveOverlays() {
  for (const dialog of [entryDialog, noteDialog, simpleDialog, mediaDialog]) {
    if (dialog?.open) dialog.close();
  }
  entryForm?.reset();
  noteForm?.reset();
  if (simpleContent) simpleContent.replaceChildren();
  if (mediaContent) mediaContent.replaceChildren();
  state.pattern = [];
  state.patternDrawing = false;
  state.patternPointerId = null;
  state.patternEnrollmentFirst = null;
  state.patternMasterPassword = '';
  state.viewerMediaId = null;
  state.otpCodes = {};
}

function renderRecoveryUnlock() {
  appRoot.innerHTML = renderAuthShell(`
      <div class="auth-panel__code">VAULT / EMERGENCY</div>
      <h1>Ключ восстановления</h1>
      <p class="muted auth-description">Введите ключ в формате NV1. Проверка выполняется локально.</p>
      <form class="auth-form" id="recovery-form">
        <label class="field"><span>Recovery key</span><textarea name="key" rows="4" required autocomplete="off" spellcheck="false" placeholder="NV1-XXXX-XXXX-..."></textarea></label>
        <button class="button button--primary" type="submit" data-busy-button>Восстановить доступ</button>
      </form>
      <div class="auth-switch"><button class="link-button" data-action="back-to-lock">Вернуться к мастер-паролю</button></div>
  `, 'Аварийный доступ', 'recover');
}

function navButton(page, label, iconName, count = '') {
  return `<button class="nav-button ${state.page === page ? 'is-active' : ''}" data-page="${page}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon(iconName)}<span class="rail-label">${label}</span>${count !== '' ? `<span class="nav-count">${count}</span>` : ''}</button>`;
}

function pageMeta() {
  return ({
    passwords: ['Все записи', `${state.snapshot.entries.length} записей`],
    notes: ['Заметки', `${state.snapshot.notes.length} заметок`],
    media: ['Медиатека', `${state.snapshot.media.length} файлов`],
    documents: ['Документы', `${state.snapshot.documents.length} файлов`],
    otp: ['Коды доступа', `${state.snapshot.otp.length} аккаунтов`],
    settings: ['Настройки', 'Безопасность и блокировка'],
  })[state.page];
}

function renderMain() {
  const snapshot = state.snapshot;
  if (!snapshot) return renderLockScreen();
  const [title, subtitle] = pageMeta();
  appRoot.innerHTML = `<div class="app-shell archive-shell">
    <aside class="system-rail">
      <nav class="nav rail-nav">
        ${navButton('passwords', 'Все записи', 'key', snapshot.entries.length)}
        ${navButton('notes', 'Заметки', 'note', snapshot.notes.length)}
        ${navButton('media', 'Фото и видео', 'image', snapshot.media.length)}
        ${navButton('documents', 'Документы', 'document', snapshot.documents.length)}
        ${navButton('otp', 'Коды доступа', 'otp', snapshot.otp.length)}
      </nav>
      <div class="rail-spacer"></div>
      <nav class="nav rail-nav rail-nav--bottom">
        ${navButton('settings', 'Параметры', 'settings')}
        <button class="nav-button" data-action="lock" title="Заблокировать" aria-label="Заблокировать">${icon('logout')}<span class="rail-label">Заблокировать</span></button>
      </nav>
    </aside>
    <section class="workspace">
      <header class="commandbar">
        <div class="page-heading"><span>NOCTURNE / ${state.page.toUpperCase()}</span><div><h1>${escapeHtml(title)}</h1><small>${escapeHtml(subtitle)}</small></div></div>
        <div class="commandbar__actions">
          ${state.page === 'passwords' ? `<label class="search-field">${icon('search')}<input type="search" id="vault-search" value="${escapeHtml(state.query)}" placeholder="Поиск"></label><button class="button button--primary button--compact" data-action="new-entry">${icon('plus')} Новая запись</button>` : ''}
          ${state.page === 'notes' ? `<button class="button button--primary button--compact" data-action="new-note">${icon('plus')} Новая заметка</button>` : ''}
          ${state.page === 'media' ? `<button class="button button--primary button--compact" data-action="import-media">${icon('upload')} Импортировать</button>` : ''}
          ${state.page === 'documents' ? `<button class="button button--primary button--compact" data-action="import-documents">${icon('upload')} Добавить документы</button>` : ''}
        </div>
      </header>
      <div class="workspace-body">${renderCurrentPage()}</div>
    </section>
  </div>`;
  if (state.page === 'otp') queueMicrotask(refreshOtpCodes);
}

function renderCurrentPage() {
  if (state.page === 'passwords') return renderPasswordsPage();
  if (state.page === 'notes') return renderNotesPage();
  if (state.page === 'otp') return renderOtpPage();
  if (state.page === 'media') return renderMediaPage();
  if (state.page === 'documents') return renderDocumentsPage();
  if (state.page === 'settings') return renderSettingsPage();
  return renderPasswordsPage();
}

function renderPasswordsPage() {
  const query = state.query.trim().toLocaleLowerCase('ru');
  const entries = state.snapshot.entries.filter((entry) => (!state.folderFilter || entry.folderId === state.folderFilter) && (!query || [entry.title, entry.username, entry.url].some((value) => value.toLocaleLowerCase('ru').includes(query))));
  const selected = entries.find((entry) => entry.id === state.selectedEntryId) || entries[0] || null;
  if (selected && state.selectedEntryId !== selected.id) state.selectedEntryId = selected.id;
  return `<div class="vault-browser vault-browser--passwords">
    <aside class="folder-index">
      <header><span>Коллекции</span><button class="icon-button" data-action="add-folder" title="Новая папка">${icon('plus')}</button></header>
      <nav>
        <button class="folder-index__row ${!state.folderFilter ? 'is-active' : ''}" data-action="all-folders"><span>${icon('key')}Все записи</span><em>${state.snapshot.entries.length}</em></button>
        ${state.snapshot.folders.map((folder) => `<button class="folder-index__row ${state.folderFilter === folder.id ? 'is-active' : ''}" data-folder-filter="${escapeHtml(folder.id)}"><span>${icon('folder')}${escapeHtml(folder.name)}</span><em>${state.snapshot.entries.filter((entry) => entry.folderId === folder.id).length}</em></button>`).join('')}
      </nav>
    </aside>
    <section class="record-list-pane">
      <div class="record-index-head"><span>${state.folderFilter ? state.snapshot.folders.find((folder) => folder.id === state.folderFilter)?.name || 'Папка' : 'Все записи'}</span><em>${entries.length}</em></div>
      <div class="record-list">
        ${entries.length ? entries.map((entry) => renderRecordRow(entry, selected?.id === entry.id)).join('') : `<div class="plain-empty"><strong>${query ? 'Совпадений нет' : 'Хранилище пусто'}</strong><span>${query ? 'Измените запрос.' : 'Нажмите «Новая запись», чтобы добавить первые данные.'}</span></div>`}
      </div>
    </section>
    <aside class="record-inspector">${selected ? renderEntryInspector(selected) : `<div class="inspector-empty"><span>—</span><p>Выберите запись</p></div>`}</aside>
  </div>`;
}

function renderRecordRow(entry, selected) {
  const folder = state.snapshot.folders.find((item) => item.id === entry.folderId);
  return `<div class="record-row ${selected ? 'is-selected' : ''}" data-select-entry="${entry.id}" role="button" tabindex="0">
    <span class="record-row__mark">${escapeHtml(entry.title.charAt(0) || '?')}</span><div><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.username || 'Без логина')}</span></div><em>${escapeHtml(folder?.name || '—')}</em>
  </div>`;
}

function renderEntryInspector(entry) {
  const folder = state.snapshot.folders.find((item) => item.id === entry.folderId);
  return `<div class="inspector-head"><div><span>Учётная запись · ${escapeHtml(folder?.name || 'Без папки')}</span><h2>${escapeHtml(entry.title)}</h2><p>Изменено ${formatDate(entry.updatedAt)}</p></div><span class="inspector-monogram">${escapeHtml(entry.title.charAt(0) || '?')}</span></div>
    <div class="inspector-fields">
      <div class="inspector-field"><label>Логин</label><div><span>${escapeHtml(entry.username || 'Не указан')}</span>${entry.username ? `<button class="icon-button" data-copy-username="${entry.id}" aria-label="Скопировать логин">${icon('copy')}</button>` : ''}</div></div>
      <div class="inspector-field"><label>Пароль</label><div><span class="masked-value">••••••••••••</span><button class="icon-button" data-copy-entry="${entry.id}" aria-label="Скопировать пароль">${icon('copy')}</button></div></div>
      ${entry.url ? `<div class="inspector-field"><label>Адрес</label><div><span>${escapeHtml(entry.url)}</span><button class="icon-button" data-copy-url="${entry.id}" aria-label="Скопировать адрес">${icon('copy')}</button></div></div>` : ''}
      ${entry.notes ? `<div class="inspector-field inspector-field--notes"><label>Заметка</label><p>${escapeHtml(entry.notes)}</p></div>` : ''}
    </div>
    <div class="inspector-actions"><button class="button button--ghost button--compact" data-edit-entry="${entry.id}">${icon('edit')} Изменить</button><button class="icon-button icon-button--danger" data-delete-entry="${entry.id}" aria-label="Удалить">${icon('trash')}</button></div>`;
}

function renderMediaPage() {
  const media = state.snapshot.media;
  const matches = (item) => state.mediaFilter === 'all' || item.type.startsWith(`${state.mediaFilter}/`);
  const visible = media.filter(matches);
  const filters = [['all', 'Все'], ['image', 'Фото'], ['video', 'Видео'], ['audio', 'Аудио']];
  return `<div class="media-workspace"><div class="media-filter" role="tablist">${filters.map(([id, label]) => `<button class="${state.mediaFilter === id ? 'is-active' : ''}" data-media-filter="${id}">${label}<span>${id === 'all' ? media.length : media.filter((item) => item.type.startsWith(`${id}/`)).length}</span></button>`).join('')}</div>${visible.length ? `<div class="media-grid">${visible.map((item) => `<article class="media-card ${item.type.startsWith('audio/') ? 'media-card--audio' : ''}" data-open-media="${item.id}">
      ${item.type.startsWith('image/') ? `<img src="${item.url}" alt="">` : item.type.startsWith('video/') ? `<video src="${item.url}" muted preload="metadata"></video>` : `<div class="audio-cover">${icon('audio')}<span>${escapeHtml(documentExtension(item.name))}</span></div>`}
      <div class="media-card__meta"><strong>${escapeHtml(item.name)}</strong><span>${formatBytes(item.size)}</span></div>
    </article>`).join('')}</div>` : `<div class="plain-empty plain-empty--center"><strong>${media.length ? 'В этом разделе пусто' : 'Нет файлов'}</strong><span>Фото, видео и аудио сохраняются в зашифрованном виде.</span><button class="button button--ghost button--compact" data-action="import-media">Импортировать</button></div>`}</div>`;
}

function documentExtension(name) {
  const match = String(name || '').match(/\.([^.]+)$/);
  return match ? match[1].slice(0, 5).toUpperCase() : 'FILE';
}

function renderDocumentsPage() {
  const documents = state.snapshot.documents;
  const selected = documents.find((item) => item.id === state.selectedDocumentId) || documents[0] || null;
  if (selected && state.selectedDocumentId !== selected.id) state.selectedDocumentId = selected.id;
  const previewable = selected && ['text/plain', 'text/markdown', 'text/csv'].includes(selected.type);
  return `<div class="document-workspace"><section class="document-index"><header><span>Файл</span><span>Размер</span></header><div class="document-list">${documents.length ? documents.map((item) => `<button class="document-row ${item.id === selected?.id ? 'is-selected' : ''}" data-select-document="${item.id}"><span class="document-row__type">${escapeHtml(documentExtension(item.name))}</span><span class="document-row__name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.type)}</small></span><em>${formatBytes(item.size)}</em></button>`).join('') : `<div class="plain-empty"><strong>Документов пока нет</strong><span>PDF, Office, OpenDocument и текстовые файлы сохраняются только в зашифрованном виде.</span><button class="button button--ghost button--compact" data-action="import-documents">Добавить документы</button></div>`}</div></section><aside class="document-inspector">${selected ? `<div class="document-inspector__type">${escapeHtml(documentExtension(selected.name))}</div><p class="eyebrow">Защищённый документ</p><h2>${escapeHtml(selected.name)}</h2><dl><div><dt>Формат</dt><dd>${escapeHtml(selected.type)}</dd></div><div><dt>Размер</dt><dd>${formatBytes(selected.size)}</dd></div></dl><p class="document-inspector__note">${previewable ? 'Просмотр выполняется внутри Nocturne — файл не создаётся на диске.' : 'Этот формат нельзя безопасно показать внутри приложения. Доступен только явный экспорт.'}</p><div class="document-actions">${previewable ? `<button class="button button--primary button--compact" data-preview-document="${selected.id}">Смотреть</button>` : ''}<button class="button button--ghost button--compact" data-save-media="${selected.id}">Сохранить на ПК</button><button class="button button--ghost button--compact" data-rename-media="${selected.id}">Переименовать</button><button class="button button--danger button--compact" data-delete-media="${selected.id}">Удалить</button></div>` : `<div class="inspector-empty"><span>—</span><p>Выберите документ</p></div>`}</aside></div>`;
}

function renderNotesPage() {
  const notes = state.snapshot.notes;
  const selected = notes.find((note) => note.id === state.selectedNoteId) || notes[0] || null;
  if (selected && state.selectedNoteId !== selected.id) state.selectedNoteId = selected.id;
  return `<div class="vault-browser notes-browser">
    <section class="note-index"><div class="record-columns"><span>Название</span></div><div class="record-list">
      ${notes.length ? notes.map((note) => `<button class="note-row ${note.id === selected?.id ? 'is-selected' : ''}" data-select-note="${note.id}"><strong>${escapeHtml(note.title)}</strong><small>${escapeHtml((note.body || 'Пустая заметка').replace(/\s+/g, ' ').slice(0, 90))}</small></button>`).join('') : `<div class="plain-empty"><strong>Заметок пока нет</strong><span>Создайте первую защищённую заметку.</span></div>`}
    </div></section>
    <aside class="note-sheet">${selected ? renderNoteInspector(selected) : `<div class="inspector-empty"><span>—</span><p>Выберите заметку</p></div>`}</aside>
  </div>`;
}

function renderNoteInspector(note) {
  return `<div class="note-sheet__head"><div><span>Заметка</span><h1>${escapeHtml(note.title)}</h1></div><div class="note-sheet__actions"><button class="button button--ghost button--compact" data-copy-note="${note.id}">${icon('copy')} Копировать</button><button class="button button--ghost button--compact" data-edit-note="${note.id}">${icon('edit')} Изменить</button><button class="icon-button icon-button--danger" data-delete-note="${note.id}" aria-label="Удалить">${icon('trash')}</button></div></div>
    <div class="note-sheet__body">${escapeHtml(note.body || 'Пустая заметка')}</div>
    <div class="note-attachments"><div class="note-attachments__head"><div><strong>Вложения</strong><span>${note.attachments.length} фото</span></div><div class="note-attachment-actions"><button class="button button--ghost button--compact" data-paste-note="${note.id}">${icon('copy')} Из буфера</button><button class="button button--ghost button--compact" data-attach-note="${note.id}">${icon('upload')} Из файла</button></div></div>
    ${note.attachments.length ? `<div class="note-photo-strip">${note.attachments.map((item) => `<figure data-open-media="${item.id}"><img src="${item.url}" alt="${escapeHtml(item.name)}"><figcaption>${escapeHtml(item.name)}</figcaption></figure>`).join('')}</div>` : `<p class="note-attachments__empty">Вставьте изображение из буфера или выберите файл. Оно останется внутри зашифрованного контейнера.</p>`}</div>`;
}

function formatOtpCode(code, digits = 6) {
  const value = String(code || '').padStart(digits, '—');
  const split = Math.ceil(value.length / 2);
  return `${value.slice(0, split)} ${value.slice(split)}`;
}

function renderOtpPage() {
  const accounts = state.snapshot.otp;
  return `<div class="otp-workspace"><header class="otp-intro"><div><p class="eyebrow">Локальный аутентификатор</p><h2>Одноразовые коды</h2></div></header>
    <div class="otp-list">${accounts.length ? accounts.map((account) => {
      const live = state.otpCodes[account.id];
      const remaining = live?.remaining || account.period;
      const angle = Math.max(0, Math.min(360, (remaining / account.period) * 360));
      return `<article class="otp-row" data-otp-row="${account.id}"><span class="otp-row__mark">${escapeHtml((account.issuer || account.account).charAt(0).toUpperCase())}</span><div class="otp-row__identity"><strong>${escapeHtml(account.issuer || 'Без сервиса')}</strong><span>${escapeHtml(account.account || 'Без аккаунта')}</span></div><button class="otp-code" data-copy-otp="${account.id}" aria-label="Скопировать одноразовый код"><strong data-otp-code="${account.id}">${formatOtpCode(live?.code, account.digits)}</strong><span>Скопировать</span></button><div class="otp-time"><span class="otp-time__ring" data-otp-ring="${account.id}" style="--otp-angle:${angle}deg"><i></i></span><small data-otp-remaining="${account.id}">${remaining} сек.</small></div><div class="otp-row__actions"><button class="icon-button" data-edit-otp="${account.id}" aria-label="Изменить">${icon('edit')}</button><button class="icon-button icon-button--danger" data-delete-otp="${account.id}" aria-label="Удалить">${icon('trash')}</button></div></article>`;
    }).join('') + `<button class="otp-add-row" data-action="new-otp">${icon('plus')}<span>Добавить код</span></button>` : `<div class="otp-empty"><span>${icon('otp')}</span><h2>Кодов пока нет</h2><p>Добавьте секрет вручную, вставьте ссылку <code>otpauth://</code> или импортируйте QR-код.</p><button class="button button--primary" data-action="new-otp">Добавить первый код</button></div>`}</div></div>`;
}

async function refreshOtpCodes() {
  if (!state.unlocked || state.page !== 'otp' || !state.snapshot?.otp?.length) return;
  try {
    const codes = await apiCall(window.nocturne.otpCodes());
    state.otpCodes = Object.fromEntries(codes.map((item) => [item.id, item]));
    for (const item of codes) {
      const account = state.snapshot.otp.find((candidate) => candidate.id === item.id);
      const code = document.querySelector(`[data-otp-code="${CSS.escape(item.id)}"]`);
      const remaining = document.querySelector(`[data-otp-remaining="${CSS.escape(item.id)}"]`);
      const ring = document.querySelector(`[data-otp-ring="${CSS.escape(item.id)}"]`);
      if (code) code.textContent = formatOtpCode(item.code, account?.digits || 6);
      if (remaining) remaining.textContent = `${item.remaining} сек.`;
      if (ring) ring.style.setProperty('--otp-angle', `${(item.remaining / item.period) * 360}deg`);
    }
  } catch {}
}

function renderSettingsPage() {
  const settings = state.snapshot.settings;
  const quickLabel = settings.quickUnlockMode === 'pin' ? 'PIN-код' : settings.quickUnlockMode === 'pattern' ? 'Рисунок' : 'Не настроена';
  const sections = {
    lock: {
      icon: 'timer', title: 'Блокировка', caption: 'Когда хранилище должно закрываться и очищать временные данные.',
      content: `<section class="settings-card">
        <div class="settings-card__head"><div class="settings-card__icon">${icon('timer')}</div><div><h3>Автоматическая блокировка</h3><p>Очищает расшифрованный ключ из памяти после бездействия.</p></div></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Время бездействия</strong><span>После этого потребуется разблокировка</span></div><select id="setting-timeout">${[1, 5, 15, 30, 60].map((number) => `<option value="${number}" ${settings.autoLockMinutes === number ? 'selected' : ''}>${number} мин.</option>`).join('')}</select></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>При сворачивании</strong><span>Блокировать сразу после сворачивания окна</span></div><label class="switch"><input id="setting-minimize" type="checkbox" ${settings.lockOnMinimize ? 'checked' : ''}><span></span></label></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>При блокировке Windows</strong><span>Также блокировать перед переходом в сон</span></div><label class="switch"><input id="setting-system" type="checkbox" ${settings.lockOnSystemLock ? 'checked' : ''}><span></span></label></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Очистка буфера обмена</strong><span>После копирования пароля</span></div><select id="setting-clipboard">${[15, 30, 60, 120].map((number) => `<option value="${number}" ${settings.clipboardSeconds === number ? 'selected' : ''}>${number} сек.</option>`).join('')}</select></div>
        <div class="dialog__footer"><button class="button button--primary button--compact" data-action="save-settings">Сохранить настройки</button></div>
      </section>`,
    },
    access: {
      icon: 'key', title: 'Доступ', caption: 'Мастер-пароль и быстрый способ входа в текущем сеансе.',
      content: `<section class="settings-card">
        <div class="settings-card__head"><div class="settings-card__icon">${icon('key')}</div><div><h3>Способы доступа</h3><p>Быстрый способ работает только до полного закрытия приложения.</p></div></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Быстрая разблокировка</strong><span>${quickLabel}</span></div><button class="button button--ghost button--compact" data-action="configure-quick">Настроить</button></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Мастер-пароль</strong><span>Основной ключ доступа к контейнеру</span></div><button class="button button--ghost button--compact" data-action="change-password">Изменить</button></div>
      </section>`,
    },
    destroy: {
      icon: 'warning', title: 'Уничтожение', caption: 'Необратимые сценарии удаления ключа и локального контейнера.',
      content: `<section class="settings-card danger-card">
        <div class="settings-card__head"><div class="settings-card__icon">${icon('warning')}</div><div><h3>Уничтожение хранилища</h3><p>Удаляет ключ, перезаписывает локальные файлы и очищает контейнер.</p></div></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>После неудачных попыток</strong><span>Минимальный допустимый лимит — 10</span></div><label class="switch"><input id="setting-wipe" type="checkbox" ${settings.wipeEnabled ? 'checked' : ''}><span></span></label></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Количество попыток</strong><span>Рекомендуется не менее 15</span></div><input id="setting-wipe-threshold" type="number" min="10" max="50" value="${settings.wipeThreshold}"></div>
        <div class="danger-note">Внешний recovery-ключ или отдельная резервная копия могут восстановить данные. Приложение не может удалить файлы с отключённых носителей.</div>
        <div class="dialog__footer"><button class="button button--ghost button--compact" data-action="save-settings">Сохранить лимит</button><button class="button button--danger button--compact" data-action="destroy-now">Уничтожить сейчас</button></div>
      </section>`,
    },
  };
  const current = sections[state.settingsSection] || sections.lock;
  return `<div class="settings-workspace"><aside class="settings-section-nav" aria-label="Разделы настроек">
      <div class="settings-section-nav__head"><span>Настройки</span><small>v${escapeHtml(state.version)}</small></div>
      ${Object.entries(sections).map(([id, section]) => `<button class="settings-section-button ${id === state.settingsSection ? 'is-active' : ''}" data-settings-section="${id}"><span class="settings-section-button__icon">${icon(section.icon)}</span><span><strong>${section.title}</strong><small>${id === 'lock' ? 'Таймер и буфер' : id === 'access' ? 'Пароль и вход' : 'Очистка данных'}</small></span></button>`).join('')}
    </aside><main class="settings-stage" data-settings-stage="${state.settingsSection}"><header class="settings-stage__head"><p class="eyebrow">Конфиденциальность</p><h1>${current.title}</h1><p>${current.caption}</p></header><div class="settings-layout">${current.content}</div></main></div>`;
}

function renderEmpty(iconName, title, text, action, label) {
  return `<div class="empty-state"><div><div class="empty-state__icon">${icon(iconName)}</div><h2>${title}</h2><p>${text}</p>${action ? `<button class="button button--secondary" data-action="${action}">${icon('plus')} ${label}</button>` : ''}</div></div>`;
}

function updateSnapshot(snapshot) {
  state.snapshot = snapshot;
  state.lastSettings = { ...snapshot.settings };
  state.quickUnlockAvailable = snapshot.settings.quickUnlockAvailable;
  state.unlocked = true;
  state.lastActivity = Date.now();
  renderMain();
}

function openEntry(entry = null) {
  entryForm.reset();
  document.querySelector('#entry-dialog-title').textContent = entry ? 'Изменить запись' : 'Новый пароль';
  const folderSelect = entryForm.elements.folderId;
  folderSelect.innerHTML = state.snapshot.folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</option>`).join('');
  if (entry) {
    for (const key of ['id', 'title', 'username', 'password', 'url', 'notes', 'folderId']) entryForm.elements[key].value = entry[key] || '';
  }
  entryForm.elements.currentPassword.value = '';
  entryForm.querySelector('.entry-current-password').hidden = !entry;
  entryForm.elements.password.type = 'password';
  entryDialog.showModal();
  setTimeout(() => entryForm.elements.title.focus(), 10);
}

function openNote(note = null) {
  noteForm.reset();
  document.querySelector('#note-dialog-title').textContent = note ? 'Изменить заметку' : 'Новая заметка';
  if (note) for (const key of ['id', 'title', 'body']) noteForm.elements[key].value = note[key] || '';
  noteDialog.showModal();
  setTimeout(() => noteForm.elements.title.focus(), 10);
}

function openSimple(html) {
  simpleContent.innerHTML = html;
  simpleDialog.showModal();
}

function closeSimple() {
  if (simpleDialog.open) simpleDialog.close();
  simpleContent.innerHTML = '';
  state.pattern = [];
  state.patternDrawing = false;
  state.patternPointerId = null;
  state.patternEnrollmentFirst = null;
  state.patternMasterPassword = '';
  state.patternContext = null;
}

function confirmationDialog({ eyebrow = 'Подтверждение', title, text, phrase, action, button = 'Продолжить', danger = false }) {
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">${eyebrow}</p><h2>${escapeHtml(title)}</h2></div><button class="icon-button" data-close-dialog="simple-dialog">×</button></div>
    <p class="muted">${escapeHtml(text)}</p>
    ${phrase ? `<label class="field"><span>Введите «${escapeHtml(phrase)}»</span><input id="confirmation-phrase" autocomplete="off"></label>` : ''}
    <div class="dialog__footer"><button class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button class="button ${danger ? 'button--danger' : 'button--primary'}" data-confirm-action="${action}" data-confirm-phrase="${escapeHtml(phrase || '')}">${escapeHtml(button)}</button></div>`);
}

function generatePassword(length = 22) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=';
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

async function copySecret(value, label = 'Скопировано') {
  await apiCall(window.nocturne.copySecurely(value, state.lastSettings?.clipboardSeconds || 30));
  toast(`${label}. Буфер будет очищен автоматически.`);
}

async function lockNow() {
  await apiCall(window.nocturne.lock());
  state.quickUnlockAvailable = Boolean(state.lastSettings?.quickUnlockAvailable);
  renderLockScreen(state.quickUnlockAvailable && state.lastSettings?.quickUnlockMode !== 'none' ? state.lastSettings.quickUnlockMode : 'password');
}

function recordActivity() {
  if (state.unlocked) state.lastActivity = Date.now();
}

document.addEventListener('pointerdown', recordActivity, { passive: true });
document.addEventListener('keydown', recordActivity, { passive: true });
document.addEventListener('keydown', (event) => {
  if (mediaDialog.open && state.viewerMediaId && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    stepMedia(event.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  const row = event.target.closest?.('[data-select-entry]');
  if (!row || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  state.selectedEntryId = row.dataset.selectEntry;
  renderMain();
});

function appendPatternNode(value) {
  if (state.pattern.includes(value)) return;
  const next = Number(value);
  const previous = Number(state.pattern.at(-1));
  if (state.pattern.length) {
    const previousRow = Math.floor(previous / 3);
    const previousColumn = previous % 3;
    const nextRow = Math.floor(next / 3);
    const nextColumn = next % 3;
    const rowDistance = nextRow - previousRow;
    const columnDistance = nextColumn - previousColumn;
    if (rowDistance % 2 === 0 && columnDistance % 2 === 0) {
      const middle = String(((previousRow + nextRow) / 2) * 3 + ((previousColumn + nextColumn) / 2));
      if (middle !== String(previous) && middle !== String(next) && !state.pattern.includes(middle)) state.pattern.push(middle);
    }
  }
  state.pattern.push(String(value));
  updatePatternDrawing();
}

function patternPoint(grid, node) {
  const gridRect = grid.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  return { x: nodeRect.left - gridRect.left + nodeRect.width / 2, y: nodeRect.top - gridRect.top + nodeRect.height / 2 };
}

function updatePatternDrawing(pointer = null) {
  const grid = document.querySelector('[data-pattern-surface]');
  if (!grid) return;
  grid.querySelectorAll('[data-pattern-node]').forEach((node) => node.classList.toggle('is-selected', state.pattern.includes(node.dataset.patternNode)));
  const points = state.pattern.map((value) => patternPoint(grid, grid.querySelector(`[data-pattern-node="${value}"]`)));
  grid.querySelector('[data-pattern-polyline]').setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
  const preview = grid.querySelector('[data-pattern-preview]');
  const last = points.at(-1);
  if (last && pointer && state.patternDrawing) {
    preview.setAttribute('x1', last.x);
    preview.setAttribute('y1', last.y);
    preview.setAttribute('x2', pointer.x);
    preview.setAttribute('y2', pointer.y);
  } else {
    preview.removeAttribute('x1');
    preview.removeAttribute('y1');
    preview.removeAttribute('x2');
    preview.removeAttribute('y2');
  }
  const counter = document.querySelector('.pattern-feedback span');
  if (counter) counter.textContent = state.pattern.length;
}

function patternPointerPosition(event, grid) {
  const rect = grid.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function nearestPatternNode(grid, pointer) {
  let nearest = null;
  let nearestDistance = 29;
  grid.querySelectorAll('[data-pattern-node]').forEach((node) => {
    const point = patternPoint(grid, node);
    const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
    if (distance < nearestDistance) { nearest = node; nearestDistance = distance; }
  });
  return nearest;
}

document.addEventListener('pointerdown', (event) => {
  const node = event.target.closest('[data-pattern-node]');
  const grid = node?.closest('[data-pattern-surface]');
  if (!node || !grid || state.busy) return;
  event.preventDefault();
  state.pattern = [];
  state.patternDrawing = true;
  state.patternPointerId = event.pointerId;
  grid.classList.add('is-drawing');
  grid.setPointerCapture(event.pointerId);
  appendPatternNode(node.dataset.patternNode);
  updatePatternDrawing(patternPointerPosition(event, grid));
});

document.addEventListener('pointermove', (event) => {
  if (!state.patternDrawing || event.pointerId !== state.patternPointerId) return;
  const grid = document.querySelector('[data-pattern-surface].is-drawing');
  if (!grid) return;
  const pointer = patternPointerPosition(event, grid);
  const node = nearestPatternNode(grid, pointer);
  if (node) appendPatternNode(node.dataset.patternNode);
  updatePatternDrawing(pointer);
});

function setPatternMessage(message, tone = '') {
  const element = document.querySelector('[data-pattern-message]');
  if (!element) return;
  element.textContent = message;
  element.dataset.tone = tone;
}

function clearPatternSoon(message, tone = 'danger') {
  const grid = document.querySelector('[data-pattern-surface]');
  grid?.classList.add('is-error');
  setPatternMessage(message, tone);
  setTimeout(() => {
    state.pattern = [];
    grid?.classList.remove('is-error');
    updatePatternDrawing();
  }, 220);
}

async function commitPattern(context) {
  const credential = state.pattern.join('-');
  if (state.pattern.length < 5) return clearPatternSoon('Нужно соединить минимум 5 точек');
  if (context === 'unlock') {
    try {
      setBusy(true);
      const result = await apiCall(window.nocturne.quickUnlock('pattern', credential));
      await handleUnlockResult(result);
    } catch (error) {
      clearPatternSoon(friendlyError(error.message));
    } finally { setBusy(false); }
    return;
  }
  if (context === 'enroll-first') {
    state.patternEnrollmentFirst = credential;
    state.pattern = [];
    setTimeout(() => renderPatternEnrollment('confirm'), 160);
    return;
  }
  if (context === 'enroll-confirm') {
    if (credential !== state.patternEnrollmentFirst) {
      state.patternEnrollmentFirst = null;
      state.pattern = [];
      toast('Рисунки не совпадают. Создайте ключ заново.', 'danger');
      setTimeout(() => renderPatternEnrollment('first'), 160);
      return;
    }
    try { await configureQuick('pattern', credential, state.patternMasterPassword); }
    finally { state.patternMasterPassword = ''; state.patternEnrollmentFirst = null; state.pattern = []; }
  }
}

async function finishPatternDrawing(event) {
  if (!state.patternDrawing || event.pointerId !== state.patternPointerId) return;
  const grid = document.querySelector('[data-pattern-surface].is-drawing');
  state.patternDrawing = false;
  state.patternPointerId = null;
  grid?.classList.remove('is-drawing');
  updatePatternDrawing();
  if (event.type === 'pointercancel') {
    state.pattern = [];
    updatePatternDrawing();
    return;
  }
  await commitPattern(grid?.dataset.patternContext || 'generic');
}

document.addEventListener('pointerup', finishPatternDrawing);
document.addEventListener('pointercancel', finishPatternDrawing);

setInterval(() => {
  if (!state.unlocked || !state.lastSettings) return;
  if (Date.now() - state.lastActivity >= state.lastSettings.autoLockMinutes * 60_000) lockNow().catch(() => {});
}, 10_000);

setInterval(() => { refreshOtpCodes(); }, 1_000);

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-pin-input]')) event.target.value = event.target.value.replace(/\D/g, '').slice(0, 12);
  if (event.target.matches('#create-form input[name="password"]')) {
    const length = event.target.value.length;
    const meter = document.querySelector('.password-meter span');
    meter.parentElement.dataset.strength = length < 10 ? 'weak' : length < 16 ? 'fair' : 'strong';
  }
  if (event.target.matches('#recovery-confirm')) document.querySelector('[data-action="finish-onboarding"]').disabled = !event.target.checked;
  if (event.target.matches('#vault-search')) {
    state.query = event.target.value;
    const content = document.querySelector('.workspace-body');
    content.innerHTML = renderPasswordsPage();
    const search = document.querySelector('#vault-search');
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
});

document.addEventListener('paste', async (event) => {
  if (state.page !== 'notes' || !state.selectedNoteId) return;
  const hasImage = [...(event.clipboardData?.items || [])].some((item) => item.type.startsWith('image/'));
  if (!hasImage) return;
  event.preventDefault();
  try {
    const result = await apiCall(window.nocturne.importNoteFromClipboard(state.selectedNoteId));
    if (result.empty) return toast('В буфере обмена нет изображения.', 'danger');
    updateSnapshot(result.snapshot);
    toast('Фото добавлено из буфера');
  } catch (error) {
    toast(friendlyError(error.message), 'danger');
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formId = event.target.getAttribute('id');
  if (state.busy) return;
  try {
    setBusy(true);
    if (formId === 'create-form') {
      const form = new FormData(event.target);
      if (form.get('password') !== form.get('confirm')) throw new Error('PASSWORD_MISMATCH');
      const result = await apiCall(window.nocturne.createVault(form.get('password')));
      state.exists = true;
      state.recoveryKey = result.recoveryKey;
      renderRecoveryStep();
    } else if (formId === 'unlock-form') {
      const mode = event.target.dataset.mode;
      const credential = new FormData(event.target).get('credential');
      const result = mode === 'pin' ? await apiCall(window.nocturne.quickUnlock('pin', credential)) : await apiCall(window.nocturne.unlock(credential));
      await handleUnlockResult(result);
    } else if (formId === 'recovery-form') {
      const result = await apiCall(window.nocturne.recover(new FormData(event.target).get('key')));
      updateSnapshot(result);
      toast('Доступ восстановлен. Рекомендуем сменить мастер-пароль.');
    } else if (formId === 'entry-form') {
      const values = Object.fromEntries(new FormData(entryForm).entries());
      const existing = state.snapshot.entries.find((entry) => entry.id === values.id);
      if (existing) values.createdAt = existing.createdAt;
      const snapshot = await apiCall(window.nocturne.saveEntry(values));
      state.selectedEntryId = values.id || snapshot.entries[0]?.id || null;
      entryDialog.close();
      updateSnapshot(snapshot);
      toast(existing ? 'Запись обновлена' : 'Запись добавлена');
    } else if (formId === 'note-form') {
      const values = {
        id: noteForm.elements.namedItem('id').value,
        title: noteForm.elements.namedItem('title').value,
        body: noteForm.elements.namedItem('body').value,
      };
      const existing = state.snapshot.notes.find((note) => note.id === values.id);
      if (existing) values.createdAt = existing.createdAt;
      const snapshot = await apiCall(window.nocturne.saveNote(values));
      state.selectedNoteId = values.id || snapshot.notes[0]?.id || null;
      noteDialog.close();
      updateSnapshot(snapshot);
      toast(existing ? 'Заметка обновлена' : 'Заметка создана');
    } else if (formId === 'otp-form') {
      const values = Object.fromEntries(new FormData(event.target).entries());
      const snapshot = await apiCall(window.nocturne.saveOtp(values));
      closeSimple();
      state.page = 'otp';
      updateSnapshot(snapshot);
      toast(values.id ? 'TOTP-аккаунт обновлён' : 'TOTP-аккаунт добавлен');
    } else if (formId === 'otp-uri-form') {
      const uri = new FormData(event.target).get('uri');
      const snapshot = await apiCall(window.nocturne.importOtpUri(uri));
      closeSimple();
      state.page = 'otp';
      updateSnapshot(snapshot);
      toast('TOTP-ссылка импортирована');
    } else if (formId === 'quick-pin-form') {
      const form = new FormData(event.target);
      if (form.get('pin') !== form.get('confirm')) throw new Error('PASSWORD_MISMATCH');
      await configureQuick('pin', form.get('pin'), form.get('currentPassword'));
    } else if (formId === 'pattern-reauth-form') {
      const currentPassword = new FormData(event.target).get('currentPassword');
      await apiCall(window.nocturne.verifyMasterPassword(currentPassword));
      state.patternMasterPassword = currentPassword;
      renderPatternEnrollment('first');
    } else if (formId === 'disable-quick-form') {
      const currentPassword = new FormData(event.target).get('currentPassword');
      await configureQuick('none', '', currentPassword);
    } else if (formId === 'change-password-form') {
      const form = new FormData(event.target);
      if (form.get('password') !== form.get('confirm')) throw new Error('PASSWORD_MISMATCH');
      await apiCall(window.nocturne.changeMasterPassword(form.get('currentPassword'), form.get('password')));
      closeSimple();
      toast('Мастер-пароль изменён');
    } else if (formId === 'folder-form') {
      const snapshot = await apiCall(window.nocturne.addFolder(new FormData(event.target).get('name')));
      closeSimple();
      updateSnapshot(snapshot);
      toast('Папка создана');
    } else if (formId === 'media-rename-form') {
      const form = new FormData(event.target);
      const id = form.get('id');
      const snapshot = await apiCall(window.nocturne.renameMedia(id, form.get('name')));
      closeSimple();
      updateSnapshot(snapshot);
      openMedia(id);
      toast('Файл переименован');
    }
  } catch (error) {
    toast(error.message === 'PASSWORD_MISMATCH' ? 'Значения не совпадают.' : friendlyError(error.message), 'danger');
  } finally {
    setBusy(false);
  }
});

async function handleUnlockResult(result) {
  if (result.wiped) {
    renderWiped();
    return;
  }
  if (!result.unlocked) {
    state.pattern = [];
    const suffix = result.retryAfterSeconds ? ` Повторите через ${result.retryAfterSeconds} сек.` : '';
    toast(`Неверные данные. Попытка ${result.failedAttempts}.${suffix}`, 'danger');
    const input = document.querySelector('#unlock-form input');
    if (input) input.value = '';
    updatePatternDrawing();
    return;
  }
  updateSnapshot(result);
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button, [data-open-media], [data-select-entry], [data-select-note], [data-select-document]');
  if (!button || state.busy) return;
  try {
    const windowAction = button.dataset.window;
    if (windowAction) {
      if (windowAction === 'minimize') await window.nocturne.minimize();
      if (windowAction === 'maximize') await window.nocturne.maximize();
      if (windowAction === 'close') await window.nocturne.close();
      return;
    }
    if (button.dataset.closeDialog) {
      document.querySelector(`#${button.dataset.closeDialog}`).close();
      if (button.dataset.closeDialog === 'media-dialog') {
        state.viewerMediaId = null;
        mediaContent.replaceChildren();
      }
      return;
    }
    if (button.dataset.togglePassword) {
      const input = button.closest('form, .auth-panel')?.querySelector(`[name="${CSS.escape(button.dataset.togglePassword)}"]`);
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.classList.toggle('is-revealed', reveal);
      button.setAttribute('aria-label', reveal ? 'Скрыть пароль' : 'Показать пароль');
      return;
    }
    if (button.dataset.settingsSection) {
      state.settingsSection = button.dataset.settingsSection;
      renderMain();
      return;
    }
    if (button.dataset.mediaFilter) {
      state.mediaFilter = button.dataset.mediaFilter;
      renderMain();
      return;
    }
    if (button.dataset.page) {
      state.page = button.dataset.page;
      state.query = '';
      state.folderFilter = null;
      renderMain();
      return;
    }
    if (button.dataset.folderFilter) {
      state.page = 'passwords';
      state.folderFilter = button.dataset.folderFilter;
      state.query = '';
      state.selectedEntryId = null;
      renderMain();
      return;
    }
    if (button.dataset.selectEntry) {
      state.selectedEntryId = button.dataset.selectEntry;
      renderMain();
      return;
    }
    if (button.dataset.selectNote) { state.selectedNoteId = button.dataset.selectNote; renderMain(); return; }
    if (button.dataset.selectDocument) { state.selectedDocumentId = button.dataset.selectDocument; renderMain(); return; }
    if (button.dataset.copyEntry) {
      const entry = state.snapshot.entries.find((item) => item.id === button.dataset.copyEntry);
      return copySecret(entry.password, 'Пароль скопирован');
    }
    if (button.dataset.copyUsername) {
      const entry = state.snapshot.entries.find((item) => item.id === button.dataset.copyUsername);
      return copySecret(entry.username, 'Логин скопирован');
    }
    if (button.dataset.copyUrl) {
      const entry = state.snapshot.entries.find((item) => item.id === button.dataset.copyUrl);
      return copySecret(entry.url, 'Адрес скопирован');
    }
    if (button.dataset.copyNote) {
      const note = state.snapshot.notes.find((item) => item.id === button.dataset.copyNote);
      return copySecret(note.body, 'Заметка скопирована');
    }
    if (button.dataset.copyOtp) {
      await refreshOtpCodes();
      const code = state.otpCodes[button.dataset.copyOtp]?.code;
      if (!code) throw new Error('OTP_CODE_UNAVAILABLE');
      return copySecret(code, 'Одноразовый код скопирован');
    }
    if (button.dataset.editOtp) return openOtpDialog(state.snapshot.otp.find((item) => item.id === button.dataset.editOtp));
    if (button.dataset.deleteOtp) {
      const account = state.snapshot.otp.find((item) => item.id === button.dataset.deleteOtp);
      return confirmationDialog({ title: `Удалить код «${account.issuer || account.account}»?`, text: 'TOTP-секрет будет удалён из зашифрованного контейнера.', action: `delete-otp:${account.id}`, button: 'Удалить', danger: true });
    }
    if (button.dataset.editEntry) return openEntry(state.snapshot.entries.find((item) => item.id === button.dataset.editEntry));
    if (button.dataset.editNote) return openNote(state.snapshot.notes.find((item) => item.id === button.dataset.editNote));
    if (button.dataset.attachNote) {
      const result = await apiCall(window.nocturne.importNotePhotos(button.dataset.attachNote));
      if (!result.canceled) { updateSnapshot(result.snapshot); toast(`Прикреплено фото: ${result.added}`); }
      return;
    }
    if (button.dataset.pasteNote) {
      const result = await apiCall(window.nocturne.importNoteFromClipboard(button.dataset.pasteNote));
      if (result.empty) return toast('В буфере обмена нет изображения.', 'danger');
      updateSnapshot(result.snapshot);
      toast('Фото добавлено из буфера');
      return;
    }
    if (button.dataset.deleteEntry) {
      const entry = state.snapshot.entries.find((item) => item.id === button.dataset.deleteEntry);
      return confirmationDialog({ title: `Удалить «${entry.title}»?`, text: 'Запись будет удалена из зашифрованного контейнера.', action: `delete-entry:${entry.id}`, button: 'Удалить', danger: true });
    }
    if (button.dataset.deleteNote) {
      const note = state.snapshot.notes.find((item) => item.id === button.dataset.deleteNote);
      return confirmationDialog({ title: `Удалить «${note.title}»?`, text: 'Заметка и все прикреплённые к ней фото будут перезаписаны и удалены.', action: `delete-note:${note.id}`, button: 'Удалить', danger: true });
    }
    if (button.dataset.openMedia) return openMedia(button.dataset.openMedia);
    if (button.dataset.mediaStep) return stepMedia(Number(button.dataset.mediaStep));
    if (button.dataset.previewDocument) {
      await openDocumentPreview(button.dataset.previewDocument);
      return;
    }
    if (button.dataset.deleteMedia) {
      const item = findMedia(button.dataset.deleteMedia);
      return confirmationDialog({ title: `Удалить «${item.name}»?`, text: 'Зашифрованная копия будет перезаписана и удалена из медиатеки.', action: `delete-media:${item.id}`, button: 'Удалить', danger: true });
    }
    if (button.dataset.saveMedia) {
      const result = await apiCall(window.nocturne.saveMedia(button.dataset.saveMedia));
      if (!result.canceled) toast('Расшифрованная копия сохранена');
      return;
    }
    if (button.dataset.copyMedia) {
      await apiCall(window.nocturne.copyMedia(button.dataset.copyMedia));
      toast('Изображение скопировано безопасно');
      return;
    }
    if (button.dataset.renameMedia) {
      const item = findMedia(button.dataset.renameMedia);
      openSimple(`<form id="media-rename-form"><input type="hidden" name="id" value="${escapeHtml(item.id)}"><div class="dialog__header"><div><p class="eyebrow">Файл</p><h2>Переименовать</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><label class="field"><span>Название</span><input name="name" maxlength="220" required value="${escapeHtml(item.name)}" autofocus></label><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Сохранить</button></div></form>`);
      return;
    }
    if (button.dataset.confirmAction) return handleConfirmation(button);
    const action = button.dataset.action;
    if (!action) return;
    if (action === 'save-recovery') {
      const result = await apiCall(window.nocturne.saveRecoveryKey(state.recoveryKey));
      if (!result.canceled) { state.recoverySaved = true; toast('Ключ сохранён в файл'); }
    }
    if (action === 'copy-recovery') await copySecret(state.recoveryKey, 'Ключ скопирован');
    if (action === 'finish-onboarding') {
      state.recoveryKey = null;
      const snapshot = await apiCall(window.nocturne.snapshot());
      state.page = 'passwords';
      updateSnapshot(snapshot);
    }
    if (action === 'show-recovery') renderRecoveryUnlock();
    if (action === 'back-to-lock') renderLockScreen();
    if (action === 'new-entry') openEntry();
    if (action === 'all-folders') { state.folderFilter = null; state.selectedEntryId = null; renderMain(); }
    if (action === 'new-note') openNote();
    if (action === 'new-otp') openOtpImportDialog();
    if (action === 'otp-manual') openOtpDialog();
    if (action === 'otp-uri') openOtpUriDialog();
    if (action === 'otp-import-clipboard') {
      const result = await apiCall(window.nocturne.importOtpClipboard());
      closeSimple(); state.page = 'otp'; updateSnapshot(result.snapshot); toast(`Добавлен код: ${result.imported.issuer || result.imported.account}`);
    }
    if (action === 'otp-import-qr') {
      const result = await apiCall(window.nocturne.importOtpQr());
      if (!result.canceled) { closeSimple(); state.page = 'otp'; updateSnapshot(result.snapshot); toast(`Добавлен код: ${result.imported.issuer || result.imported.account}`); }
    }
    if (action === 'lock') await lockNow();
    if (action === 'toggle-entry-password') {
      const input = entryForm.elements.password;
      input.type = input.type === 'password' ? 'text' : 'password';
      button.textContent = input.type === 'password' ? 'Показать' : 'Скрыть';
    }
    if (action === 'generate-password') {
      entryForm.elements.password.value = generatePassword();
      entryForm.elements.password.type = 'text';
      toast('Создан стойкий пароль');
    }
    if (action === 'import-media') {
      setBusy(true);
      const result = await apiCall(window.nocturne.importMedia());
      if (!result.canceled) { updateSnapshot(result.snapshot); toast(`Добавлено файлов: ${result.added}`); }
    }
    if (action === 'import-documents') {
      setBusy(true);
      const result = await apiCall(window.nocturne.importDocuments());
      if (!result.canceled) { updateSnapshot(result.snapshot); toast(`Добавлено документов: ${result.added}`); }
    }
    if (action === 'add-folder') openFolderDialog();
    if (action === 'save-settings') await saveSettings();
    if (action === 'configure-quick') openQuickDialog();
    if (action === 'quick-none') openDisableQuickDialog();
    if (action === 'quick-pin') openPinDialog();
    if (action === 'quick-pattern') openPatternConfigDialog();
    if (action === 'change-password') openChangePasswordDialog();
    if (action === 'destroy-now') confirmationDialog({ eyebrow: 'Необратимое действие', title: 'Уничтожить локальное хранилище?', text: 'Ключ будет уничтожен, а контейнер и зашифрованные медиафайлы — перезаписаны и удалены.', phrase: 'УДАЛИТЬ НАВСЕГДА', action: 'destroy-vault', button: 'Уничтожить', danger: true });
  } catch (error) {
    toast(friendlyError(error.message), 'danger');
  } finally {
    setBusy(false);
  }
});

async function handleConfirmation(button) {
  const expected = button.dataset.confirmPhrase;
  const actual = document.querySelector('#confirmation-phrase')?.value || '';
  if (expected && actual !== expected) return toast('Контрольная фраза введена неверно.', 'danger');
  const action = button.dataset.confirmAction;
  if (action.startsWith('delete-entry:')) {
    const snapshot = await apiCall(window.nocturne.deleteEntry(action.split(':')[1]));
    closeSimple();
    updateSnapshot(snapshot);
    toast('Запись удалена');
  }
  if (action.startsWith('delete-note:')) {
    const snapshot = await apiCall(window.nocturne.deleteNote(action.split(':')[1]));
    closeSimple();
    state.selectedNoteId = null;
    updateSnapshot(snapshot);
    toast('Заметка удалена');
  }
  if (action.startsWith('delete-otp:')) {
    const snapshot = await apiCall(window.nocturne.deleteOtp(action.split(':')[1]));
    closeSimple();
    state.otpCodes = {};
    updateSnapshot(snapshot);
    toast('TOTP-аккаунт удалён');
  }
  if (action.startsWith('delete-media:')) {
    const snapshot = await apiCall(window.nocturne.deleteMedia(action.split(':')[1]));
    mediaDialog.close();
    closeSimple();
    updateSnapshot(snapshot);
    toast('Файл удалён');
  }
  if (action === 'enable-wipe') {
    closeSimple();
    await persistSettings(true);
  }
  if (action === 'destroy-vault') {
    await apiCall(window.nocturne.destroyVault());
    closeSimple();
    renderWiped();
  }
}

function openFolderDialog() {
  openSimple(`<form id="folder-form"><div class="dialog__header"><div><p class="eyebrow">Организация</p><h2>Новая папка</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><label class="field"><span>Название</span><input name="name" maxlength="48" required autofocus placeholder="Например, Проекты"></label><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Создать</button></div></form>`);
}

function openOtpImportDialog() {
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">Коды доступа</p><h2>Добавить TOTP</h2></div><button class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">QR-код и секрет обрабатываются только внутри Nocturne.</p><div class="otp-import-options"><button data-action="otp-import-qr"><span>${icon('image')}</span><strong>QR из файла</strong><small>PNG, JPG или WebP</small></button><button data-action="otp-import-clipboard"><span>${icon('copy')}</span><strong>Из буфера</strong><small>QR-картинка или otpauth://</small></button><button data-action="otp-uri"><span>${icon('link')}</span><strong>Ссылка otpauth</strong><small>Вставить URI вручную</small></button><button data-action="otp-manual"><span>${icon('otp')}</span><strong>Ввести секрет</strong><small>Base32 и параметры</small></button></div>`);
}

function openOtpDialog(account = null) {
  openSimple(`<form id="otp-form"><input type="hidden" name="id" value="${escapeHtml(account?.id || '')}"><div class="dialog__header"><div><p class="eyebrow">TOTP</p><h2>${account ? 'Изменить аккаунт' : 'Ручное добавление'}</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><div class="form-grid"><label class="field"><span>Сервис</span><input name="issuer" maxlength="100" value="${escapeHtml(account?.issuer || '')}" placeholder="GitHub"></label><label class="field"><span>Аккаунт</span><input name="account" maxlength="180" required value="${escapeHtml(account?.account || '')}" placeholder="name@example.com"></label><label class="field field--full"><span>${account ? 'Новый секрет Base32' : 'Секрет Base32'}</span><input name="secret" autocomplete="off" spellcheck="false" ${account ? '' : 'required'} placeholder="${account ? 'Оставьте пустым, чтобы не менять' : 'JBSW Y3DP EHPK 3PXP'}"></label><label class="field"><span>Алгоритм</span><select name="algorithm">${['SHA1', 'SHA256', 'SHA512'].map((value) => `<option ${account?.algorithm === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label class="field"><span>Цифр</span><select name="digits">${[6, 8].map((value) => `<option value="${value}" ${Number(account?.digits || 6) === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label class="field field--full"><span>Период обновления</span><select name="period">${[30, 60].map((value) => `<option value="${value}" ${Number(account?.period || 30) === value ? 'selected' : ''}>${value} секунд</option>`).join('')}</select></label></div><p class="field-hint">Обычно используются SHA1, 6 цифр и 30 секунд. Меняйте параметры только если сервис указал другие.</p><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">${account ? 'Сохранить' : 'Добавить код'}</button></div></form>`);
}

function openOtpUriDialog() {
  openSimple(`<form id="otp-uri-form"><div class="dialog__header"><div><p class="eyebrow">TOTP</p><h2>Импортировать ссылку</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><label class="field"><span>Ссылка otpauth://</span><textarea name="uri" rows="5" required autocomplete="off" spellcheck="false" placeholder="otpauth://totp/Service:account?..."></textarea></label><p class="field-hint">Ссылка содержит секрет. Она не попадёт в историю буфера Nocturne.</p><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Импортировать</button></div></form>`);
}

function openQuickDialog() {
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">Быстрый доступ</p><h2>Способ разблокировки</h2></div><button class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">PIN и рисунок действуют только в текущем сеансе. После полного выхода потребуется мастер-пароль.</p><div class="dialog-choice-list"><button class="button button--ghost" data-action="quick-pin">PIN-код из 6–12 цифр</button><button class="button button--ghost" data-action="quick-pattern">Рисунок по точкам</button><button class="button button--ghost" data-action="quick-none">Только мастер-пароль</button></div>`);
}

function openPinDialog() {
  openSimple(`<form id="quick-pin-form"><div class="dialog__header"><div><p class="eyebrow">Быстрый доступ</p><h2>Настроить PIN</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><div class="auth-form"><label class="field"><span>Текущий мастер-пароль</span><input name="currentPassword" type="password" maxlength="256" autocomplete="off" required></label><label class="field"><span>Новый PIN-код</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6,12}" minlength="6" maxlength="12" data-pin-input required></label><label class="field"><span>Повторите PIN</span><input name="confirm" type="password" inputmode="numeric" pattern="[0-9]{6,12}" minlength="6" maxlength="12" data-pin-input required></label><button type="submit" class="button button--primary">Сохранить PIN</button></div></form>`);
}

function openPatternConfigDialog() {
  state.pattern = [];
  state.patternEnrollmentFirst = null;
  state.patternMasterPassword = '';
  openSimple(`<form id="pattern-reauth-form"><div class="dialog__header"><div><p class="eyebrow">Быстрый доступ</p><h2>Подтвердите доступ</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">Перед изменением способа входа введите текущий мастер-пароль.</p><div class="auth-form"><label class="field"><span>Текущий мастер-пароль</span><input name="currentPassword" type="password" maxlength="256" autocomplete="off" required autofocus></label><button type="submit" class="button button--primary">Продолжить</button></div></form>`);
}

function renderPatternEnrollment(stage) {
  state.pattern = [];
  simpleContent.innerHTML = `<div class="dialog__header"><div><p class="eyebrow">Графический ключ</p><h2>${stage === 'confirm' ? 'Повторите рисунок' : 'Создайте рисунок'}</h2></div><button class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">${stage === 'confirm' ? 'Проведите тот же рисунок ещё раз.' : 'Соедините не менее пяти точек. После отпускания мыши рисунок будет принят автоматически.'}</p>${patternMarkup(stage === 'confirm' ? 'enroll-confirm' : 'enroll-first')}<div class="pattern-feedback" data-pattern-message>${stage === 'confirm' ? 'Подтвердите графический ключ' : 'Проведите графический ключ'}</div>`;
}

function openDisableQuickDialog() {
  openSimple(`<form id="disable-quick-form"><div class="dialog__header"><div><p class="eyebrow">Быстрый доступ</p><h2>Отключить быстрый вход</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">Подтвердите действие текущим мастер-паролем.</p><div class="auth-form"><label class="field"><span>Текущий мастер-пароль</span><input name="currentPassword" type="password" maxlength="256" autocomplete="off" required autofocus></label><button type="submit" class="button button--primary">Отключить</button></div></form>`);
}

async function configureQuick(mode, credential, currentPassword) {
  const snapshot = await apiCall(window.nocturne.configureQuickUnlock(mode, credential, currentPassword));
  closeSimple();
  state.patternMasterPassword = '';
  state.patternEnrollmentFirst = null;
  updateSnapshot(snapshot);
  toast(mode === 'none' ? 'Быстрая разблокировка отключена' : 'Быстрая разблокировка настроена');
}

function openChangePasswordDialog() {
  openSimple(`<form id="change-password-form"><div class="dialog__header"><div><p class="eyebrow">Мастер-пароль</p><h2>Изменить пароль</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><div class="auth-form"><label class="field"><span>Текущий пароль</span><input name="currentPassword" type="password" maxlength="256" required autocomplete="current-password"></label><label class="field"><span>Новый пароль</span><input name="password" type="password" minlength="10" maxlength="256" required autocomplete="new-password"></label><label class="field"><span>Повторите новый пароль</span><input name="confirm" type="password" minlength="10" maxlength="256" required autocomplete="new-password"></label><button type="submit" class="button button--primary">Изменить</button></div></form>`);
}

async function saveSettings() {
  const next = { ...state.snapshot.settings };
  const value = (selector) => document.querySelector(selector);
  if (value('#setting-timeout')) next.autoLockMinutes = Number(value('#setting-timeout').value);
  if (value('#setting-minimize')) next.lockOnMinimize = value('#setting-minimize').checked;
  if (value('#setting-system')) next.lockOnSystemLock = value('#setting-system').checked;
  if (value('#setting-clipboard')) next.clipboardSeconds = Number(value('#setting-clipboard').value);
  if (value('#setting-wipe')) next.wipeEnabled = value('#setting-wipe').checked;
  if (value('#setting-wipe-threshold')) next.wipeThreshold = Number(value('#setting-wipe-threshold').value);
  if (next.wipeEnabled && !state.snapshot.settings.wipeEnabled) {
    state.pendingSettings = next;
    return confirmationDialog({ eyebrow: 'Опасная настройка', title: 'Включить автоматическое уничтожение?', text: `После ${next.wipeThreshold} неверных попыток локальный ключ и все файлы хранилища будут уничтожены.`, phrase: 'Я ПОНИМАЮ РИСК', action: 'enable-wipe', button: 'Включить', danger: true });
  }
  await persistSettings(false, next);
}

async function persistSettings(fromConfirmation, directSettings) {
  const settings = fromConfirmation ? state.pendingSettings : directSettings;
  state.pendingSettings = null;
  const snapshot = await apiCall(window.nocturne.saveSettings(settings));
  updateSnapshot(snapshot);
  toast('Настройки сохранены');
}

function openMedia(id) {
  const item = findMedia(id);
  if (!item) return;
  state.viewerMediaId = id;
  const sequence = mediaSequence(id);
  const index = sequence.findIndex((candidate) => candidate.id === id);
  const preview = item.type.startsWith('image/') ? `<img src="${item.url}" alt="${escapeHtml(item.name)}">` : item.type.startsWith('video/') ? `<video src="${item.url}" controls autoplay></video>` : `<div class="audio-player"><div class="audio-player__mark">${icon('audio')}</div><strong>${escapeHtml(item.name)}</strong><audio src="${item.url}" controls autoplay></audio></div>`;
  mediaContent.innerHTML = `<div class="media-preview"><div class="media-preview__stage">${preview}</div>${sequence.length > 1 ? `<button class="media-nav media-nav--previous" data-media-step="-1" aria-label="Предыдущий файл" ${index <= 0 ? 'disabled' : ''}>‹</button><button class="media-nav media-nav--next" data-media-step="1" aria-label="Следующий файл" ${index >= sequence.length - 1 ? 'disabled' : ''}>›</button>` : ''}<div class="media-counter">${index + 1} / ${sequence.length}</div></div><div class="media-actionbar"><div class="media-actionbar__name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div><div class="media-actionbar__buttons">${item.type.startsWith('image/') ? `<button class="button button--ghost button--compact" data-copy-media="${id}">${icon('copy')} Копировать</button>` : ''}<button class="button button--ghost button--compact" data-save-media="${id}">${icon('upload')} Сохранить на ПК</button><button class="button button--ghost button--compact" data-rename-media="${id}">${icon('edit')} Переименовать</button><button class="button button--danger button--compact" data-delete-media="${id}">${icon('trash')} Удалить</button></div></div>`;
  if (!mediaDialog.open) mediaDialog.showModal();
}

function mediaSequence(id) {
  const library = state.snapshot?.media || [];
  if (library.some((item) => item.id === id)) {
    const filtered = state.mediaFilter === 'all' ? library : library.filter((item) => item.type.startsWith(`${state.mediaFilter}/`));
    return filtered.some((item) => item.id === id) ? filtered : library;
  }
  const note = state.snapshot?.notes?.find((candidate) => candidate.attachments?.some((item) => item.id === id));
  return note?.attachments || [findMedia(id)].filter(Boolean);
}

function stepMedia(direction) {
  if (!state.viewerMediaId) return;
  const sequence = mediaSequence(state.viewerMediaId);
  const index = sequence.findIndex((item) => item.id === state.viewerMediaId);
  const next = sequence[index + direction];
  if (next) openMedia(next.id);
}

async function openDocumentPreview(id) {
  const preview = await apiCall(window.nocturne.previewDocument(id));
  mediaContent.innerHTML = `<div class="document-preview"><header>${escapeHtml(preview.name)}</header><pre>${escapeHtml(preview.text)}</pre></div><div class="media-actionbar"><div class="media-actionbar__name">Просмотр внутри Nocturne</div><div class="media-actionbar__buttons"><button class="button button--ghost button--compact" data-save-media="${id}">${icon('upload')} Сохранить на ПК</button></div></div>`;
  mediaDialog.showModal();
}

function renderWiped() {
  clearSensitiveOverlays();
  state.exists = false;
  state.unlocked = false;
  state.snapshot = null;
  state.lastSettings = null;
  state.quickUnlockAvailable = false;
  appRoot.innerHTML = `<div class="wipe-screen"><div><div class="wipe-screen__icon">${icon('trash')}</div><p class="eyebrow">Операция завершена</p><h1>Хранилище уничтожено</h1><p>Локальный ключ удалён, контейнер и защищённые медиафайлы очищены. Для продолжения можно создать новое пустое хранилище.</p><button class="button button--secondary" data-action="start-over">Создать новое</button></div></div>`;
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="start-over"]')) renderOnboarding();
});

window.nocturne.onLocked(({ quickUnlockAvailable }) => {
  state.quickUnlockAvailable = quickUnlockAvailable;
  renderLockScreen();
});
window.nocturne.onWiped(renderWiped);

async function bootstrap() {
  try {
    const data = await apiCall(window.nocturne.bootstrap());
    state.version = data.version || state.version;
    state.exists = data.exists;
    state.quickUnlockAvailable = data.quickUnlockAvailable;
    if (!data.exists) renderOnboarding();
    else if (data.unlocked && data.snapshot) updateSnapshot(data.snapshot);
    else renderLockScreen();
  } catch {
    appRoot.innerHTML = '<div class="wipe-screen"><div><h1>Не удалось запустить приложение</h1><p>Проверьте права доступа к локальной папке приложения.</p></div></div>';
  }
}

bootstrap();
