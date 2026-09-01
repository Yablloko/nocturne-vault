const appRoot = document.querySelector('#app');
const entryDialog = document.querySelector('#entry-dialog');
const entryForm = document.querySelector('#entry-form');
const simpleDialog = document.querySelector('#simple-dialog');
const simpleContent = document.querySelector('#simple-dialog-content');
const mediaDialog = document.querySelector('#media-dialog');
const mediaContent = document.querySelector('#media-dialog-content');
const noteDialog = document.querySelector('#note-dialog');
const noteForm = document.querySelector('#note-form');
const ORGANIZER_SECTIONS = new Set(['passwords', 'notes', 'media', 'documents', 'otp']);
const FILE_IMPORT_SECTIONS = new Set(['media', 'documents']);

const state = {
  version: '0.8.13',
  exists: false,
  unlocked: false,
  snapshot: null,
  lastSettings: null,
  quickUnlockAvailable: false,
  quickUnlockMode: 'password',
  page: 'passwords',
  query: '',
  organizer: {
    passwords: { folderId: '', tag: '', favorites: false },
    notes: { folderId: '', tag: '', favorites: false },
    media: { folderId: '', tag: '', favorites: false },
    documents: { folderId: '', tag: '', favorites: false },
    otp: { folderId: '', tag: '', favorites: false },
  },
  selectedItems: {
    passwords: new Set(), notes: new Set(), media: new Set(), documents: new Set(), otp: new Set(),
  },
  selectedFolderItems: {
    passwords: new Set(), notes: new Set(), media: new Set(), documents: new Set(), otp: new Set(),
  },
  selectedFolders: new Set(),
  folderManagerSection: 'passwords',
  selectedEntryId: null,
  selectedNoteId: null,
  selectedDocumentId: null,
  launchAtStartup: false,
  mediaFilter: 'all',
  settingsSection: 'security',
  helpTopic: 'passwords',
  pattern: [],
  patternDrawing: false,
  patternPointerId: null,
  patternEnrollmentFirst: null,
  patternMasterPassword: '',
  patternContext: null,
  viewerMediaId: null,
  recorder: null,
  recorderStream: null,
  recorderChunks: [],
  recordingStartedAt: 0,
  recordingTimer: null,
  otpCodes: {},
  recoveryKey: null,
  recoverySaved: false,
  busy: false,
  pendingExternalImports: 0,
  consumingExternalImports: false,
  explorerClickTimer: null,
  marquee: null,
  internalDrag: null,
  locale: 'ru',
  theme: 'light',
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
  microphone: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
  otp: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M12 3V1M21 12h2M12 21v2M3 12H1"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',
  tag: '<path d="M20 13 13 20l-9-9V4h7Z"/><circle cx="8" cy="8" r="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  camera: '<path d="M5 7h3l2-2h4l2 2h3a2 2 0 0 1 2 2v9H3V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.lock}</svg>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

const EN_TEXT = new Map(Object.entries({
  'Мастер-пароль': 'Master password', 'Ключ восстановления': 'Recovery key', 'Готово': 'Ready',
  'Создание хранилища': 'Create your vault', 'Задайте мастер-пароль. После создания приложение один раз покажет ключ восстановления.': 'Choose a master password. The recovery key will be shown once after the vault is created.',
  'Не менее 14 символов': 'At least 14 characters', 'Повторите пароль': 'Repeat password', 'Продолжить': 'Continue',
  'Лучше использовать длинную фразу, которой нет в других сервисах.': 'Use a long phrase that you do not use anywhere else.',
  'Импортировать хранилище': 'Import a vault', 'Первый запуск': 'First launch',
  'Хранилище заблокировано': 'Vault locked', 'Введите данные для доступа.': 'Enter your credentials to continue.', 'Открыть хранилище': 'Unlock vault',
  'Войти с ключом восстановления': 'Use recovery key', 'Пароли': 'Passwords', 'Заметки': 'Notes', 'Медиатека': 'Media', 'Документы': 'Documents',
  'Коды доступа': 'Access codes', 'Корзина': 'Trash', 'Настройки': 'Settings', 'Заблокировать': 'Lock', 'Поиск': 'Search',
  'Новая запись': 'New entry', 'Новая заметка': 'New note', 'Новый текст': 'New text', 'Добавить документы': 'Add documents',
  'Импортировать': 'Import', 'Снимок области': 'Capture area', 'Записать': 'Record', 'Избранное': 'Favorites', 'Новая папка': 'New folder',
  'Все теги': 'All tags', 'В избранное': 'Add to favorites', 'Удалить': 'Delete', 'Переместить': 'Move', 'Корень раздела': 'Section root',
  'Пусто': 'Empty', 'Открыть': 'Open', 'Переименовать': 'Rename', 'Создать папку': 'Create folder', 'Создать папку внутри': 'Create subfolder',
  'Удалить с содержимым': 'Delete with contents', 'Убрать из избранного': 'Remove from favorites', 'Добавить в избранное': 'Add to favorites',
  'Переместить и добавить теги': 'Move and add tags', 'Переместить в корзину': 'Move to trash', 'Отмена': 'Cancel', 'Сохранить': 'Save',
  'Название': 'Name', 'Название папки': 'Folder name', 'Теги': 'Tags', 'Логин': 'Username', 'Пароль': 'Password', 'Сайт': 'Website', 'Заметка': 'Note',
  'Блокировка': 'Locking', 'Доступ': 'Access', 'Защита экрана': 'Screen protection', 'Windows': 'Windows', 'Данные': 'Data', 'Уничтожение': 'Destruction', 'Справка': 'Help',
  'Безопасность': 'Security', 'Приложение': 'Application', 'Вход и защита': 'Access and protection', 'Windows и оформление': 'Windows and appearance', 'Копии и удаление': 'Backups and deletion',
  'Блокировка, способы входа и защита содержимого.': 'Locking, sign-in methods, and content protection.', 'Запуск вместе с Windows, язык и внешний вид.': 'Windows startup, language, and appearance.', 'Резервные копии, корзина и окончательное удаление.': 'Backups, trash, and permanent deletion.',
  'Тема и язык': 'Theme and language', 'Оформление': 'Appearance', 'Язык': 'Language', 'Тема': 'Theme', 'Светлая': 'Light', 'Тёмная': 'Dark', 'Системная': 'System',
  'Русский': 'Russian', 'Английский': 'English', 'Применить': 'Apply', 'Резервная копия': 'Backup', 'Экспорт': 'Export', 'Импорт': 'Import',
  'Экспорт хранилища': 'Export vault', 'Импорт хранилища': 'Import vault', 'Текущий мастер-пароль': 'Current master password',
  'Мастер-пароль резервной копии': 'Backup master password', 'Выбрать файл и импортировать': 'Choose file and import', 'Создать резервную копию': 'Create backup',
  'Автозапуск': 'Launch at startup', 'Хранение удалённого': 'Trash retention', 'Сохранить настройки': 'Save settings',
  'Как всё работает': 'How everything works', 'Таймер и буфер': 'Timer and clipboard', 'Пароль и вход': 'Password and sign-in', 'Захват и фокус': 'Capture and focus',
  'Автозапуск и корзина': 'Startup and trash', 'Очистка данных': 'Data cleanup', 'Резервные копии': 'Backups', 'Внешний вид': 'Appearance',
  'Фото': 'Photos', 'Видео': 'Videos', 'Аудио': 'Audio', 'Все': 'All', 'Файл': 'File', 'Размер': 'Size', 'Смотреть': 'View', 'Организовать': 'Organize',
  'Сохранить на ПК': 'Save to PC', 'В корзину': 'Move to trash', 'Одноразовые коды': 'One-time codes', 'Добавить код': 'Add code',
  'Скопировать': 'Copy', 'Изменить': 'Edit', 'Закрыть': 'Close', 'Свернуть': 'Minimize', 'Развернуть': 'Maximize'
  , 'Безопасность и блокировка': 'Security and locking', 'Конфиденциальность': 'Privacy', 'Помощь': 'Help',
  'Когда хранилище должно закрываться и очищать временные данные.': 'Choose when the vault locks and temporary data is cleared.',
  'Мастер-пароль и быстрый способ входа в текущем сеансе.': 'Master password and quick sign-in for the current session.',
  'Захват окна и скрытие при переключении.': 'Window capture protection and concealment when switching apps.',
  'Запуск приложения и жизненный цикл фонового процесса.': 'Application startup and background operation.',
  'Резервная копия содержит всё хранилище и защищена его мастер-паролем.': 'A backup contains the entire vault and is protected by its master password.',
  'Тема и язык интерфейса применяются до разблокировки хранилища.': 'Theme and interface language apply before the vault is unlocked.',
  'Выберите удобный вид приложения.': 'Choose how the application looks.', 'Язык кнопок, подсказок и справки': 'Language for buttons, hints, and help',
  'Светлая, тёмная или как в Windows': 'Light, dark, or match Windows', 'Оформление обновлено': 'Appearance updated',
  'Необратимые сценарии удаления ключа и локального контейнера.': 'Irreversible removal of the key and local vault.',
  'Как пользоваться Nocturne — коротко и по шагам.': 'Short step-by-step guidance for Nocturne.',
  'Папки и теги': 'Folders and tags', 'Порядок в хранилище': 'Organizing your vault', 'Сохранение и копирование': 'Saving and copying',
  'Текст, фото и голос': 'Text, photos, and voice', 'Файлы': 'Files', 'Фото, видео и документы': 'Photos, videos, and documents',
  'Просмотр и свой текст': 'Viewing and writing', 'Пароль, PIN и рисунок': 'Password, PIN, and pattern', 'Удаление и восстановление': 'Deleting and restoring', 'Что проверить': 'Things to check',
  'Кнопка «Папки» есть в каждом разделе. Там можно создать папку внутри другой папки, переименовать её или выбрать несколько папок для удаления.': 'Every section has a Folders button. You can create nested folders, rename them, or select several folders for deletion.',
  'Теги объединяют записи по теме, а звёздочка добавляет их в избранное. Круглая кнопка на карточке включает выбор нескольких записей.': 'Tags group related entries, and the star adds them to favorites. The round button on a card enables multiple selection.'
}));

const RU_TEXT = new Map([...EN_TEXT].map(([russian, english]) => [english, russian]));

function resolvedTheme() {
  if (state.theme !== 'system') return state.theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyUiPreferences(root = document) {
  document.documentElement.lang = state.locale;
  document.body.dataset.theme = resolvedTheme();
  document.title = state.locale === 'en' ? 'Nocturne Vault' : 'Nocturne Vault';
  const translations = state.locale === 'en' ? EN_TEXT : RU_TEXT;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue;
    const trimmed = raw.trim();
    const translated = translations.get(trimmed);
    if (translated) node.nodeValue = raw.replace(trimmed, translated);
  }
  root.querySelectorAll?.('[placeholder], [aria-label], [title]').forEach((element) => {
    for (const attribute of ['placeholder', 'aria-label', 'title']) {
      const value = element.getAttribute(attribute);
      if (translations.has(value)) element.setAttribute(attribute, translations.get(value));
    }
  });
}

const localizationObserver = new MutationObserver((records) => {
  if (state.locale !== 'en') return;
  for (const record of records) for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) applyUiPreferences(node);
});
localizationObserver.observe(document.body, { childList: true, subtree: true });

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

function sectionItems(section) {
  if (!state.snapshot) return [];
  return ({ passwords: state.snapshot.entries, notes: state.snapshot.notes, media: state.snapshot.media, documents: state.snapshot.documents, otp: state.snapshot.otp })[section] || [];
}

function sectionFolders(section) {
  return (state.snapshot?.folders || []).filter((folder) => (folder.section || 'passwords') === section);
}

function activeFolderId(section) {
  const value = state.organizer[section]?.folderId;
  return value || null;
}

function folderDescendants(section, id) {
  const folders = sectionFolders(section);
  const result = new Set(id ? [id] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

function folderDepth(section, folder) {
  const folders = sectionFolders(section);
  let current = folder;
  let depth = 0;
  const visited = new Set();
  while (current?.parentId && depth < 8 && !visited.has(current.id)) {
    visited.add(current.id);
    current = folders.find((candidate) => candidate.id === current.parentId);
    depth += 1;
  }
  return depth;
}

function folderName(section, id) {
  const folder = sectionFolders(section).find((candidate) => candidate.id === id);
  if (!folder) return 'Корень';
  const parent = folder.parentId ? sectionFolders(section).find((candidate) => candidate.id === folder.parentId) : null;
  return parent ? `${parent.name} / ${folder.name}` : folder.name;
}

function organizerItems(section) {
  const filter = state.organizer[section];
  const folderId = filter.folderId || '';
  return sectionItems(section).filter((item) => {
    if (!filter.favorites && (item.folderId || '') !== folderId) return false;
    if (filter.tag && !(item.tags || []).some((tag) => tag.toLocaleLowerCase('ru-RU') === filter.tag.toLocaleLowerCase('ru-RU'))) return false;
    if (filter.favorites && !item.favorite) return false;
    return true;
  });
}

function selectionActions(section) {
  const selectedItems = state.selectedItems[section];
  const selectedFolderCount = state.selectedFolderItems[section].size;
  const selectedCount = selectedItems.size + selectedFolderCount;
  if (!selectedCount) return '';
  return `<div class="batch-actions"><strong>${selectedCount}</strong><button class="button button--ghost button--compact" data-bulk-edit="${section}">Переместить</button><button class="button button--ghost button--compact" data-bulk-favorite-mixed="${section}">${icon('star')} В избранное</button><button class="button button--danger button--compact" data-bulk-delete-mixed="${section}">${icon('trash')} Удалить</button><button class="icon-button" data-clear-mixed="${section}" aria-label="Снять выделение">×</button></div>`;
}

function organizerBar(section) {
  const tags = [...new Set(sectionItems(section).flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b, 'ru'));
  const filter = state.organizer[section];
  return `<div class="organizer-bar" data-organizer-section="${section}">
    <select data-organizer-tag="${section}" aria-label="Тег"><option value="">Все теги</option>${tags.map((tag) => `<option value="${escapeHtml(tag)}" ${filter.tag === tag ? 'selected' : ''}>${escapeHtml(tag)}</option>`).join('')}</select>
    <button class="button button--ghost button--compact ${filter.favorites ? 'is-active' : ''}" data-organizer-favorites="${section}">${icon('star')} Избранное</button>
    <button class="button button--ghost button--compact" data-manage-folders="${section}">${icon('plus')} Новая папка</button>
    <div class="organizer-selection" data-organizer-selection="${section}">${selectionActions(section)}</div>
  </div>`;
}

function currentFolder(section) {
  return sectionFolders(section).find((folder) => folder.id === state.organizer[section].folderId) || null;
}

function folderBreadcrumbs(section) {
  const folders = sectionFolders(section);
  const chain = [];
  let cursor = currentFolder(section);
  const visited = new Set();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.unshift(cursor);
    cursor = folders.find((folder) => folder.id === cursor.parentId) || null;
  }
  return `<nav class="folder-breadcrumbs" aria-label="Путь к папке"><button data-open-folder="${section}:">${icon('home')} ${escapeHtml(organizerTitle(section))}</button>${chain.map((folder) => `<span>›</span><button data-open-folder="${section}:${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</button>`).join('')}</nav>`;
}

function visibleFolders(section) {
  const filter = state.organizer[section];
  if (filter.favorites) return sectionFolders(section).filter((folder) => folder.favorite);
  return sectionFolders(section).filter((folder) => (folder.parentId || '') === (filter.folderId || ''));
}

function folderTile(section, folder, modifier = '') {
  const selected = state.selectedFolderItems[section].has(folder.id);
  const directItems = sectionItems(section).filter((item) => item.folderId === folder.id).length;
  const childFolders = sectionFolders(section).filter((candidate) => candidate.parentId === folder.id).length;
  const summary = [childFolders ? `${childFolders} пап.` : '', directItems ? `${directItems} элем.` : ''].filter(Boolean).join(' · ') || 'Пусто';
  return `<article class="folder-tile ${modifier} ${selected ? 'is-selected' : ''}" data-explorer-folder="${section}:${escapeHtml(folder.id)}" tabindex="0" draggable="true" aria-label="Папка ${escapeHtml(folder.name)}">
    <span class="folder-tile__icon">${icon('folder')}</span><span class="folder-tile__copy"><strong>${escapeHtml(folder.name)}</strong><small>${summary}</small></span>${folder.favorite ? `<span class="folder-tile__favorite">${icon('star')}</span>` : ''}
  </article>`;
}

function folderListRow(section, folder, variant) {
  const selected = state.selectedFolderItems[section].has(folder.id);
  const directItems = sectionItems(section).filter((item) => item.folderId === folder.id).length;
  const childFolders = sectionFolders(section).filter((candidate) => candidate.parentId === folder.id).length;
  const summary = [childFolders ? `${childFolders} пап.` : '', directItems ? `${directItems} элем.` : ''].filter(Boolean).join(' · ') || 'Пусто';
  const favorite = folder.favorite ? `<span class="folder-list-row__favorite">${icon('star')}</span>` : '<span></span>';
  if (variant === 'documents') {
    return `<div class="document-row folder-list-row ${selected ? 'is-selected' : ''}" data-explorer-folder="${section}:${escapeHtml(folder.id)}" role="button" tabindex="0" draggable="true"><span class="folder-list-row__select"></span><span class="document-row__type folder-list-row__icon">${icon('folder')}</span><span class="document-row__name"><strong>${escapeHtml(folder.name)}</strong><small>${summary}</small></span><em>Папка</em>${favorite}</div>`;
  }
  return `<div class="note-row folder-list-row ${selected ? 'is-selected' : ''}" data-explorer-folder="${section}:${escapeHtml(folder.id)}" role="button" tabindex="0" draggable="true"><span class="folder-list-row__icon">${icon('folder')}</span><div><strong>${escapeHtml(folder.name)}</strong><small>${summary}</small></div>${favorite}</div>`;
}

function folderShelf(section) {
  const folders = visibleFolders(section);
  const filter = state.organizer[section];
  return `<section class="folder-shelf" data-explorer-surface="${section}">
    <header>${filter.favorites ? `<div class="folder-breadcrumbs"><strong>${icon('star')} Избранное</strong></div>` : folderBreadcrumbs(section)}<span>${folders.length ? `${folders.length} пап.` : 'ПКМ — создать папку'}</span></header>
    ${folders.length ? `<div class="folder-grid">${folders.map((folder) => folderTile(section, folder)).join('')}</div>` : ''}
  </section>`;
}

function itemSelectButton(section, item) {
  const selected = state.selectedItems[section].has(item.id);
  return `<button class="item-select ${selected ? 'is-selected' : ''}" data-toggle-item="${section}:${item.id}" aria-label="${selected ? 'Снять выделение' : 'Выбрать'}">${selected ? icon('check') : ''}</button>`;
}

function favoriteButton(section, item) {
  return `<button class="favorite-button ${item.favorite ? 'is-favorite' : ''}" data-toggle-favorite="${section}:${item.id}" aria-label="${item.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}">${icon('star')}</button>`;
}

function tagChips(item) {
  return (item.tags || []).length ? `<div class="tag-chips">${item.tags.slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : '';
}

async function apiCall(promise) {
  const response = await promise;
  if (!response?.ok) throw new Error(response?.error || 'UNKNOWN_ERROR');
  return response.data;
}

function friendlyError(code) {
  return ({
    WEAK_MASTER_PASSWORD: 'Используйте уникальную фразу не короче 14 символов — распространённые и повторяющиеся пароли не принимаются.',
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
    FOLDER_ALREADY_EXISTS: 'Папка с таким названием уже есть.',
    FOLDER_NOT_FOUND: 'Папка не найдена.',
    FOLDER_CYCLE: 'Нельзя переместить папку внутрь неё самой или одной из её вложенных папок.',
    ITEM_NOT_FOUND: 'Элемент не найден.',
    INVALID_ORGANIZER_SECTION: 'Неизвестный раздел.',
    SCREEN_CAPTURE_CANCELLED: 'Захват области отменён.',
    INVALID_MEDIA_NAME: 'Введите допустимое название файла.',
    MEDIA_COPY_UNSUPPORTED: 'В буфер можно скопировать только изображение.',
    MEDIA_TOO_LARGE_FOR_MEMORY: 'Этот файл слишком большой для копирования в буфер. Его можно просмотреть или сохранить на компьютер.',
    CLIPBOARD_IMAGE_TOO_LARGE: 'Изображение из буфера слишком большое для безопасной обработки.',
    DOCUMENT_PREVIEW_UNSUPPORTED: 'Этот формат нельзя безопасно показать внутри Nocturne. Его можно только явно сохранить на компьютер.',
    DOCUMENT_PREVIEW_TOO_LARGE: 'Документ слишком большой для внутреннего просмотра.',
    DOCUMENT_PREVIEW_INVALID: 'Не удалось безопасно прочитать структуру документа.',
    DOCUMENT_ARCHIVE_UNSAFE: 'Документ содержит слишком большой или подозрительный архив.',
    DOCUMENT_EDIT_UNSUPPORTED: 'Этот формат доступен только для чтения.',
    DOCUMENT_TOO_LARGE_TO_EDIT: 'Текстовый документ слишком большой для внутреннего редактора.',
    DOCUMENT_VERSION_NOT_FOUND: 'Версия документа больше недоступна.',
    INVALID_RECORDED_AUDIO: 'Запись пуста, слишком велика или имеет неподдерживаемый формат.',
    TRASH_ITEM_NOT_FOUND: 'Элемент уже удалён из корзины.',
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
    INVALID_BACKUP: 'Это не резервная копия Nocturne.',
    BACKUP_TRUNCATED: 'Файл резервной копии повреждён или загружен не полностью.',
    BACKUP_TRAILING_DATA: 'Структура резервной копии повреждена.',
    BACKUP_FILE_SET_MISMATCH: 'В резервной копии отсутствуют необходимые зашифрованные файлы.',
    WRONG_BACKUP_PASSWORD: 'Неверный мастер-пароль резервной копии.',
    UNSUPPORTED_BACKUP_VERSION: 'Эта версия резервной копии пока не поддерживается.',
    BACKUP_TOO_MANY_FILES: 'В резервной копии слишком много файлов.',
    BACKUP_BLOB_INVALID: 'Один из файлов резервной копии повреждён.',
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
    <header class="auth-header"><div class="auth-brand"><b>N</b><span>Nocturne Vault</span></div><div class="auth-locale" aria-label="Язык"><button class="${state.locale === 'ru' ? 'is-active' : ''}" data-set-locale="ru">RU</button><button class="${state.locale === 'en' ? 'is-active' : ''}" data-set-locale="en">EN</button></div></header>
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
        <label class="field"><span>Мастер-пароль</span><div class="password-reveal"><input name="password" type="password" minlength="14" maxlength="256" autocomplete="new-password" required placeholder="Не менее 14 символов"><button type="button" data-toggle-password="password" aria-label="Показать пароль">${icon('eye')}</button></div><div class="password-meter"><span></span></div></label>
        <label class="field"><span>Повторите пароль</span><div class="password-reveal"><input name="confirm" type="password" minlength="14" maxlength="256" autocomplete="new-password" required><button type="button" data-toggle-password="confirm" aria-label="Показать пароль">${icon('eye')}</button></div></label>
        <p class="field-hint">Лучше использовать длинную фразу, которой нет в других сервисах.</p>
        <button class="button button--primary" type="submit" data-busy-button>Продолжить</button>
        <button class="button button--ghost" type="button" data-action="onboarding-import">Импортировать хранилище</button>
      </form>
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
  const quickMode = state.quickUnlockAvailable ? state.quickUnlockMode : 'none';
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
  `, '', 'locked');
}

function clearSensitiveOverlays() {
  clearInterval(state.recordingTimer);
  if (state.recorder) {
    state.recorder.ondataavailable = null;
    if (state.recorder.state !== 'inactive') state.recorder.stop();
  }
  state.recorderStream?.getTracks().forEach((track) => track.stop());
  state.recorder = null;
  state.recorderStream = null;
  state.recorderChunks = [];
  state.recordingTimer = null;
  state.recordingStartedAt = 0;
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
      <p class="muted auth-description">Введите ключ в формате NV1.</p>
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
    trash: ['Корзина', `${state.snapshot.trash.length} элементов`],
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
        ${navButton('trash', 'Корзина', 'trash', snapshot.trash.length)}
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
          ${state.page === 'media' ? `<button class="button button--ghost button--compact" data-action="capture-region">${icon('camera')} Снимок области</button><button class="button button--ghost button--compact" data-action="record-audio">${icon('microphone')} Записать</button><button class="button button--primary button--compact" data-action="import-media">${icon('upload')} Импортировать</button>` : ''}
          ${state.page === 'documents' ? `<button class="button button--ghost button--compact" data-action="new-text-document">${icon('plus')} Новый текст</button><button class="button button--primary button--compact" data-action="import-documents">${icon('upload')} Добавить документы</button>` : ''}
          ${state.page === 'trash' && snapshot.trash.length ? `<button class="button button--danger button--compact" data-action="empty-trash">Очистить корзину</button>` : ''}
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
  if (state.page === 'trash') return renderTrashPage();
  if (state.page === 'settings') return renderSettingsPage();
  return renderPasswordsPage();
}

function renderPasswordsPage() {
  const query = state.query.trim().toLocaleLowerCase('ru');
  const source = query ? sectionItems('passwords') : organizerItems('passwords');
  const entries = source.filter((entry) => !query || [entry.title, entry.username, entry.url, ...(entry.tags || [])].some((value) => String(value || '').toLocaleLowerCase('ru').includes(query)));
  const selected = entries.find((entry) => entry.id === state.selectedEntryId) || entries[0] || null;
  if (selected && state.selectedEntryId !== selected.id) state.selectedEntryId = selected.id;
  const showContent = entries.length || !visibleFolders('passwords').length;
  return `<div class="organized-page" data-explorer-root="passwords">${organizerBar('passwords')}${folderShelf('passwords')}${showContent ? `<div class="vault-browser vault-browser--passwords" data-explorer-surface="passwords">
    <section class="record-list-pane">
      <div class="record-index-head"><span>${state.organizer.passwords.favorites ? 'Избранные записи' : folderName('passwords', state.organizer.passwords.folderId)}</span><em>${entries.length}</em></div>
      <div class="record-list">
        ${entries.length ? entries.map((entry) => renderRecordRow(entry, selected?.id === entry.id)).join('') : `<div class="plain-empty"><strong>${query ? 'Совпадений нет' : 'Хранилище пусто'}</strong><span>${query ? 'Измените запрос.' : 'Нажмите «Новая запись», чтобы добавить первые данные.'}</span></div>`}
      </div>
    </section>
    <aside class="record-inspector">${selected ? renderEntryInspector(selected) : `<div class="inspector-empty"><span>—</span><p>Выберите запись</p></div>`}</aside>
  </div>` : ''}</div>`;
}

function renderRecordRow(entry, selected) {
  return `<div class="record-row ${selected ? 'is-selected' : ''}" data-explorer-item="passwords:${entry.id}" role="button" tabindex="0" draggable="true">
    ${itemSelectButton('passwords', entry)}<span class="record-row__mark">${escapeHtml(entry.title.charAt(0) || '?')}</span><div><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.username || 'Без логина')}</span>${tagChips(entry)}</div><em>${escapeHtml(folderName('passwords', entry.folderId))}</em>${favoriteButton('passwords', entry)}
  </div>`;
}

function renderEntryInspector(entry) {
  return `<div class="inspector-head"><div><span>Учётная запись · ${escapeHtml(folderName('passwords', entry.folderId))}</span><h2>${escapeHtml(entry.title)}</h2><p>Изменено ${formatDate(entry.updatedAt)}</p>${tagChips(entry)}</div><span class="inspector-monogram">${escapeHtml(entry.title.charAt(0) || '?')}</span></div>
    <div class="inspector-fields">
      <div class="inspector-field"><label>Логин</label><div><span>${escapeHtml(entry.username || 'Не указан')}</span>${entry.username ? `<button class="icon-button" data-copy-username="${entry.id}" aria-label="Скопировать логин">${icon('copy')}</button>` : ''}</div></div>
      <div class="inspector-field"><label>Пароль</label><div><span class="masked-value">••••••••••••</span><button class="icon-button" data-copy-entry="${entry.id}" aria-label="Скопировать пароль">${icon('copy')}</button></div></div>
      ${entry.url ? `<div class="inspector-field"><label>Адрес</label><div><span>${escapeHtml(entry.url)}</span><button class="icon-button" data-copy-url="${entry.id}" aria-label="Скопировать адрес">${icon('copy')}</button></div></div>` : ''}
      ${entry.notes ? `<div class="inspector-field inspector-field--notes"><label>Заметка</label><p>${escapeHtml(entry.notes)}</p></div>` : ''}
    </div>
    <div class="inspector-actions"><button class="button button--ghost button--compact" data-edit-entry="${entry.id}">${icon('edit')} Изменить</button><button class="icon-button icon-button--danger" data-delete-entry="${entry.id}" aria-label="Удалить">${icon('trash')}</button></div>`;
}

function renderMediaPage() {
  const media = organizerItems('media');
  const matches = (item) => state.mediaFilter === 'all' || item.type.startsWith(`${state.mediaFilter}/`);
  const visible = media.filter(matches);
  const folders = visibleFolders('media');
  const filters = [['all', 'Все'], ['image', 'Фото'], ['video', 'Видео'], ['audio', 'Аудио']];
  const count = [folders.length ? `${folders.length} пап.` : '', visible.length ? `${visible.length} файл.` : ''].filter(Boolean).join(' · ') || 'Пусто';
  return `<div class="organized-page" data-explorer-root="media">${organizerBar('media')}<div class="media-workspace" data-explorer-surface="media"><div class="media-filter" role="tablist">${filters.map(([id, label]) => `<button class="${state.mediaFilter === id ? 'is-active' : ''}" data-media-filter="${id}">${label}<span>${id === 'all' ? media.length : media.filter((item) => item.type.startsWith(`${id}/`)).length}</span></button>`).join('')}</div><header class="media-explorer-head">${state.organizer.media.favorites ? `<div class="folder-breadcrumbs"><strong>${icon('star')} Избранное</strong></div>` : folderBreadcrumbs('media')}<span>${count}</span></header>${folders.length || visible.length ? `<div class="media-grid media-grid--mixed">${folders.map((folder) => folderTile('media', folder, 'folder-tile--media')).join('')}${visible.map((item) => `<article class="media-card ${item.type.startsWith('audio/') ? 'media-card--audio' : ''} ${state.selectedItems.media.has(item.id) ? 'is-selected' : ''}" data-explorer-item="media:${item.id}" tabindex="0" draggable="true">
      <div class="item-card-actions">${itemSelectButton('media', item)}${favoriteButton('media', item)}</div>
      ${item.type.startsWith('image/') ? `<img src="${item.url}" alt="" draggable="true">` : item.type.startsWith('video/') ? `<video src="${item.url}" muted preload="metadata" draggable="true"></video>` : `<div class="audio-cover">${icon('audio')}<span>${escapeHtml(documentExtension(item.name))}</span></div>`}
      <div class="media-card__meta"><strong>${escapeHtml(item.name)}</strong><span>${formatBytes(item.size)} · ${escapeHtml(folderName('media', item.folderId))}</span>${tagChips(item)}</div>
    </article>`).join('')}</div>` : `<div class="plain-empty plain-empty--center"><strong>${media.length ? 'В этом разделе пусто' : 'Нет файлов'}</strong><span>Добавьте файлы перетаскиванием или кнопкой импорта.</span><button class="button button--ghost button--compact" data-action="import-media">Импортировать</button></div>`}</div></div>`;
}

function documentExtension(name) {
  const match = String(name || '').match(/\.([^.]+)$/);
  return match ? match[1].slice(0, 5).toUpperCase() : 'FILE';
}

function documentCanPreview(type) {
  return ['text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/rtf'].includes(type)
    || type.includes('openxmlformats-officedocument')
    || type.includes('opendocument');
}

function renderDocumentsPage() {
  const documents = organizerItems('documents');
  const folders = visibleFolders('documents');
  const selected = documents.find((item) => item.id === state.selectedDocumentId) || documents[0] || null;
  if (selected && state.selectedDocumentId !== selected.id) state.selectedDocumentId = selected.id;
  const foldersOnly = folders.length && !documents.length;
  return `<div class="organized-page" data-explorer-root="documents">${organizerBar('documents')}<div class="document-workspace ${foldersOnly ? 'explorer-folders-only' : ''}" data-explorer-surface="documents"><section class="document-index"><header class="explorer-list-path">${state.organizer.documents.favorites ? `<div class="folder-breadcrumbs"><strong>${icon('star')} Избранное</strong></div>` : folderBreadcrumbs('documents')}<span>${folders.length ? `${folders.length} пап.` : ''}</span></header><div class="document-list">${folders.map((folder) => folderListRow('documents', folder, 'documents')).join('')}${documents.length ? documents.map((item) => `<div class="document-row ${item.id === selected?.id ? 'is-selected' : ''}" data-explorer-item="documents:${item.id}" role="button" tabindex="0" draggable="true">${itemSelectButton('documents', item)}<span class="document-row__type">${escapeHtml(documentExtension(item.name))}</span><span class="document-row__name"><strong>${escapeHtml(item.name)}</strong><small>${item.versionCount ? `${item.versionCount} верс. · ` : ''}${escapeHtml(folderName('documents', item.folderId))}</small>${tagChips(item)}</span><em>${formatBytes(item.size)}</em>${favoriteButton('documents', item)}</div>`).join('') : folders.length ? '' : `<div class="plain-empty"><strong>Документов пока нет</strong><span>Создайте текстовый файл или добавьте документ.</span><button class="button button--ghost button--compact" data-action="new-text-document">Создать текст</button></div>`}</div></section>${foldersOnly ? '' : `<aside class="document-inspector">${renderDocumentInspector(selected)}</aside>`}</div></div>`;
}

function renderDocumentInspector(document) {
  if (!document) return `<div class="inspector-empty"><span>—</span><p>Выберите документ</p></div>`;
  const previewable = documentCanPreview(document.type);
  return `<div class="document-inspector__type">${escapeHtml(documentExtension(document.name))}</div><p class="eyebrow">${escapeHtml(folderName('documents', document.folderId))}</p><h2>${escapeHtml(document.name)}</h2>${tagChips(document)}<dl><div><dt>Формат</dt><dd>${escapeHtml(document.type)}</dd></div><div><dt>Размер</dt><dd>${formatBytes(document.size)}</dd></div><div><dt>Версии</dt><dd>${document.versionCount || 0}</dd></div></dl><div class="document-actions">${previewable ? `<button class="button button--primary button--compact" data-preview-document="${document.id}">${['text/plain', 'text/markdown', 'text/csv'].includes(document.type) ? 'Открыть редактор' : 'Смотреть'}</button>` : ''}<button class="button button--ghost button--compact" data-edit-metadata="documents:${document.id}">Организовать</button><button class="button button--ghost button--compact" data-save-media="${document.id}">Сохранить на ПК</button><button class="button button--ghost button--compact" data-rename-media="${document.id}">Переименовать</button><button class="button button--danger button--compact" data-delete-media="${document.id}">В корзину</button></div>`;
}

function renderTrashPage() {
  const labels = { entry: 'Пароль', note: 'Заметка', media: 'Медиа', document: 'Документ', otp: 'Одноразовый код' };
  const items = state.snapshot.trash;
  return `<div class="trash-workspace">${items.length ? `<div class="trash-list">${items.map((item) => `<article class="trash-row" data-trash-row="${item.id}" tabindex="0"><span class="trash-row__icon">${icon(item.entityType === 'entry' ? 'key' : item.entityType === 'note' ? 'note' : item.entityType === 'document' ? 'document' : item.entityType === 'otp' ? 'otp' : 'image')}</span><div class="trash-row__copy"><strong>${escapeHtml(item.name)}</strong><span>${labels[item.entityType] || 'Элемент'} · удалено ${formatDate(item.deletedAt)}${item.attachmentCount ? ` · ${item.attachmentCount} влож.` : ''}</span></div><div class="trash-row__actions"><button class="button button--ghost button--compact" data-preview-trash="${item.id}">Открыть</button><button class="button button--ghost button--compact" data-restore-trash="${item.id}">Восстановить</button><button class="icon-button icon-button--danger" data-purge-trash="${item.id}" aria-label="Удалить окончательно">${icon('trash')}</button></div></article>`).join('')}</div><footer class="trash-footer">Автоочистка через ${state.snapshot.settings.trashRetentionDays} дн.</footer>` : `<div class="empty-state"><div><div class="empty-state__icon">${icon('trash')}</div><h2>Корзина пуста</h2></div></div>`}</div>`;
}

function renderNotesPage() {
  const notes = organizerItems('notes');
  const folders = visibleFolders('notes');
  const selected = notes.find((note) => note.id === state.selectedNoteId) || notes[0] || null;
  if (selected && state.selectedNoteId !== selected.id) state.selectedNoteId = selected.id;
  const foldersOnly = folders.length && !notes.length;
  return `<div class="organized-page" data-explorer-root="notes">${organizerBar('notes')}<div class="vault-browser notes-browser ${foldersOnly ? 'explorer-folders-only' : ''}" data-explorer-surface="notes">
    <section class="note-index"><div class="record-columns explorer-list-path">${state.organizer.notes.favorites ? `<div class="folder-breadcrumbs"><strong>${icon('star')} Избранное</strong></div>` : folderBreadcrumbs('notes')}<span>${folders.length ? `${folders.length} пап.` : ''}</span></div><div class="record-list">
      ${folders.map((folder) => folderListRow('notes', folder, 'notes')).join('')}${notes.length ? notes.map((note) => `<div class="note-row ${note.id === selected?.id ? 'is-selected' : ''}" data-explorer-item="notes:${note.id}" role="button" tabindex="0" draggable="true">${itemSelectButton('notes', note)}<div><strong>${escapeHtml(note.title)}</strong><small>${escapeHtml((note.body || 'Пустая заметка').replace(/\s+/g, ' ').slice(0, 90))}</small>${tagChips(note)}</div>${favoriteButton('notes', note)}</div>`).join('') : folders.length ? '' : `<div class="plain-empty"><strong>Заметок пока нет</strong><span>Создайте первую заметку.</span></div>`}
    </div></section>
    ${foldersOnly ? '' : `<aside class="note-sheet">${selected ? renderNoteInspector(selected) : `<div class="inspector-empty"><span>—</span><p>Выберите заметку</p></div>`}</aside>`}
  </div></div>`;
}

function renderNoteInspector(note) {
  return `<div class="note-sheet__head"><div><span>${escapeHtml(folderName('notes', note.folderId))}</span><h1>${escapeHtml(note.title)}</h1>${tagChips(note)}</div><div class="note-sheet__actions">${favoriteButton('notes', note)}<button class="button button--ghost button--compact" data-copy-note="${note.id}">${icon('copy')} Копировать</button><button class="button button--ghost button--compact" data-edit-note="${note.id}">${icon('edit')} Изменить</button><button class="icon-button icon-button--danger" data-delete-note="${note.id}" aria-label="Удалить">${icon('trash')}</button></div></div>
    <div class="note-sheet__body">${escapeHtml(note.body || 'Пустая заметка')}</div>
    <div class="note-attachments"><div class="note-attachments__head"><div><strong>Вложения</strong><span>${note.attachments.length} фото</span></div><div class="note-attachment-actions"><button class="button button--ghost button--compact" data-paste-note="${note.id}">${icon('copy')} Из буфера</button><button class="button button--ghost button--compact" data-attach-note="${note.id}">${icon('upload')} Из файла</button></div></div>
    ${note.attachments.length ? `<div class="note-photo-strip">${note.attachments.map((item) => `<figure data-open-media="${item.id}"><img src="${item.url}" alt="${escapeHtml(item.name)}" draggable="false"><figcaption>${escapeHtml(item.name)}</figcaption></figure>`).join('')}</div>` : `<p class="note-attachments__empty">Добавьте изображение из буфера или файла.</p>`}</div>`;
}

function formatOtpCode(code, digits = 6) {
  const value = String(code || '').padStart(digits, '—');
  const split = Math.ceil(value.length / 2);
  return `${value.slice(0, split)} ${value.slice(split)}`;
}

function renderOtpPage() {
  const accounts = organizerItems('otp');
  const showContent = accounts.length || !visibleFolders('otp').length;
  return `<div class="organized-page" data-explorer-root="otp">${organizerBar('otp')}${folderShelf('otp')}${showContent ? `<div class="otp-workspace" data-explorer-surface="otp"><header class="otp-intro"><div><p class="eyebrow">TOTP</p><h2>Одноразовые коды</h2></div></header>
    <div class="otp-list">${accounts.length ? accounts.map((account) => {
      const live = state.otpCodes[account.id];
      const remaining = live?.remaining || account.period;
      const angle = Math.max(0, Math.min(360, (remaining / account.period) * 360));
      return `<article class="otp-row ${state.selectedItems.otp.has(account.id) ? 'is-selected' : ''}" data-otp-row="${account.id}" data-explorer-item="otp:${account.id}" tabindex="0" draggable="true">${itemSelectButton('otp', account)}<span class="otp-row__mark">${escapeHtml((account.issuer || account.account).charAt(0).toUpperCase())}</span><div class="otp-row__identity"><strong>${escapeHtml(account.issuer || 'Без сервиса')}</strong><span>${escapeHtml(account.account || 'Без аккаунта')} · ${escapeHtml(folderName('otp', account.folderId))}</span>${tagChips(account)}</div><button class="otp-code" data-copy-otp="${account.id}" aria-label="Скопировать одноразовый код"><strong data-otp-code="${account.id}">${formatOtpCode(live?.code, account.digits)}</strong><span>Скопировать</span></button><div class="otp-time"><span class="otp-time__ring" data-otp-ring="${account.id}" style="--otp-angle:${angle}deg"><i></i></span><small data-otp-remaining="${account.id}">${remaining} сек.</small></div><div class="otp-row__actions">${favoriteButton('otp', account)}<button class="icon-button" data-edit-otp="${account.id}" aria-label="Изменить">${icon('edit')}</button><button class="icon-button icon-button--danger" data-delete-otp="${account.id}" aria-label="Удалить">${icon('trash')}</button></div></article>`;
    }).join('') + `<button class="otp-add-row" data-action="new-otp">${icon('plus')}<span>Добавить код</span></button>` : `<div class="otp-empty"><span>${icon('otp')}</span><h2>Кодов пока нет</h2><p>Добавьте секрет вручную, из QR-кода или ссылки otpauth.</p><button class="button button--primary" data-action="new-otp">Добавить первый код</button></div>`}</div></div>` : ''}</div>`;
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
  const helpTopics = {
    passwords: { icon: 'key', title: 'Пароли', subtitle: 'Сохранение и копирование', body: '<p>Откройте «Все записи» и нажмите «Новая запись». Укажите название, логин и пароль. При желании добавьте сайт, заметку, папку и теги.</p><p>Выберите запись и нажмите кнопку нужного поля, чтобы скопировать его. Пароль сам удалится из буфера через время, выбранное в настройках.</p>' },
    folders: { icon: 'folder', title: 'Папки и теги', subtitle: 'Порядок в хранилище', body: '<p>В корне записи и файлы находятся рядом с папками, как в Проводнике Windows. Дважды нажмите папку, чтобы войти в неё, а Escape — чтобы вернуться на уровень выше.</p><p>Для выбора нескольких объектов тяните рамку по пустому месту или удерживайте Ctrl. Выбранные файлы и папки можно перетащить в другую папку. Теги объединяют записи по теме, а звёздочка добавляет их в избранное.</p>' },
    notes: { icon: 'note', title: 'Заметки', subtitle: 'Текст, фото и голос', body: '<p>Нажмите «Новая заметка», добавьте название и текст. Фотографии можно выбрать с компьютера или вставить из буфера обмена.</p><p>Голосовую запись создайте кнопкой «Записать» в медиатеке. После этого её можно слушать и хранить как обычный файл.</p>' },
    files: { icon: 'image', title: 'Файлы', subtitle: 'Фото, видео и документы', body: '<p>Перетащите файлы в окно Nocturne или нажмите кнопку импорта. В Проводнике Windows можно нажать на файл правой кнопкой и выбрать «Добавить в Nocturne».</p><p>«Снимок области» сохраняет выбранную часть экрана. Чтобы вернуть файл на компьютер, откройте его и выберите сохранение.</p>' },
    documents: { icon: 'document', title: 'Документы', subtitle: 'Просмотр и свой текст', body: '<p>В разделе «Документы» можно добавить готовый файл или создать новый текст. Для созданного текста сохраняются прошлые версии, к которым можно вернуться.</p><p>Поддерживаемые документы открываются прямо внутри Nocturne.</p>' },
    otp: { icon: 'otp', title: 'Коды доступа', subtitle: 'Одноразовые коды', body: '<p>Нажмите кнопку добавления в разделе «Коды доступа». Выберите картинку с QR-кодом, вставьте QR из буфера или введите данные вручную.</p><p>Нажмите на готовый код, чтобы скопировать его. Не показывайте QR-код и данные из него другим людям.</p>' },
    access: { icon: 'lock', title: 'Вход', subtitle: 'Пароль, PIN и рисунок', body: '<p>Мастер-пароль открывает всё хранилище. Не забывайте его и храните ключ восстановления отдельно.</p><p>PIN или рисунок можно включить в разделе «Доступ» для быстрого входа, пока приложение продолжает работать. Кнопка с замком закрывает хранилище вручную.</p>' },
    trash: { icon: 'trash', title: 'Корзина', subtitle: 'Удаление и восстановление', body: '<p>Удалённые записи сначала попадают в корзину. Там их можно восстановить или удалить окончательно.</p><p>При удалении папки её вложенные папки и всё содержимое тоже отправляются в корзину.</p>' },
    problems: { icon: 'shield', title: 'Если не получается', subtitle: 'Что проверить', body: '<p>Убедитесь, что хранилище открыто и нужный файл существует. Для записи голоса разрешите приложению доступ к микрофону.</p><p>Перед удалением большого количества данных проверьте список выбранного. Окончательное удаление из корзины отменить нельзя.</p>' },
  };
  const activeHelp = helpTopics[state.helpTopic] || helpTopics.passwords;
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
    privacy: {
      icon: 'shield', title: 'Защита экрана', caption: 'Захват окна и скрытие при переключении.',
      content: `<section class="settings-card">
        <div class="settings-card__head"><div class="settings-card__icon">${icon('shield')}</div><div><h3>Видимость содержимого</h3><p>Системная защита Windows применяется и к основному, и к быстрому окну.</p></div></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Запретить захват окна</strong><span>Скрывать Nocturne в скриншотах, записи экрана и трансляциях</span></div><label class="switch"><input id="setting-screen-protection" type="checkbox" ${settings.screenProtection !== false ? 'checked' : ''}><span></span></label></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Скрывать при потере фокуса</strong><span>Закрывать содержимое шторкой при переключении на другое окно</span></div><label class="switch"><input id="setting-focus-blur" type="checkbox" ${settings.blurOnFocusLoss !== false ? 'checked' : ''}><span></span></label></div>
        <div class="dialog__footer"><button class="button button--primary button--compact" data-action="save-settings">Сохранить защиту</button></div>
      </section>`,
    },
    system: {
      icon: 'home', title: 'Windows', caption: 'Запуск приложения и жизненный цикл фонового процесса.',
      content: `<section class="settings-card">
        <div class="settings-card__head"><div class="settings-card__icon">${icon('home')}</div><div><h3>Запуск вместе с Windows</h3><p>Запускать приложение в трее.</p></div></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Автозапуск</strong><span>Не показывать основное окно и не загружать ключ</span></div><label class="switch"><input id="setting-autostart" type="checkbox" ${state.launchAtStartup ? 'checked' : ''}><span></span></label></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Хранение удалённого</strong><span>После срока элементы корзины уничтожаются окончательно</span></div><select id="setting-trash-retention">${[1, 7, 30, 90].map((number) => `<option value="${number}" ${settings.trashRetentionDays === number ? 'selected' : ''}>${number} дн.</option>`).join('')}</select></div>
        <div class="dialog__footer"><button class="button button--primary button--compact" data-action="save-system-settings">Сохранить</button></div>
      </section>`,
    },
    data: {
      icon: 'upload', title: 'Данные', caption: 'Резервная копия содержит всё хранилище и защищена его мастер-паролем.',
      content: `<section class="settings-card"><div class="settings-card__head"><div class="settings-card__icon">${icon('upload')}</div><div><h3>Резервная копия</h3><p>Экспортируйте всё хранилище или замените его ранее созданной копией.</p></div></div><div class="setting-row"><div class="setting-row__copy"><strong>Резервные копии</strong><span>Пароли, заметки, коды, папки и зашифрованные файлы</span></div><button class="button button--ghost button--compact" data-action="backup-choice">Открыть</button></div></section>`,
    },
    appearance: {
      icon: 'sparkle', title: 'Оформление', caption: 'Тема и язык интерфейса применяются до разблокировки хранилища.',
      content: `<section class="settings-card"><div class="settings-card__head"><div class="settings-card__icon">${icon('sparkle')}</div><div><h3>Тема и язык</h3><p>Выберите удобный вид приложения.</p></div></div><div class="setting-row"><div class="setting-row__copy"><strong>Язык</strong><span>Язык кнопок, подсказок и справки</span></div><select id="setting-locale"><option value="ru" ${state.locale === 'ru' ? 'selected' : ''}>Русский</option><option value="en" ${state.locale === 'en' ? 'selected' : ''}>Английский</option></select></div><div class="setting-row"><div class="setting-row__copy"><strong>Тема</strong><span>Светлая, тёмная или как в Windows</span></div><select id="setting-theme"><option value="light" ${state.theme === 'light' ? 'selected' : ''}>Светлая</option><option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>Тёмная</option><option value="system" ${state.theme === 'system' ? 'selected' : ''}>Системная</option></select></div><div class="dialog__footer"><button class="button button--primary button--compact" data-action="save-appearance">Применить</button></div></section>`,
    },
    destroy: {
      icon: 'warning', title: 'Уничтожение', caption: 'Необратимые сценарии удаления ключа и локального контейнера.',
      content: `<section class="settings-card danger-card">
        <div class="settings-card__head"><div class="settings-card__icon">${icon('warning')}</div><div><h3>Уничтожение хранилища</h3><p>Удаляет ключ, перезаписывает локальные файлы и очищает контейнер.</p></div></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>После неудачных попыток</strong><span>Минимальный допустимый лимит — 10</span></div><label class="switch"><input id="setting-wipe" type="checkbox" ${settings.wipeEnabled ? 'checked' : ''}><span></span></label></div>
        <div class="setting-row"><div class="setting-row__copy"><strong>Количество попыток</strong><span>От 10 до 50</span></div><input id="setting-wipe-threshold" type="number" min="10" max="50" value="${settings.wipeThreshold}"></div>
        <div class="danger-note">Внешний recovery-ключ или отдельная резервная копия могут восстановить данные. Приложение не может удалить файлы с отключённых носителей.</div>
        <div class="dialog__footer"><button class="button button--ghost button--compact" data-action="save-settings">Сохранить лимит</button><button class="button button--danger button--compact" data-action="destroy-now">Уничтожить сейчас</button></div>
      </section>`,
    },
    help: {
      icon: 'note', title: 'Справка', caption: 'Как пользоваться Nocturne — коротко и по шагам.', eyebrow: 'Помощь',
      content: `<section class="help-guide"><nav>${Object.entries(helpTopics).map(([id, topic]) => `<button class="help-topic ${id === state.helpTopic ? 'is-active' : ''}" data-help-topic="${id}">${icon(topic.icon)}<span><strong>${topic.title}</strong><small>${topic.subtitle}</small></span></button>`).join('')}</nav><article><span class="help-guide__icon">${icon(activeHelp.icon)}</span><p class="eyebrow">Справка</p><h2>${activeHelp.title}</h2>${activeHelp.body}</article></section>`,
    },
  };
  const groupedSections = {
    security: {
      icon: 'shield', title: 'Безопасность', caption: 'Блокировка, способы входа и защита содержимого.',
      content: `${sections.lock.content}${sections.access.content}${sections.privacy.content}`,
    },
    application: {
      icon: 'settings', title: 'Приложение', caption: 'Запуск вместе с Windows, язык и внешний вид.',
      content: `${sections.system.content}${sections.appearance.content}`,
    },
    data: {
      icon: 'upload', title: 'Данные', caption: 'Резервные копии, корзина и окончательное удаление.',
      content: `${sections.data.content}${sections.destroy.content}`,
    },
    help: sections.help,
  };
  const aliases = { lock: 'security', access: 'security', privacy: 'security', system: 'application', appearance: 'application', destroy: 'data' };
  state.settingsSection = aliases[state.settingsSection] || state.settingsSection;
  const current = groupedSections[state.settingsSection] || groupedSections.security;
  return `<div class="settings-workspace"><aside class="settings-section-nav" aria-label="Разделы настроек">
      <div class="settings-section-nav__head"><span>Настройки</span><small>v${escapeHtml(state.version)}</small></div>
      ${Object.entries(groupedSections).map(([id, section]) => `<button class="settings-section-button ${id === state.settingsSection ? 'is-active' : ''}" data-settings-section="${id}"><span class="settings-section-button__icon">${icon(section.icon)}</span><span><strong>${section.title}</strong><small>${({ security: 'Вход и защита', application: 'Windows и оформление', data: 'Копии и удаление', help: 'Как всё работает' })[id]}</small></span></button>`).join('')}
    </aside><main class="settings-stage" data-settings-stage="${state.settingsSection}"><header class="settings-stage__head"><p class="eyebrow">${current.eyebrow || 'Конфиденциальность'}</p><h1>${current.title}</h1><p>${current.caption}</p></header><div class="settings-layout">${current.content}</div></main></div>`;
}

function renderEmpty(iconName, title, text, action, label) {
  return `<div class="empty-state"><div><div class="empty-state__icon">${icon(iconName)}</div><h2>${title}</h2><p>${text}</p>${action ? `<button class="button button--secondary" data-action="${action}">${icon('plus')} ${label}</button>` : ''}</div></div>`;
}

function updateSnapshot(snapshot) {
  state.snapshot = snapshot;
  for (const section of Object.keys(state.selectedItems)) {
    const ids = new Set(sectionItems(section).map((item) => item.id));
    for (const id of state.selectedItems[section]) if (!ids.has(id)) state.selectedItems[section].delete(id);
    const folderIdsForSection = new Set(sectionFolders(section).map((folder) => folder.id));
    for (const id of state.selectedFolderItems[section]) if (!folderIdsForSection.has(id)) state.selectedFolderItems[section].delete(id);
    if (state.organizer[section].folderId && !sectionFolders(section).some((folder) => folder.id === state.organizer[section].folderId)) state.organizer[section].folderId = '';
  }
  const folderIds = new Set(snapshot.folders.map((folder) => folder.id));
  for (const id of state.selectedFolders) if (!folderIds.has(id)) state.selectedFolders.delete(id);
  state.lastSettings = { ...snapshot.settings };
  state.quickUnlockAvailable = snapshot.settings.quickUnlockAvailable;
  state.quickUnlockMode = snapshot.settings.quickUnlockMode === 'pin' || snapshot.settings.quickUnlockMode === 'pattern' ? snapshot.settings.quickUnlockMode : 'password';
  state.unlocked = true;
  renderMain();
  if (state.pendingExternalImports && !state.consumingExternalImports) queueMicrotask(consumeExternalImports);
}

async function consumeExternalImports() {
  if (!state.unlocked || state.consumingExternalImports || !state.pendingExternalImports) return;
  state.consumingExternalImports = true;
  try {
    const target = FILE_IMPORT_SECTIONS.has(state.page) ? { section: state.page, folderId: activeFolderId(state.page) } : {};
    const result = await apiCall(window.nocturne.consumeExternalImports(target));
    state.pendingExternalImports = 0;
    if (result.documentsAdded && !result.mediaAdded) state.page = 'documents';
    else if (result.mediaAdded) state.page = 'media';
    updateSnapshot(result.snapshot);
    toast(result.added ? `Добавлено из Проводника: ${result.added}` : 'Поддерживаемых файлов не найдено', result.added ? 'normal' : 'danger');
  } catch (error) {
    toast(friendlyError(error.message), 'danger');
  } finally {
    state.consumingExternalImports = false;
  }
}

function openEntry(entry = null) {
  entryForm.reset();
  document.querySelector('#entry-dialog-title').textContent = entry ? 'Изменить запись' : 'Новый пароль';
  const folderSelect = entryForm.elements.folderId;
  folderSelect.innerHTML = `<option value="">Корень раздела</option>${sectionFolders('passwords').map((folder) => `<option value="${escapeHtml(folder.id)}">${'— '.repeat(folderDepth('passwords', folder))}${escapeHtml(folder.name)}</option>`).join('')}`;
  if (entry) {
    for (const key of ['id', 'title', 'username', 'password', 'url', 'notes', 'folderId']) entryForm.elements[key].value = entry[key] || '';
    entryForm.elements.tags.value = (entry.tags || []).join(', ');
    entryForm.elements.favorite.checked = Boolean(entry.favorite);
  } else folderSelect.value = activeFolderId('passwords') || '';
  entryForm.elements.currentPassword.value = '';
  entryForm.querySelector('.entry-current-password').hidden = !entry;
  entryForm.elements.password.type = 'password';
  entryDialog.showModal();
  setTimeout(() => entryForm.elements.title.focus(), 10);
}

function openNote(note = null) {
  noteForm.reset();
  document.querySelector('#note-dialog-title').textContent = note ? 'Изменить заметку' : 'Новая заметка';
  noteForm.elements.folderId.innerHTML = `<option value="">Корень раздела</option>${sectionFolders('notes').map((folder) => `<option value="${escapeHtml(folder.id)}">${'— '.repeat(folderDepth('notes', folder))}${escapeHtml(folder.name)}</option>`).join('')}`;
  if (note) {
    for (const key of ['id', 'title', 'body', 'folderId']) noteForm.elements[key].value = note[key] || '';
    noteForm.elements.tags.value = (note.tags || []).join(', ');
    noteForm.elements.favorite.checked = Boolean(note.favorite);
  } else noteForm.elements.folderId.value = activeFolderId('notes') || '';
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

function openFolder(section, folderId = '') {
  state.organizer[section].folderId = folderId;
  state.organizer[section].favorites = false;
  state.selectedItems[section].clear();
  state.selectedFolderItems[section].clear();
  renderMain();
}

function syncExplorerSelection(section) {
  document.querySelectorAll(`[data-explorer-folder^="${CSS.escape(section)}:"]`).forEach((element) => {
    const id = element.dataset.explorerFolder.split(':')[1];
    element.classList.toggle('is-selected', state.selectedFolderItems[section].has(id));
  });
  document.querySelectorAll(`[data-explorer-item^="${CSS.escape(section)}:"]`).forEach((element) => {
    const id = element.dataset.explorerItem.split(':')[1];
    const selected = state.selectedItems[section].has(id);
    element.classList.toggle('is-selected', selected);
    const control = element.querySelector('.item-select');
    if (control) {
      control.classList.toggle('is-selected', selected);
      control.setAttribute('aria-label', selected ? 'Снять выделение' : 'Выбрать');
      control.innerHTML = selected ? icon('check') : '';
    }
  });
  const selection = document.querySelector(`[data-organizer-selection="${CSS.escape(section)}"]`);
  if (selection) {
    selection.innerHTML = selectionActions(section);
    applyUiPreferences(selection);
  }
}

function syncExplorerInspector(section, id) {
  const item = sectionItems(section).find((candidate) => candidate.id === id);
  if (!item) return;
  let target = null;
  let content = '';
  if (section === 'passwords') {
    target = document.querySelector('.record-inspector');
    content = renderEntryInspector(item);
  } else if (section === 'notes') {
    target = document.querySelector('.note-sheet');
    content = renderNoteInspector(item);
  } else if (section === 'documents') {
    target = document.querySelector('.document-inspector');
    content = renderDocumentInspector(item);
  }
  if (target) {
    target.innerHTML = content;
    applyUiPreferences(target);
  }
}

function selectExplorerTarget(section, kind, id, additive = false, render = true) {
  const itemSelection = state.selectedItems[section];
  const folderSelection = state.selectedFolderItems[section];
  const selection = kind === 'folder' ? folderSelection : itemSelection;
  if (!additive) {
    itemSelection.clear();
    folderSelection.clear();
  }
  if (additive && selection.has(id)) selection.delete(id); else selection.add(id);
  if (kind === 'item') {
    if (section === 'passwords') state.selectedEntryId = id;
    if (section === 'notes') state.selectedNoteId = id;
    if (section === 'documents') state.selectedDocumentId = id;
  }
  if (render) renderMain();
  else {
    syncExplorerSelection(section);
    if (kind === 'item') syncExplorerInspector(section, id);
  }
}

function openExplorerItem(section, id) {
  const item = sectionItems(section).find((candidate) => candidate.id === id);
  if (!item) return;
  if (section === 'passwords') return openEntry(item);
  if (section === 'notes') return openNote(item);
  if (section === 'otp') return openOtpDialog(item);
  if (section === 'media') return openMedia(id);
  if (section === 'documents') {
    if (!documentCanPreview(item.type)) return toast('Этот формат можно сохранить на компьютер, но нельзя показать внутри приложения.', 'danger');
    return openDocumentPreview(id);
  }
}

function showFolderCreateDialog(section, parentId = state.organizer[section].folderId || '') {
  const parent = sectionFolders(section).find((folder) => folder.id === parentId);
  openSimple(`<form id="folder-form"><input type="hidden" name="section" value="${escapeHtml(section)}"><input type="hidden" name="parentId" value="${escapeHtml(parent?.id || '')}"><div class="dialog__header"><div><p class="eyebrow">${escapeHtml(organizerTitle(section))}</p><h2>Новая папка</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">${parent ? `Будет создана внутри «${escapeHtml(parent.name)}».` : 'Будет создана в корне раздела.'}</p><label class="field"><span>Название</span><input name="name" maxlength="64" required autofocus placeholder="Название папки"></label><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Создать</button></div></form>`);
}

function removeContextMenu() {
  document.querySelector('.explorer-context-menu')?.remove();
}

function showContextMenu(x, y, html) {
  removeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'explorer-context-menu';
  menu.innerHTML = html;
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(36, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
}

function itemContextMenu(section, id) {
  const item = sectionItems(section).find((candidate) => candidate.id === id);
  if (!item) return '';
  const canRename = section === 'media' || section === 'documents';
  return `<button data-context-open-item="${section}:${escapeHtml(id)}">${icon(section === 'documents' ? 'document' : section === 'media' ? 'image' : 'edit')}<span>Открыть</span></button><button data-toggle-favorite="${section}:${escapeHtml(id)}">${icon('star')}<span>${item.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}</span></button><button data-edit-metadata="${section}:${escapeHtml(id)}">${icon('folder')}<span>Переместить и добавить теги</span></button>${canRename ? `<button data-rename-media="${escapeHtml(id)}">${icon('edit')}<span>Переименовать</span></button>` : ''}<hr><button class="is-danger" data-context-delete-item="${section}:${escapeHtml(id)}">${icon('trash')}<span>Переместить в корзину</span></button>`;
}

document.addEventListener('contextmenu', (event) => {
  if (!state.unlocked) return;
  const folderTarget = event.target.closest('[data-explorer-folder]');
  const itemTarget = event.target.closest('[data-explorer-item]');
  const surface = event.target.closest('[data-explorer-surface]');
  if (!folderTarget && !itemTarget && !surface) return;
  event.preventDefault();
  if (folderTarget) {
    const [section, id] = folderTarget.dataset.explorerFolder.split(':');
    if (!state.selectedFolderItems[section].has(id)) selectExplorerTarget(section, 'folder', id, false, false);
    const folder = sectionFolders(section).find((candidate) => candidate.id === id);
    showContextMenu(event.clientX, event.clientY, `<button data-open-folder="${section}:${escapeHtml(id)}">${icon('folder')}<span>Открыть</span></button><button data-context-folder-favorite="${section}:${escapeHtml(id)}">${icon('star')}<span>${folder?.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}</span></button><button data-bulk-edit="${section}">${icon('folder')}<span>Переместить</span></button><button data-rename-folder="${escapeHtml(id)}">${icon('edit')}<span>Переименовать</span></button><button data-context-create-folder="${section}:${escapeHtml(id)}">${icon('plus')}<span>Создать папку внутри</span></button><hr><button class="is-danger" data-context-delete-folder="${section}:${escapeHtml(id)}">${icon('trash')}<span>Удалить с содержимым</span></button>`);
    return;
  }
  if (itemTarget) {
    const [section, id] = itemTarget.dataset.explorerItem.split(':');
    if (!state.selectedItems[section].has(id)) selectExplorerTarget(section, 'item', id, false, false);
    showContextMenu(event.clientX, event.clientY, itemContextMenu(section, id));
    return;
  }
  const section = surface.dataset.explorerSurface;
  if (!sectionFolders(section)) return;
  showContextMenu(event.clientX, event.clientY, `<button data-context-create-folder="${section}:${escapeHtml(state.organizer[section].folderId || '')}">${icon('plus')}<span>Создать папку</span></button>`);
});

document.addEventListener('dblclick', (event) => {
  const trashTarget = event.target.closest('[data-trash-row]');
  if (trashTarget && !event.target.closest('button')) {
    event.preventDefault();
    openTrashPreview(trashTarget.dataset.trashRow);
    return;
  }
  const folderTarget = event.target.closest('[data-explorer-folder]');
  const itemTarget = event.target.closest('[data-explorer-item]');
  if (!folderTarget && !itemTarget) return;
  clearTimeout(state.explorerClickTimer);
  state.explorerClickTimer = null;
  event.preventDefault();
  if (folderTarget) {
    const [section, id] = folderTarget.dataset.explorerFolder.split(':');
    openFolder(section, id);
  } else {
    const [section, id] = itemTarget.dataset.explorerItem.split(':');
    openExplorerItem(section, id);
  }
});

function confirmationDialog({ eyebrow = 'Подтверждение', title, text, phrase, action, button = 'Продолжить', danger = false, requireMasterPassword = false }) {
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">${eyebrow}</p><h2>${escapeHtml(title)}</h2></div><button class="icon-button" data-close-dialog="simple-dialog">×</button></div>
    <p class="muted">${escapeHtml(text)}</p>
    ${requireMasterPassword ? '<label class="field"><span>Текущий мастер-пароль</span><input id="confirmation-master-password" type="password" maxlength="256" autocomplete="current-password" required></label>' : ''}
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
}

function recordActivity() {
  if (state.unlocked) window.nocturne.recordActivity();
}

document.addEventListener('pointerdown', recordActivity, { passive: true });
document.addEventListener('keydown', recordActivity, { passive: true });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const hadContextMenu = Boolean(document.querySelector('.explorer-context-menu'));
    removeContextMenu();
    if (hadContextMenu || [...document.querySelectorAll('dialog')].some((dialog) => dialog.open)) return;
    const section = ORGANIZER_SECTIONS.has(state.page) ? state.page : null;
    const folderId = section ? state.organizer[section].folderId : '';
    if (section && (folderId || state.organizer[section].favorites || state.organizer[section].tag)) {
      event.preventDefault();
      const folder = sectionFolders(section).find((candidate) => candidate.id === folderId);
      state.organizer[section].tag = '';
      openFolder(section, folder?.parentId || '');
      return;
    }
  }
  if (mediaDialog.open && state.viewerMediaId && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    stepMedia(event.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  const trashRow = event.target.closest?.('[data-trash-row]');
  if (trashRow && event.key === 'Enter') {
    event.preventDefault();
    openTrashPreview(trashRow.dataset.trashRow);
    return;
  }
  const row = event.target.closest?.('[data-explorer-item], [data-explorer-folder]');
  if (!row || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (row.dataset.explorerFolder) {
    const [section, id] = row.dataset.explorerFolder.split(':');
    if (event.key === 'Enter') openFolder(section, id); else selectExplorerTarget(section, 'folder', id, event.ctrlKey || event.metaKey, false);
  } else {
    const [section, id] = row.dataset.explorerItem.split(':');
    if (event.key === 'Enter') openExplorerItem(section, id); else selectExplorerTarget(section, 'item', id, event.ctrlKey || event.metaKey, false);
  }
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

setInterval(() => { refreshOtpCodes(); }, 1_000);

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-pin-input]')) event.target.value = event.target.value.replace(/\D/g, '').slice(0, 12);
  if (event.target.matches('#create-form input[name="password"]')) {
    const length = event.target.value.length;
    const meter = document.querySelector('.password-meter span');
    meter.parentElement.dataset.strength = length < 14 ? 'weak' : length < 20 ? 'fair' : 'strong';
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

document.addEventListener('change', (event) => {
  if (event.target.dataset.organizerFolder) {
    const section = event.target.dataset.organizerFolder;
    state.organizer[section].folderId = event.target.value;
    state.selectedItems[section].clear();
    renderMain();
  }
  if (event.target.dataset.organizerTag) {
    const section = event.target.dataset.organizerTag;
    state.organizer[section].tag = event.target.value;
    state.selectedItems[section].clear();
    renderMain();
  }
});

function marqueeBounds(startX, startY, currentX, currentY) {
  return {
    left: Math.min(startX, currentX),
    top: Math.min(startY, currentY),
    right: Math.max(startX, currentX),
    bottom: Math.max(startY, currentY),
  };
}

function intersects(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function finishMarquee(event) {
  const marquee = state.marquee;
  if (!marquee || (event?.pointerId !== undefined && event.pointerId !== marquee.pointerId)) return;
  marquee.element.remove();
  document.body.classList.remove('is-marquee-selecting');
  try { marquee.captureTarget.releasePointerCapture?.(marquee.pointerId); } catch {}
  state.marquee = null;
}

document.addEventListener('pointerdown', (event) => {
  if (!state.unlocked || state.busy || event.button !== 0 || state.marquee) return;
  const root = event.target.closest?.('[data-explorer-root]');
  if (!root || event.target.closest('button, input, select, textarea, a, [data-explorer-item], [data-explorer-folder]')) return;
  const section = root.dataset.explorerRoot;
  if (!ORGANIZER_SECTIONS.has(section)) return;
  const element = document.createElement('div');
  element.className = 'selection-marquee';
  element.style.left = `${event.clientX}px`;
  element.style.top = `${event.clientY}px`;
  document.body.append(element);
  const additive = event.ctrlKey || event.metaKey;
  state.marquee = {
    section,
    root,
    element,
    pointerId: event.pointerId,
    captureTarget: event.target,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    baseItems: additive ? new Set(state.selectedItems[section]) : new Set(),
    baseFolders: additive ? new Set(state.selectedFolderItems[section]) : new Set(),
  };
  if (!additive) {
    state.selectedItems[section].clear();
    state.selectedFolderItems[section].clear();
    syncExplorerSelection(section);
  }
  document.body.classList.add('is-marquee-selecting');
  event.target.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

document.addEventListener('pointermove', (event) => {
  const marquee = state.marquee;
  if (!marquee || event.pointerId !== marquee.pointerId) return;
  const bounds = marqueeBounds(marquee.startX, marquee.startY, event.clientX, event.clientY);
  if (!marquee.moved && Math.hypot(event.clientX - marquee.startX, event.clientY - marquee.startY) < 4) return;
  marquee.moved = true;
  Object.assign(marquee.element.style, {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.right - bounds.left}px`,
    height: `${bounds.bottom - bounds.top}px`,
  });
  const items = new Set(marquee.baseItems);
  const folders = new Set(marquee.baseFolders);
  marquee.root.querySelectorAll('[data-explorer-item], [data-explorer-folder]').forEach((element) => {
    if (!intersects(bounds, element.getBoundingClientRect())) return;
    if (element.dataset.explorerItem) items.add(element.dataset.explorerItem.split(':')[1]);
    if (element.dataset.explorerFolder) folders.add(element.dataset.explorerFolder.split(':')[1]);
  });
  state.selectedItems[marquee.section] = items;
  state.selectedFolderItems[marquee.section] = folders;
  syncExplorerSelection(marquee.section);
  event.preventDefault();
});

document.addEventListener('pointerup', finishMarquee);
document.addEventListener('pointercancel', finishMarquee);

function clearInternalDrag() {
  state.internalDrag = null;
  document.querySelectorAll('.is-drag-source, .is-drop-target').forEach((element) => element.classList.remove('is-drag-source', 'is-drop-target'));
}

document.addEventListener('dragstart', (event) => {
  if (!state.unlocked || state.busy) return;
  const source = event.target.closest?.('[data-explorer-item], [data-explorer-folder]');
  if (!source) return;
  const value = source.dataset.explorerItem || source.dataset.explorerFolder;
  const [section, id] = value.split(':');
  const kind = source.dataset.explorerFolder ? 'folder' : 'item';
  const selected = kind === 'folder' ? state.selectedFolderItems[section] : state.selectedItems[section];
  if (!selected.has(id)) selectExplorerTarget(section, kind, id, false, false);
  state.internalDrag = { section };
  source.classList.add('is-drag-source');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-nocturne-selection', section);
  event.dataTransfer.setData('text/plain', 'Nocturne');
});

document.addEventListener('dragend', clearInternalDrag);

document.addEventListener('dragover', (event) => {
  if (!state.unlocked) return;
  const folder = event.target.closest?.('[data-explorer-folder]');
  if (state.internalDrag && folder) {
    const [section, id] = folder.dataset.explorerFolder.split(':');
    if (section === state.internalDrag.section && !state.selectedFolderItems[section].has(id)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.is-drop-target').forEach((element) => element.classList.remove('is-drop-target'));
      folder.classList.add('is-drop-target');
    }
    return;
  }
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('is-file-dragging');
});

document.addEventListener('dragleave', (event) => {
  const folder = event.target.closest?.('[data-explorer-folder]');
  if (folder && !folder.contains(event.relatedTarget)) folder.classList.remove('is-drop-target');
  if (!event.relatedTarget) document.body.classList.remove('is-file-dragging');
});

document.addEventListener('drop', async (event) => {
  document.body.classList.remove('is-file-dragging');
  if (!state.unlocked) return;
  const folder = event.target.closest?.('[data-explorer-folder]');
  if (state.internalDrag) {
    event.preventDefault();
    const drag = state.internalDrag;
    clearInternalDrag();
    if (!folder) return;
    const [section, folderId] = folder.dataset.explorerFolder.split(':');
    if (section !== drag.section || state.selectedFolderItems[section].has(folderId)) return;
    try {
      setBusy(true);
      let snapshot = state.snapshot;
      const itemIds = [...state.selectedItems[section]];
      const folderIds = [...state.selectedFolderItems[section]];
      if (itemIds.length) snapshot = await apiCall(window.nocturne.updateItemMetadata({ section, ids: itemIds, folderId }));
      if (folderIds.length) snapshot = await apiCall(window.nocturne.moveFolders({ ids: folderIds, parentId: folderId }));
      state.selectedItems[section].clear();
      state.selectedFolderItems[section].clear();
      updateSnapshot(snapshot);
      toast('Перемещено в папку');
    } catch (error) {
      toast(friendlyError(error.message), 'danger');
    } finally { setBusy(false); }
    return;
  }
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  try {
    setBusy(true);
    const target = FILE_IMPORT_SECTIONS.has(state.page) ? { section: state.page, folderId: activeFolderId(state.page) } : {};
    const result = await apiCall(window.nocturne.importPaths(event.dataTransfer.files, target.section || 'auto', target));
    if (!target.section) {
      if (result.documentsAdded && !result.mediaAdded) state.page = 'documents';
      else if (result.mediaAdded) state.page = 'media';
    }
    updateSnapshot(result.snapshot);
    if (result.added) toast(`Добавлено файлов: ${result.added}`);
    else toast('Формат файла не поддерживается.', 'danger');
  } catch (error) {
    toast(friendlyError(error.message), 'danger');
  } finally { setBusy(false); }
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
      state.organizer.passwords.folderId = values.folderId || '';
      state.organizer.passwords.favorites = false;
      entryDialog.close();
      updateSnapshot(snapshot);
      toast(existing ? 'Запись обновлена' : 'Запись добавлена');
    } else if (formId === 'note-form') {
      const values = {
        id: noteForm.elements.namedItem('id').value,
        title: noteForm.elements.namedItem('title').value,
        body: noteForm.elements.namedItem('body').value,
        folderId: noteForm.elements.namedItem('folderId').value,
        tags: noteForm.elements.namedItem('tags').value,
        favorite: noteForm.elements.namedItem('favorite').checked,
      };
      const existing = state.snapshot.notes.find((note) => note.id === values.id);
      if (existing) values.createdAt = existing.createdAt;
      const snapshot = await apiCall(window.nocturne.saveNote(values));
      state.selectedNoteId = values.id || snapshot.notes[0]?.id || null;
      state.organizer.notes.folderId = values.folderId || '';
      state.organizer.notes.favorites = false;
      noteDialog.close();
      updateSnapshot(snapshot);
      toast(existing ? 'Заметка обновлена' : 'Заметка создана');
    } else if (formId === 'otp-form') {
      const values = Object.fromEntries(new FormData(event.target).entries());
      values.favorite = event.target.elements.namedItem('favorite').checked;
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
    } else if (formId === 'backup-export-form') {
      const password = new FormData(event.target).get('password');
      const result = await apiCall(window.nocturne.exportVaultBackup(password));
      if (!result.canceled) { closeSimple(); toast('Резервная копия создана'); }
    } else if (formId === 'backup-import-form') {
      const password = new FormData(event.target).get('password');
      const result = await apiCall(window.nocturne.importVaultBackup(password));
      if (!result.canceled) {
        closeSimple();
        state.exists = true;
        state.page = 'passwords';
        updateSnapshot(result.snapshot);
        toast('Хранилище импортировано');
      }
    } else if (formId === 'folder-form') {
      const values = Object.fromEntries(new FormData(event.target).entries());
      const snapshot = await apiCall(window.nocturne.addFolder(values));
      closeSimple();
      updateSnapshot(snapshot);
      toast('Папка создана');
    } else if (formId === 'folder-rename-form') {
      const values = Object.fromEntries(new FormData(event.target).entries());
      const folder = state.snapshot.folders.find((candidate) => candidate.id === values.id);
      const snapshot = await apiCall(window.nocturne.renameFolder(values.id, values.name));
      closeSimple();
      updateSnapshot(snapshot);
      toast('Папка переименована');
    } else if (formId === 'metadata-form') {
      const values = Object.fromEntries(new FormData(event.target).entries());
      const ids = String(values.ids || '').split(',').filter(Boolean);
      const snapshot = await apiCall(window.nocturne.updateItemMetadata({ section: values.section, ids, folderId: values.folderId || null, tags: values.tags, favorite: Boolean(values.favorite) }));
      state.selectedItems[values.section].clear();
      closeSimple();
      updateSnapshot(snapshot);
      toast('Изменения сохранены');
    } else if (formId === 'text-document-form') {
      const form = new FormData(event.target);
      const snapshot = await apiCall(window.nocturne.createTextDocument(form.get('name'), form.get('type'), '', activeFolderId('documents')));
      const document = snapshot.documents[0];
      state.selectedDocumentId = document.id;
      closeSimple();
      updateSnapshot(snapshot);
      await openDocumentPreview(document.id);
    } else if (formId === 'document-editor-form') {
      const id = event.target.dataset.documentId;
      const text = event.target.elements.namedItem('text').value;
      const snapshot = await apiCall(window.nocturne.saveTextDocument(id, text));
      updateSnapshot(snapshot);
      await openDocumentPreview(id);
      toast('Документ сохранён, предыдущая версия добавлена в историю');
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
  const button = event.target.closest('button, [data-open-media], [data-explorer-item], [data-explorer-folder], [data-select-entry], [data-select-note], [data-select-document]');
  removeContextMenu();
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
      if (button.dataset.closeDialog === 'simple-dialog' && (state.recorder || state.recorderStream)) {
        await stopAudioRecording({ save: false });
        return;
      }
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
    if (button.dataset.setLocale) {
      state.locale = button.dataset.setLocale === 'en' ? 'en' : 'ru';
      await apiCall(window.nocturne.savePreferences({ locale: state.locale }));
      if (state.exists) renderLockScreen(); else renderOnboarding();
      applyUiPreferences();
      return;
    }
    if (button.dataset.helpTopic) {
      state.helpTopic = button.dataset.helpTopic;
      renderMain();
      return;
    }
    if (button.dataset.openFolder !== undefined) {
      const [section, folderId = ''] = button.dataset.openFolder.split(':');
      openFolder(section, folderId);
      return;
    }
    if (button.dataset.explorerFolder && !event.target.closest('button')) {
      if (event.detail > 1) return;
      const [section, id] = button.dataset.explorerFolder.split(':');
      selectExplorerTarget(section, 'folder', id, event.ctrlKey || event.metaKey, false);
      button.focus({ preventScroll: true });
      return;
    }
    if (button.dataset.explorerItem && !event.target.closest('button')) {
      if (event.detail > 1) return;
      const [section, id] = button.dataset.explorerItem.split(':');
      clearTimeout(state.explorerClickTimer);
      state.explorerClickTimer = null;
      selectExplorerTarget(section, 'item', id, event.ctrlKey || event.metaKey, false);
      button.focus({ preventScroll: true });
      return;
    }
    if (button.dataset.contextOpenItem) {
      const [section, id] = button.dataset.contextOpenItem.split(':');
      openExplorerItem(section, id);
      return;
    }
    if (button.dataset.contextCreateFolder !== undefined) {
      const [section, parentId = ''] = button.dataset.contextCreateFolder.split(':');
      showFolderCreateDialog(section, parentId);
      return;
    }
    if (button.dataset.contextFolderFavorite) {
      const [section, id] = button.dataset.contextFolderFavorite.split(':');
      const folder = sectionFolders(section).find((candidate) => candidate.id === id);
      const snapshot = await apiCall(window.nocturne.updateFolderMetadata({ ids: [id], favorite: !folder?.favorite }));
      updateSnapshot(snapshot);
      toast(folder?.favorite ? 'Убрано из избранного' : 'Папка добавлена в избранное');
      return;
    }
    if (button.dataset.contextDeleteFolder) {
      const [section, id] = button.dataset.contextDeleteFolder.split(':');
      state.folderManagerSection = section;
      confirmationDialog({ title: 'Удалить папку вместе с содержимым?', text: 'Папка, вложенные папки и все находящиеся в них элементы будут перемещены в корзину.', action: `delete-folders:${id}`, button: 'Удалить с содержимым', danger: true });
      return;
    }
    if (button.dataset.contextDeleteItem) {
      const [section, id] = button.dataset.contextDeleteItem.split(':');
      confirmationDialog({ title: 'Переместить выбранный элемент в корзину?', text: 'Его можно будет восстановить до окончательной очистки корзины.', action: `delete-items:${section}:${id}`, button: 'В корзину', danger: true });
      return;
    }
    if (button.dataset.moveDestination !== undefined) {
      const [section, folderId = ''] = button.dataset.moveDestination.split(':');
      const itemIds = [...state.selectedItems[section]];
      const folderIds = [...state.selectedFolderItems[section]];
      let snapshot = state.snapshot;
      if (itemIds.length) snapshot = await apiCall(window.nocturne.updateItemMetadata({ section, ids: itemIds, folderId: folderId || null }));
      if (folderIds.length) snapshot = await apiCall(window.nocturne.moveFolders({ ids: folderIds, parentId: folderId || null }));
      state.selectedItems[section].clear();
      state.selectedFolderItems[section].clear();
      closeSimple();
      updateSnapshot(snapshot);
      toast('Перемещено');
      return;
    }
    if (button.dataset.mediaFilter) {
      state.mediaFilter = button.dataset.mediaFilter;
      renderMain();
      return;
    }
    if (button.dataset.organizerFavorites) {
      const section = button.dataset.organizerFavorites;
      state.organizer[section].favorites = !state.organizer[section].favorites;
      state.selectedItems[section].clear();
      state.selectedFolderItems[section].clear();
      renderMain();
      return;
    }
    if (button.dataset.organizerFolderButton !== undefined) {
      const [section, folderId = ''] = button.dataset.organizerFolderButton.split(':');
      state.organizer[section].folderId = folderId;
      state.selectedItems[section].clear();
      renderMain();
      return;
    }
    if (button.dataset.manageFolders) {
      showFolderCreateDialog(button.dataset.manageFolders);
      return;
    }
    if (button.dataset.toggleFolder) {
      const id = button.dataset.toggleFolder;
      if (state.selectedFolders.has(id)) state.selectedFolders.delete(id); else state.selectedFolders.add(id);
      openFolderManager(state.folderManagerSection);
      return;
    }
    if (button.dataset.renameFolder) {
      openRenameFolderDialog(button.dataset.renameFolder);
      return;
    }
    if (button.hasAttribute('data-delete-selected-folders')) {
      const ids = [...state.selectedFolders];
      if (!ids.length) return;
      confirmationDialog({ title: `Удалить выбранные папки (${ids.length})?`, text: 'Папки, вложенные папки и всё их содержимое будут перемещены в корзину.', action: `delete-folders:${ids.join(',')}`, button: 'Удалить с содержимым', danger: true });
      return;
    }
    if (button.dataset.toggleItem) {
      const [section, id] = button.dataset.toggleItem.split(':');
      selectExplorerTarget(section, 'item', id, true, false);
      return;
    }
    if (button.dataset.toggleFavorite) {
      const [section, id] = button.dataset.toggleFavorite.split(':');
      const item = sectionItems(section).find((candidate) => candidate.id === id);
      const snapshot = await apiCall(window.nocturne.updateItemMetadata({ section, ids: [id], favorite: !item?.favorite }));
      updateSnapshot(snapshot);
      return;
    }
    if (button.dataset.clearSelection) {
      state.selectedItems[button.dataset.clearSelection].clear();
      renderMain();
      return;
    }
    if (button.dataset.clearMixed) {
      const section = button.dataset.clearMixed;
      state.selectedItems[section].clear();
      state.selectedFolderItems[section].clear();
      syncExplorerSelection(section);
      return;
    }
    if (button.dataset.bulkEdit) {
      const section = button.dataset.bulkEdit;
      openMoveSelectionDialog(section);
      return;
    }
    if (button.dataset.editMetadata) {
      const [section, id] = button.dataset.editMetadata.split(':');
      if (mediaDialog.open) {
        mediaDialog.close();
        state.viewerMediaId = null;
        mediaContent.replaceChildren();
      }
      openMetadataDialog(section, [id]);
      return;
    }
    if (button.dataset.bulkFavorite) {
      const section = button.dataset.bulkFavorite;
      const snapshot = await apiCall(window.nocturne.updateItemMetadata({ section, ids: [...state.selectedItems[section]], favorite: true }));
      state.selectedItems[section].clear();
      updateSnapshot(snapshot);
      toast('Добавлено в избранное');
      return;
    }
    if (button.dataset.bulkFavoriteMixed) {
      const section = button.dataset.bulkFavoriteMixed;
      let snapshot = state.snapshot;
      const folderIds = [...state.selectedFolderItems[section]];
      const itemIds = [...state.selectedItems[section]];
      if (folderIds.length) snapshot = await apiCall(window.nocturne.updateFolderMetadata({ ids: folderIds, favorite: true }));
      if (itemIds.length) snapshot = await apiCall(window.nocturne.updateItemMetadata({ section, ids: itemIds, favorite: true }));
      state.selectedFolderItems[section].clear();
      state.selectedItems[section].clear();
      updateSnapshot(snapshot);
      toast('Добавлено в избранное');
      return;
    }
    if (button.dataset.bulkDeleteMixed) {
      const section = button.dataset.bulkDeleteMixed;
      const count = state.selectedFolderItems[section].size + state.selectedItems[section].size;
      state.folderManagerSection = section;
      confirmationDialog({ title: `Удалить выбранное (${count})?`, text: 'Выбранные элементы и папки вместе со всем содержимым будут перемещены в корзину.', action: `delete-selection:${section}`, button: 'В корзину', danger: true });
      return;
    }
    if (button.dataset.bulkDelete) {
      const section = button.dataset.bulkDelete;
      const ids = [...state.selectedItems[section]];
      confirmationDialog({ title: `Удалить выбранные элементы (${ids.length})?`, text: 'Элементы будут перемещены в корзину.', action: `delete-items:${section}:${ids.join(',')}`, button: 'В корзину', danger: true });
      return;
    }
    if (button.dataset.page) {
      state.page = button.dataset.page;
      state.query = '';
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
      return confirmationDialog({ title: `Переместить код «${account.issuer || account.account}» в корзину?`, text: 'Секрет останется зашифрованным и может быть восстановлен до окончательной очистки.', action: `delete-otp:${account.id}`, button: 'В корзину', danger: true });
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
      return confirmationDialog({ title: `Переместить «${entry.title}» в корзину?`, text: 'Запись можно будет восстановить до окончательной очистки.', action: `delete-entry:${entry.id}`, button: 'В корзину', danger: true });
    }
    if (button.dataset.deleteNote) {
      const note = state.snapshot.notes.find((item) => item.id === button.dataset.deleteNote);
      return confirmationDialog({ title: `Переместить «${note.title}» в корзину?`, text: 'Заметка и вложения останутся зашифрованными до окончательной очистки.', action: `delete-note:${note.id}`, button: 'В корзину', danger: true });
    }
    if (button.dataset.openMedia) return openMedia(button.dataset.openMedia);
    if (button.dataset.mediaStep) return stepMedia(Number(button.dataset.mediaStep));
    if (button.dataset.previewDocument) {
      await openDocumentPreview(button.dataset.previewDocument);
      return;
    }
    if (button.dataset.previewTrash) {
      await openTrashPreview(button.dataset.previewTrash);
      return;
    }
    if (button.dataset.deleteMedia) {
      const item = findMedia(button.dataset.deleteMedia);
      return confirmationDialog({ title: `Переместить «${item.name}» в корзину?`, text: 'Зашифрованный файл можно будет восстановить до окончательной очистки.', action: `delete-media:${item.id}`, button: 'В корзину', danger: true });
    }
    if (button.dataset.restoreTrash) {
      const snapshot = await apiCall(window.nocturne.restoreTrash(button.dataset.restoreTrash));
      if (mediaDialog.open) mediaDialog.close();
      closeSimple();
      updateSnapshot(snapshot);
      toast('Элемент восстановлен');
      return;
    }
    if (button.dataset.purgeTrash) {
      const item = state.snapshot.trash.find((candidate) => candidate.id === button.dataset.purgeTrash);
      return confirmationDialog({ eyebrow: 'Окончательное удаление', title: `Уничтожить «${item.name}»?`, text: 'Зашифрованные файлы будут перезаписаны и удалены без возможности восстановления.', action: `purge-trash:${item.id}`, button: 'Уничтожить', danger: true });
    }
    if (button.dataset.restoreDocumentVersion) {
      const [documentId, versionId] = button.dataset.restoreDocumentVersion.split(':');
      return confirmationDialog({ title: 'Восстановить эту версию?', text: 'Текущее содержимое сначала будет сохранено в истории.', action: `restore-version:${documentId}:${versionId}`, button: 'Восстановить' });
    }
    if (button.dataset.saveMedia) {
      const result = await apiCall(window.nocturne.saveMedia(button.dataset.saveMedia));
      if (!result.canceled) toast('Расшифрованная копия сохранена');
      return;
    }
    if (button.dataset.copyMedia) {
      await apiCall(window.nocturne.copyMedia(button.dataset.copyMedia));
      toast('Изображение скопировано');
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
    if (action === 'new-note') openNote();
    if (action === 'new-otp') openOtpImportDialog();
    if (action === 'onboarding-import') openBackupImportDialog(true);
    if (action === 'backup-choice') openBackupChoiceDialog();
    if (action === 'backup-export') openBackupExportDialog();
    if (action === 'backup-import') openBackupImportDialog(false);
    if (action === 'save-appearance') {
      state.locale = document.querySelector('#setting-locale')?.value === 'en' ? 'en' : 'ru';
      state.theme = ['light', 'dark', 'system'].includes(document.querySelector('#setting-theme')?.value) ? document.querySelector('#setting-theme').value : 'light';
      await apiCall(window.nocturne.savePreferences({ locale: state.locale, theme: state.theme }));
      applyUiPreferences();
      renderMain();
      toast(state.locale === 'en' ? 'Appearance updated' : 'Оформление обновлено');
    }
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
      const result = await apiCall(window.nocturne.importMedia(activeFolderId('media')));
      if (!result.canceled) { updateSnapshot(result.snapshot); toast(`Добавлено файлов: ${result.added}`); }
    }
    if (action === 'import-documents') {
      setBusy(true);
      const result = await apiCall(window.nocturne.importDocuments(activeFolderId('documents')));
      if (!result.canceled) { updateSnapshot(result.snapshot); toast(`Добавлено документов: ${result.added}`); }
    }
    if (action === 'capture-region') {
      setBusy(true);
      toast('Выберите область в инструменте Windows');
      const snapshot = await apiCall(window.nocturne.captureRegion(activeFolderId('media')));
      state.page = 'media';
      updateSnapshot(snapshot);
      toast('Снимок добавлен в медиатеку');
    }
    if (action === 'new-text-document') openNewTextDocumentDialog();
    if (action === 'record-audio') await openAudioRecorder();
    if (action === 'start-recording') startAudioRecording();
    if (action === 'stop-recording') await stopAudioRecording({ save: true });
    if (action === 'cancel-recording') await stopAudioRecording({ save: false });
    if (action === 'empty-trash') confirmationDialog({ eyebrow: 'Окончательное удаление', title: 'Очистить всю корзину?', text: 'Все находящиеся в ней данные и зашифрованные файлы будут уничтожены без возможности восстановления.', phrase: 'ОЧИСТИТЬ КОРЗИНУ', action: 'empty-trash', button: 'Уничтожить всё', danger: true });
    if (action === 'save-settings') await saveSettings();
    if (action === 'save-system-settings') await saveSystemSettings();
    if (action === 'configure-quick') openQuickDialog();
    if (action === 'quick-none') openDisableQuickDialog();
    if (action === 'quick-pin') openPinDialog();
    if (action === 'quick-pattern') openPatternConfigDialog();
    if (action === 'change-password') openChangePasswordDialog();
    if (action === 'destroy-now') confirmationDialog({ eyebrow: 'Необратимое действие', title: 'Уничтожить локальное хранилище?', text: 'Ключ будет уничтожен, а контейнер и зашифрованные медиафайлы — перезаписаны и удалены.', phrase: 'УДАЛИТЬ НАВСЕГДА', action: 'destroy-vault', button: 'Уничтожить', danger: true, requireMasterPassword: true });
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
    toast('Запись перемещена в корзину');
  }
  if (action.startsWith('delete-note:')) {
    const snapshot = await apiCall(window.nocturne.deleteNote(action.split(':')[1]));
    closeSimple();
    state.selectedNoteId = null;
    updateSnapshot(snapshot);
    toast('Заметка перемещена в корзину');
  }
  if (action.startsWith('delete-otp:')) {
    const snapshot = await apiCall(window.nocturne.deleteOtp(action.split(':')[1]));
    closeSimple();
    state.otpCodes = {};
    updateSnapshot(snapshot);
    toast('TOTP-аккаунт перемещён в корзину');
  }
  if (action.startsWith('delete-media:')) {
    const snapshot = await apiCall(window.nocturne.deleteMedia(action.split(':')[1]));
    if (mediaDialog.open) mediaDialog.close();
    closeSimple();
    updateSnapshot(snapshot);
    toast('Файл перемещён в корзину');
  }
  if (action.startsWith('purge-trash:')) {
    const snapshot = await apiCall(window.nocturne.purgeTrash(action.split(':')[1]));
    if (mediaDialog.open) mediaDialog.close();
    closeSimple();
    updateSnapshot(snapshot);
    toast('Элемент уничтожен окончательно');
  }
  if (action.startsWith('restore-version:')) {
    const [, documentId, versionId] = action.split(':');
    const snapshot = await apiCall(window.nocturne.restoreDocumentVersion(documentId, versionId));
    closeSimple();
    updateSnapshot(snapshot);
    await openDocumentPreview(documentId);
    toast('Версия восстановлена');
  }
  if (action.startsWith('delete-folders:')) {
    const ids = action.slice('delete-folders:'.length).split(',').filter(Boolean);
    const snapshot = await apiCall(window.nocturne.deleteFolders(ids));
    const section = state.folderManagerSection;
    state.selectedFolders.clear();
    state.organizer[section].folderId = '';
    closeSimple();
    updateSnapshot(snapshot);
    toast('Папки и содержимое перемещены в корзину');
  }
  if (action.startsWith('delete-selection:')) {
    const section = action.slice('delete-selection:'.length);
    const folderIds = [...state.selectedFolderItems[section]];
    const selectedTrees = new Set(folderIds.flatMap((id) => [...folderDescendants(section, id)]));
    const itemIds = [...state.selectedItems[section]].filter((id) => {
      const item = sectionItems(section).find((candidate) => candidate.id === id);
      return item && !selectedTrees.has(item.folderId);
    });
    let snapshot = state.snapshot;
    if (folderIds.length) snapshot = await apiCall(window.nocturne.deleteFolders(folderIds));
    if (itemIds.length) snapshot = await apiCall(window.nocturne.deleteItems(section, itemIds));
    state.selectedFolderItems[section].clear();
    state.selectedItems[section].clear();
    state.organizer[section].folderId = '';
    closeSimple();
    updateSnapshot(snapshot);
    toast('Выбранное перемещено в корзину');
  }
  if (action.startsWith('delete-items:')) {
    const [, section, joined = ''] = action.split(':');
    const ids = joined.split(',').filter(Boolean);
    const snapshot = await apiCall(window.nocturne.deleteItems(section, ids));
    state.selectedItems[section].clear();
    closeSimple();
    updateSnapshot(snapshot);
    toast('Выбранные элементы перемещены в корзину');
  }
  if (action === 'empty-trash') {
    const snapshot = await apiCall(window.nocturne.emptyTrash());
    closeSimple();
    updateSnapshot(snapshot);
    toast('Корзина очищена окончательно');
  }
  if (action === 'enable-wipe') {
    closeSimple();
    await persistSettings(true);
  }
  if (action === 'destroy-vault') {
    const currentPassword = document.querySelector('#confirmation-master-password')?.value || '';
    if (!currentPassword) return toast('Введите текущий мастер-пароль.', 'danger');
    await apiCall(window.nocturne.destroyVault(currentPassword));
    closeSimple();
    renderWiped();
  }
}

function organizerTitle(section) {
  return ({ passwords: 'Пароли', notes: 'Заметки', media: 'Медиа', documents: 'Документы', otp: 'Коды' })[section] || 'Элементы';
}

function openFolderManager(section) {
  state.folderManagerSection = section;
  const folders = sectionFolders(section);
  const selected = state.selectedFolders;
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">${escapeHtml(organizerTitle(section))}</p><h2>Папки</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div>
    <form id="folder-form" class="folder-create-form"><input type="hidden" name="section" value="${section}"><label class="field"><span>Название</span><input name="name" maxlength="64" required placeholder="Новая папка"></label><label class="field"><span>Родительская папка</span><select name="parentId"><option value="">Нет</option>${folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${'— '.repeat(folderDepth(section, folder))}${escapeHtml(folder.name)}</option>`).join('')}</select></label><button class="button button--primary button--compact" type="submit">Создать</button></form>
    <div class="folder-manager-list">${folders.length ? folders.map((folder) => `<div class="folder-manager-row" style="--folder-depth:${folderDepth(section, folder)}"><button class="item-select ${selected.has(folder.id) ? 'is-selected' : ''}" data-toggle-folder="${folder.id}" aria-label="Выбрать">${selected.has(folder.id) ? icon('check') : ''}</button><span>${icon('folder')}<strong>${escapeHtml(folder.name)}</strong></span><em>${sectionItems(section).filter((item) => item.folderId === folder.id).length}</em><button class="icon-button" data-rename-folder="${folder.id}" aria-label="Переименовать">${icon('edit')}</button></div>`).join('') : '<div class="plain-empty"><strong>Папок нет</strong><span>Создайте первую папку выше.</span></div>'}</div>
    <div class="dialog__footer"><button class="button button--danger button--compact" data-delete-selected-folders ${selected.size ? '' : 'disabled'}>${icon('trash')} Удалить выбранные с содержимым</button><button class="button button--ghost" data-close-dialog="simple-dialog">Готово</button></div>`);
}

function openRenameFolderDialog(id) {
  const folder = state.snapshot.folders.find((candidate) => candidate.id === id);
  if (!folder) return;
  openSimple(`<form id="folder-rename-form"><input type="hidden" name="id" value="${escapeHtml(id)}"><div class="dialog__header"><div><p class="eyebrow">Папка</p><h2>Переименовать</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><label class="field"><span>Название</span><input name="name" maxlength="64" required value="${escapeHtml(folder.name)}" autofocus></label><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Сохранить</button></div></form>`);
}

function openMetadataDialog(section, ids) {
  const selected = sectionItems(section).filter((item) => ids.includes(item.id));
  if (!selected.length) return;
  const one = selected.length === 1 ? selected[0] : null;
  const folders = sectionFolders(section);
  openSimple(`<form id="metadata-form"><input type="hidden" name="section" value="${section}"><input type="hidden" name="ids" value="${escapeHtml(ids.join(','))}"><div class="dialog__header"><div><p class="eyebrow">${escapeHtml(organizerTitle(section))}</p><h2>${one ? 'Организовать' : `Изменить ${selected.length}`}</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><label class="field"><span>Папка</span><select name="folderId"><option value="">Корень раздела</option>${folders.map((folder) => `<option value="${escapeHtml(folder.id)}" ${one?.folderId === folder.id ? 'selected' : ''}>${'— '.repeat(folderDepth(section, folder))}${escapeHtml(folder.name)}</option>`).join('')}</select></label><label class="field"><span>Теги через запятую</span><input name="tags" maxlength="400" value="${escapeHtml(one ? (one.tags || []).join(', ') : '')}" placeholder="работа, важное"></label><label class="field field--check"><input name="favorite" type="checkbox" ${one?.favorite ? 'checked' : ''}><span>В избранном</span></label><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Применить</button></div></form>`);
}

function openMoveSelectionDialog(section) {
  const itemIds = [...state.selectedItems[section]];
  const folderIds = [...state.selectedFolderItems[section]];
  if (!itemIds.length && !folderIds.length) return;
  const forbidden = new Set(folderIds.flatMap((id) => [...folderDescendants(section, id)]));
  const destinations = sectionFolders(section).filter((folder) => !forbidden.has(folder.id));
  const count = itemIds.length + folderIds.length;
  const destinationButton = (id, name, depth = 0) => `<button type="button" class="folder-destination" data-move-destination="${section}:${escapeHtml(id)}"><span class="folder-destination__icon">${icon('folder')}</span><span><strong>${escapeHtml(name)}</strong><small>${id ? `Уровень ${depth + 1}` : 'В корень раздела'}</small></span></button>`;
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">${escapeHtml(organizerTitle(section))}</p><h2>Переместить ${count}</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">Выберите папку назначения. Папка переносится вместе со всем содержимым.</p><div class="folder-destination-list">${destinationButton('', 'Корень раздела')}${destinations.map((folder) => destinationButton(folder.id, folderName(section, folder.id), folderDepth(section, folder))).join('')}</div><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button></div>`);
}

function openNewTextDocumentDialog() {
  openSimple(`<form id="text-document-form"><div class="dialog__header"><div><p class="eyebrow">Документы</p><h2>Новый текст</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><label class="field"><span>Название</span><input name="name" maxlength="200" required autofocus placeholder="Например, Черновик"></label><label class="field"><span>Формат</span><select name="type"><option value="text/markdown">Markdown (.md)</option><option value="text/plain">Обычный текст (.txt)</option></select></label><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Создать и открыть</button></div></form>`);
}

async function openAudioRecorder() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('INVALID_RECORDED_AUDIO');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
  state.recorderStream = stream;
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">Медиатека</p><h2>Голосовая запись</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><div class="recorder-panel"><span class="recorder-mark">${icon('microphone')}</span><strong data-recorder-status>Микрофон готов</strong><small data-recorder-time>Запись ещё не началась</small><label class="field"><span>Название</span><input id="recording-name" maxlength="200" value="Голосовая запись ${new Date().toLocaleDateString('ru')}"></label></div><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="button" class="button button--primary" data-action="start-recording">Начать запись</button></div>`);
}

function recordingMimeType() {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function startAudioRecording() {
  if (!state.recorderStream || state.recorder) return;
  state.recorderChunks = [];
  const preferred = recordingMimeType();
  const recorder = new MediaRecorder(state.recorderStream, preferred ? { mimeType: preferred } : undefined);
  state.recorder = recorder;
  state.recordingStartedAt = Date.now();
  recorder.ondataavailable = (event) => { if (event.data?.size) state.recorderChunks.push(event.data); };
  recorder.start(1000);
  const panel = document.querySelector('.recorder-panel');
  panel?.classList.add('is-recording');
  const status = document.querySelector('[data-recorder-status]');
  if (status) status.textContent = 'Идёт запись';
  const footer = simpleContent.querySelector('.dialog__footer');
  if (footer) footer.innerHTML = `<button type="button" class="button button--ghost" data-action="cancel-recording">Отменить</button><button type="button" class="button button--primary" data-action="stop-recording">Остановить и сохранить</button>`;
  state.recordingTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.recordingStartedAt) / 1000);
    const value = document.querySelector('[data-recorder-time]');
    if (value) value.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    if (elapsed >= 600) stopAudioRecording({ save: true }).catch((error) => toast(friendlyError(error.message), 'danger'));
  }, 250);
}

async function stopAudioRecording({ save }) {
  const recorder = state.recorder;
  const stream = state.recorderStream;
  if (!recorder && !stream) return;
  if (recorder && recorder.state !== 'inactive') {
    await new Promise((resolve) => { recorder.addEventListener('stop', resolve, { once: true }); recorder.stop(); });
  }
  clearInterval(state.recordingTimer);
  stream?.getTracks().forEach((track) => track.stop());
  const chunks = state.recorderChunks;
  const mime = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
  state.recorder = null;
  state.recorderStream = null;
  state.recorderChunks = [];
  state.recordingStartedAt = 0;
  state.recordingTimer = null;
  if (!save || !chunks.length) { closeSimple(); return; }
  const blob = new Blob(chunks, { type: mime });
  if (blob.size > 64 * 1024 * 1024) { closeSimple(); throw new Error('INVALID_RECORDED_AUDIO'); }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const name = document.querySelector('#recording-name')?.value || 'Голосовая запись';
  try {
    const snapshot = await apiCall(window.nocturne.importRecordedAudio(bytes, name, mime, activeFolderId('media')));
    closeSimple();
    updateSnapshot(snapshot);
    toast('Запись сохранена в зашифрованной медиатеке');
  } finally { bytes.fill(0); }
}

function openOtpImportDialog() {
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">Коды доступа</p><h2>Добавить TOTP</h2></div><button class="icon-button" data-close-dialog="simple-dialog">×</button></div><div class="otp-import-options"><button data-action="otp-import-qr"><span>${icon('image')}</span><strong>QR из файла</strong><small>PNG, JPG или WebP</small></button><button data-action="otp-import-clipboard"><span>${icon('copy')}</span><strong>Из буфера</strong><small>QR-картинка или otpauth://</small></button><button data-action="otp-uri"><span>${icon('link')}</span><strong>Ссылка otpauth</strong><small>Вставить URI вручную</small></button><button data-action="otp-manual"><span>${icon('otp')}</span><strong>Ввести секрет</strong><small>Base32 и параметры</small></button></div>`);
}

function openOtpDialog(account = null) {
  const folders = sectionFolders('otp');
  openSimple(`<form id="otp-form"><input type="hidden" name="id" value="${escapeHtml(account?.id || '')}"><div class="dialog__header"><div><p class="eyebrow">TOTP</p><h2>${account ? 'Изменить аккаунт' : 'Ручное добавление'}</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><div class="form-grid"><label class="field"><span>Сервис</span><input name="issuer" maxlength="100" value="${escapeHtml(account?.issuer || '')}" placeholder="GitHub"></label><label class="field"><span>Аккаунт</span><input name="account" maxlength="180" required value="${escapeHtml(account?.account || '')}" placeholder="name@example.com"></label><label class="field field--full"><span>${account ? 'Новый секрет Base32' : 'Секрет Base32'}</span><input name="secret" autocomplete="off" spellcheck="false" ${account ? '' : 'required'} placeholder="${account ? 'Оставьте пустым, чтобы не менять' : 'JBSW Y3DP EHPK 3PXP'}"></label><label class="field"><span>Папка</span><select name="folderId"><option value="">Корень раздела</option>${folders.map((folder) => `<option value="${escapeHtml(folder.id)}" ${account?.folderId === folder.id ? 'selected' : ''}>${'— '.repeat(folderDepth('otp', folder))}${escapeHtml(folder.name)}</option>`).join('')}</select></label><label class="field"><span>Теги</span><input name="tags" maxlength="400" value="${escapeHtml((account?.tags || []).join(', '))}" placeholder="работа, почта"></label><label class="field"><span>Алгоритм</span><select name="algorithm">${['SHA1', 'SHA256', 'SHA512'].map((value) => `<option ${account?.algorithm === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label class="field"><span>Цифр</span><select name="digits">${[6, 8].map((value) => `<option value="${value}" ${Number(account?.digits || 6) === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label class="field"><span>Период</span><select name="period">${[30, 60].map((value) => `<option value="${value}" ${Number(account?.period || 30) === value ? 'selected' : ''}>${value} секунд</option>`).join('')}</select></label><label class="field field--check"><input name="favorite" type="checkbox" ${account?.favorite ? 'checked' : ''}><span>В избранном</span></label></div><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">${account ? 'Сохранить' : 'Добавить код'}</button></div></form>`);
}

function openOtpUriDialog() {
  openSimple(`<form id="otp-uri-form"><div class="dialog__header"><div><p class="eyebrow">TOTP</p><h2>Импортировать ссылку</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><label class="field"><span>Ссылка otpauth://</span><textarea name="uri" rows="5" required autocomplete="off" spellcheck="false" placeholder="otpauth://totp/Service:account?..."></textarea></label><p class="field-hint">Ссылка содержит секрет. Она не попадёт в историю буфера Nocturne.</p><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Импортировать</button></div></form>`);
}

function openQuickDialog() {
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">Быстрый доступ</p><h2>Способ разблокировки</h2></div><button class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">После запуска сначала потребуется мастер-пароль. Затем PIN или рисунок работают до полного завершения приложения.</p><div class="dialog-choice-list"><button class="button button--ghost" data-action="quick-pin">PIN-код из 6–12 цифр</button><button class="button button--ghost" data-action="quick-pattern">Рисунок по точкам</button><button class="button button--ghost" data-action="quick-none">Только мастер-пароль</button></div>`);
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
  openSimple(`<form id="change-password-form"><div class="dialog__header"><div><p class="eyebrow">Мастер-пароль</p><h2>Изменить пароль</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><div class="auth-form"><label class="field"><span>Текущий пароль</span><input name="currentPassword" type="password" maxlength="256" required autocomplete="current-password"></label><label class="field"><span>Новый пароль</span><input name="password" type="password" minlength="14" maxlength="256" required autocomplete="new-password" placeholder="Не менее 14 символов"></label><label class="field"><span>Повторите новый пароль</span><input name="confirm" type="password" minlength="14" maxlength="256" required autocomplete="new-password"></label><button type="submit" class="button button--primary">Изменить</button></div></form>`);
}

function openBackupChoiceDialog() {
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">Данные</p><h2>Резервная копия</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">Копия включает записи, папки, коды и все зашифрованные файлы.</p><div class="backup-choice"><button data-action="backup-export"><span>${icon('upload')}</span><strong>Экспорт</strong><small>Создать файл резервной копии</small></button><button data-action="backup-import"><span>${icon('folder')}</span><strong>Импорт</strong><small>Заменить текущее хранилище</small></button></div>`);
}

function openBackupExportDialog() {
  openSimple(`<form id="backup-export-form"><div class="dialog__header"><div><p class="eyebrow">Резервная копия</p><h2>Экспорт хранилища</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">Копия останется зашифрованной тем же мастер-паролем.</p><label class="field"><span>Текущий мастер-пароль</span><input name="password" type="password" maxlength="256" autocomplete="current-password" required autofocus></label><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Создать резервную копию</button></div></form>`);
}

function openBackupImportDialog(onboarding = false) {
  openSimple(`<form id="backup-import-form"><div class="dialog__header"><div><p class="eyebrow">Резервная копия</p><h2>Импорт хранилища</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div><p class="muted">${onboarding ? 'Выберите резервную копию и введите её мастер-пароль.' : 'Текущее хранилище будет заменено только после полной проверки выбранной копии.'}</p><label class="field"><span>Мастер-пароль резервной копии</span><input name="password" type="password" maxlength="256" autocomplete="current-password" required autofocus></label><div class="dialog__footer"><button type="button" class="button button--ghost" data-close-dialog="simple-dialog">Отмена</button><button type="submit" class="button button--primary">Выбрать файл и импортировать</button></div></form>`);
}

async function saveSettings() {
  const next = { ...state.snapshot.settings };
  const value = (selector) => document.querySelector(selector);
  if (value('#setting-timeout')) next.autoLockMinutes = Number(value('#setting-timeout').value);
  if (value('#setting-minimize')) next.lockOnMinimize = value('#setting-minimize').checked;
  if (value('#setting-system')) next.lockOnSystemLock = value('#setting-system').checked;
  if (value('#setting-clipboard')) next.clipboardSeconds = Number(value('#setting-clipboard').value);
  if (value('#setting-screen-protection')) next.screenProtection = value('#setting-screen-protection').checked;
  if (value('#setting-focus-blur')) next.blurOnFocusLoss = value('#setting-focus-blur').checked;
  if (value('#setting-trash-retention')) next.trashRetentionDays = Number(value('#setting-trash-retention').value);
  if (value('#setting-wipe')) next.wipeEnabled = value('#setting-wipe').checked;
  if (value('#setting-wipe-threshold')) next.wipeThreshold = Number(value('#setting-wipe-threshold').value);
  if (next.wipeEnabled && !state.snapshot.settings.wipeEnabled) {
    state.pendingSettings = next;
    return confirmationDialog({ eyebrow: 'Опасная настройка', title: 'Включить автоматическое уничтожение?', text: `После ${next.wipeThreshold} неверных попыток локальный ключ и все файлы хранилища будут уничтожены.`, phrase: 'Я ПОНИМАЮ РИСК', action: 'enable-wipe', button: 'Включить', danger: true });
  }
  await persistSettings(false, next);
}

async function saveSystemSettings() {
  const autostart = document.querySelector('#setting-autostart')?.checked ?? state.launchAtStartup;
  const retention = Number(document.querySelector('#setting-trash-retention')?.value || state.snapshot.settings.trashRetentionDays);
  const [result, snapshot] = await Promise.all([
    apiCall(window.nocturne.setAutostart(autostart)),
    apiCall(window.nocturne.saveSettings({ trashRetentionDays: retention })),
  ]);
  state.launchAtStartup = result.enabled;
  updateSnapshot(snapshot);
  toast('Настройки Windows сохранены');
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
  mediaContent.innerHTML = `<div class="media-preview"><div class="media-preview__stage">${preview}</div>${sequence.length > 1 ? `<button class="media-nav media-nav--previous" data-media-step="-1" aria-label="Предыдущий файл" ${index <= 0 ? 'disabled' : ''}>‹</button><button class="media-nav media-nav--next" data-media-step="1" aria-label="Следующий файл" ${index >= sequence.length - 1 ? 'disabled' : ''}>›</button>` : ''}<div class="media-counter">${index + 1} / ${sequence.length}</div></div><div class="media-actionbar"><div class="media-actionbar__name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div><div class="media-actionbar__buttons">${item.type.startsWith('image/') ? `<button class="button button--ghost button--compact" data-copy-media="${id}">${icon('copy')} Копировать</button>` : ''}<button class="button button--ghost button--compact" data-edit-metadata="media:${id}">${icon('folder')} Организовать</button><button class="button button--ghost button--compact" data-save-media="${id}">${icon('upload')} Сохранить на ПК</button><button class="button button--ghost button--compact" data-rename-media="${id}">${icon('edit')} Переименовать</button><button class="button button--danger button--compact" data-delete-media="${id}">${icon('trash')} Удалить</button></div></div>`;
  if (!mediaDialog.open) mediaDialog.showModal();
}

function mediaSequence(id) {
  const library = organizerItems('media');
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

async function openTrashPreview(recordId) {
  const preview = await apiCall(window.nocturne.previewTrash(recordId));
  const item = preview.item;
  if (preview.entityType === 'document') return openDocumentPreview(item.id, { readOnly: true, trashRecordId: recordId });
  if (preview.entityType === 'media') {
    state.viewerMediaId = null;
    const body = item.type.startsWith('image/') ? `<img src="${item.url}" alt="${escapeHtml(item.name)}">` : item.type.startsWith('video/') ? `<video src="${item.url}" controls autoplay></video>` : `<div class="audio-player"><div class="audio-player__mark">${icon('audio')}</div><strong>${escapeHtml(item.name)}</strong><audio src="${item.url}" controls autoplay></audio></div>`;
    mediaContent.innerHTML = `<div class="media-preview"><div class="media-preview__stage">${body}</div></div><div class="media-actionbar"><div class="media-actionbar__name">${escapeHtml(item.name)}</div><div class="media-actionbar__buttons"><button class="button button--ghost button--compact" data-restore-trash="${recordId}">Восстановить</button><button class="button button--danger button--compact" data-purge-trash="${recordId}">Удалить окончательно</button></div></div>`;
    if (!mediaDialog.open) mediaDialog.showModal();
    return;
  }
  const fields = preview.entityType === 'entry'
    ? `<dl class="trash-preview-fields"><div><dt>Название</dt><dd>${escapeHtml(item.title)}</dd></div><div><dt>Логин</dt><dd>${escapeHtml(item.username || 'Не указан')}</dd></div><div><dt>Пароль</dt><dd class="trash-secret"><input name="trashPassword" type="password" readonly value="${escapeHtml(item.password || '')}"><button class="icon-button" data-toggle-password="trashPassword" aria-label="Показать пароль">${icon('eye')}</button></dd></div>${item.url ? `<div><dt>Сайт</dt><dd>${escapeHtml(item.url)}</dd></div>` : ''}${item.notes ? `<div><dt>Заметка</dt><dd>${escapeHtml(item.notes)}</dd></div>` : ''}</dl>`
    : preview.entityType === 'note'
      ? `<article class="trash-note-preview"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body || 'Пустая заметка')}</p>${preview.attachments?.length ? `<div class="note-photo-strip">${preview.attachments.map((attachment) => `<figure><img src="${attachment.url}" alt="${escapeHtml(attachment.name)}"><figcaption>${escapeHtml(attachment.name)}</figcaption></figure>`).join('')}</div>` : ''}</article>`
      : `<div class="trash-otp-preview"><span>${icon('otp')}</span><strong>${escapeHtml(item.issuer || item.account)}</strong><small>${escapeHtml(item.account || '')}</small><code>${formatOtpCode(item.code, item.digits)}</code></div>`;
  openSimple(`<div class="dialog__header"><div><p class="eyebrow">Корзина · только просмотр</p><h2>${escapeHtml(item.title || item.issuer || item.account || 'Удалённый объект')}</h2></div><button type="button" class="icon-button" data-close-dialog="simple-dialog">×</button></div>${fields}<div class="dialog__footer"><button class="button button--ghost" data-restore-trash="${recordId}">Восстановить</button><button class="button button--danger" data-purge-trash="${recordId}">Удалить окончательно</button></div>`);
}

async function openDocumentPreview(id, { readOnly = false, trashRecordId = null } = {}) {
  const preview = await apiCall(window.nocturne.previewDocument(id));
  const body = preview.kind === 'pdf'
    ? `<iframe class="document-pdf" src="${preview.url}" title="${escapeHtml(preview.name)}"></iframe>`
    : preview.editable && !readOnly
      ? `<form id="document-editor-form" class="document-editor" data-document-id="${id}"><textarea name="text" maxlength="5242880" spellcheck="false" aria-label="Содержимое документа">${escapeHtml(preview.text)}</textarea><div class="document-editor__bar"><span>UTF-8</span><button type="submit" class="button button--primary button--compact">Сохранить версию</button></div></form>`
      : `<pre class="document-office-text">${escapeHtml(preview.text || 'В документе не найден текст для отображения.')}</pre>`;
  const versions = !readOnly && preview.versions?.length
    ? `<aside class="document-history"><header><strong>История</strong><span>${preview.versions.length}</span></header>${preview.versions.map((version) => `<button data-restore-document-version="${id}:${version.id}"><span>${formatDate(version.createdAt)}</span><small>${formatBytes(version.size)}</small></button>`).join('')}</aside>`
    : '';
  mediaContent.innerHTML = `<div class="document-reader"><header class="document-reader__head"><span>${escapeHtml(preview.name)}</span><small>${readOnly ? 'Корзина · только просмотр' : preview.kind === 'pdf' ? 'PDF' : preview.editable ? 'Редактор' : 'Просмотр текста'}</small></header><div class="document-reader__workspace ${versions ? 'has-history' : ''}"><div class="document-reader__body">${body}</div>${versions}</div></div><div class="media-actionbar"><div class="media-actionbar__name">${escapeHtml(preview.name)}</div><div class="media-actionbar__buttons">${trashRecordId ? `<button class="button button--ghost button--compact" data-restore-trash="${trashRecordId}">Восстановить</button><button class="button button--danger button--compact" data-purge-trash="${trashRecordId}">Удалить окончательно</button>` : `<button class="button button--ghost button--compact" data-save-media="${id}">${icon('upload')} Сохранить на ПК</button>`}</div></div>`;
  if (!mediaDialog.open) mediaDialog.showModal();
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

window.nocturne.onLocked(({ quickUnlockAvailable, quickUnlockMode }) => {
  state.quickUnlockAvailable = quickUnlockAvailable;
  state.quickUnlockMode = quickUnlockMode || 'password';
  renderLockScreen();
});
window.nocturne.onWiped(renderWiped);
window.nocturne.onPrivacyConceal((concealed) => document.body.classList.toggle('is-privacy-concealed', concealed));
window.nocturne.onExternalImportsPending((count) => {
  state.pendingExternalImports = count;
  if (state.unlocked) consumeExternalImports();
});

async function bootstrap() {
  try {
    const data = await apiCall(window.nocturne.bootstrap());
    state.version = data.version || state.version;
    state.exists = data.exists;
    state.quickUnlockAvailable = data.quickUnlockAvailable;
    state.quickUnlockMode = data.quickUnlockMode || 'password';
    state.launchAtStartup = Boolean(data.launchAtStartup);
    state.pendingExternalImports = Number(data.pendingExternalImports) || 0;
    state.locale = data.preferences?.locale === 'en' ? 'en' : 'ru';
    state.theme = ['light', 'dark', 'system'].includes(data.preferences?.theme) ? data.preferences.theme : 'light';
    applyUiPreferences();
    if (!data.exists) renderOnboarding();
    else if (data.unlocked && data.snapshot) updateSnapshot(data.snapshot);
    else renderLockScreen();
  } catch {
    appRoot.innerHTML = '<div class="wipe-screen"><div><h1>Не удалось запустить приложение</h1><p>Проверьте права доступа к локальной папке приложения.</p></div></div>';
  }
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (state.theme === 'system') applyUiPreferences();
});

bootstrap();
