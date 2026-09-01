const React = require('react');
const { createRoot } = require('react-dom/client');
const { useEffect, useMemo, useRef, useState } = React;

const api = window.nocturneQuick;
const call = async (promise) => { const result = await promise; if (!result?.ok) throw new Error(result?.error || 'UNKNOWN'); return result.data; };
let quickPreferences = { locale: 'ru', theme: 'light' };
const QUICK_EN = new Map(Object.entries({
  'Буфер': 'Clipboard', 'Буфер обмена': 'Clipboard', 'Скриншоты': 'Screenshots', 'Заметки': 'Notes', 'Пароли': 'Passwords', 'Коды': 'Codes', 'Коды доступа': 'Access codes', 'Документы': 'Documents',
  'Открыть': 'Open', 'Очистить всё': 'Clear all', 'Скопировать': 'Copy', 'Удалить': 'Delete', 'Сохранить': 'Save', 'Сохранить на ПК': 'Save to PC', 'Назад': 'Back',
  'Закрытый раздел': 'Locked section', 'Быстрый вход': 'Quick sign-in', 'Введите PIN': 'Enter PIN', 'Введите мастер-пароль': 'Enter master password', 'Проведите рисунок': 'Draw your pattern', 'Открыть хранилище': 'Unlock vault', 'Проверка…': 'Checking…',
  'Мастер-пароль': 'Master password', 'Войти мастер-паролем': 'Use master password', 'Вернуться к PIN': 'Return to PIN', 'Вернуться к рисунку': 'Return to pattern', 'Графический ключ': 'Pattern',
  'Сначала создайте хранилище в основном окне.': 'Create a vault in the main window first.', 'В хранилище пока ничего нет.': 'The vault is empty.', 'Выберите название слева.': 'Select an item on the left.',
  'Новый текст из буфера появится здесь.': 'New clipboard text will appear here.', 'Скопированный снимок экрана появится здесь.': 'Copied screenshots will appear here.', 'Добавьте TOTP-код в основном окне.': 'Add a TOTP code in the main window.',
  'Логин': 'Username', 'Пароль': 'Password', 'Адрес': 'Address', 'Комментарий': 'Note', 'Не указан': 'Not specified', 'Показать': 'Show', 'Скрыть': 'Hide', 'Учётная запись': 'Account', 'Пустая заметка': 'Empty note',
  'Защищённый документ': 'Protected document', 'Смотреть': 'View', 'Свернуть': 'Collapse', 'Развернуть': 'Expand'
}));
const QUICK_RU = new Map([...QUICK_EN].map(([russian, english]) => [english, russian]));

function resolvedQuickTheme() {
  if (quickPreferences.theme !== 'system') return quickPreferences.theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyQuickPreferences(preferences = quickPreferences, root = document) {
  quickPreferences = {
    locale: preferences?.locale === 'en' ? 'en' : 'ru',
    theme: ['light', 'dark', 'system'].includes(preferences?.theme) ? preferences.theme : 'light',
  };
  document.documentElement.lang = quickPreferences.locale;
  document.body.dataset.theme = resolvedQuickTheme();
  const translations = quickPreferences.locale === 'en' ? QUICK_EN : QUICK_RU;
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

const quickLocalizationObserver = new MutationObserver((records) => {
  if (quickPreferences.locale !== 'en') return;
  for (const record of records) for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) applyQuickPreferences(quickPreferences, node);
});
quickLocalizationObserver.observe(document.body, { childList: true, subtree: true });

const time = (value) => new Intl.DateTimeFormat(quickPreferences.locale === 'en' ? 'en' : 'ru', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(value));

function Glyph({ name }) {
  const paths = {
    clip: <><path d="M9 5h6M9 3h6a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1V5a2 2 0 0 1 2-2Z"/><path d="M8 11h8M8 15h6"/></>,
    shots: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m5 17 5-5 4 4 2-2 3 3"/><circle cx="16" cy="9" r="1.5"/></>,
    notes: <><path d="M5 3h11l3 3v15H5Z"/><path d="M15 3v4h4M8 11h8M8 15h6"/></>,
    passwords: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></>,
    otp: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="6"/><path d="m12 8 2.6 4.5-4.6 1.7"/></>,
    documents: <><path d="M6 3h9l4 4v14H6Z"/><path d="M15 3v5h5M9 12h7M9 16h7"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    open: <><path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v7H4V6h7"/></>,
    save: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Empty({ children }) { return <div className="empty"><span>—</span><p>{children}</p></div>; }

function appendPatternNode(path, value) {
  if (path.includes(value)) return path;
  const next = [...path];
  const previous = next.at(-1);
  if (previous !== undefined) {
    const from = Number(previous); const to = Number(value);
    const rowDiff = Math.floor(to / 3) - Math.floor(from / 3);
    const colDiff = (to % 3) - (from % 3);
    if (rowDiff % 2 === 0 && colDiff % 2 === 0) {
      const middle = String(from + (rowDiff / 2) * 3 + colDiff / 2);
      if (middle !== previous && middle !== value && !next.includes(middle)) next.push(middle);
    }
  }
  next.push(value);
  return next;
}

function PatternPad({ busy, onComplete, onTooShort }) {
  const gridRef = useRef(null);
  const pathRef = useRef([]);
  const pointerIdRef = useRef(null);
  const [path, setPath] = useState([]);
  const [pointer, setPointer] = useState(null);

  const setNextPath = (value) => {
    const next = appendPatternNode(pathRef.current, value);
    if (next !== pathRef.current) { pathRef.current = next; setPath(next); }
  };
  const pointForEvent = (event) => {
    const rect = gridRef.current.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * 184 / rect.width, y: (event.clientY - rect.top) * 184 / rect.height };
  };
  const nodeAt = (event) => {
    const nodes = [...gridRef.current.querySelectorAll('[data-pattern-node]')];
    let best = null; let distance = 30;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const candidate = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
      if (candidate <= distance) { best = node.dataset.patternNode; distance = candidate; }
    }
    return best;
  };
  const reset = () => { pathRef.current = []; setPath([]); setPointer(null); pointerIdRef.current = null; };
  const begin = (event) => {
    if (busy || event.button !== 0) return;
    const node = nodeAt(event);
    if (node === null) return;
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    gridRef.current.setPointerCapture(event.pointerId);
    pathRef.current = [];
    setPath([]);
    setNextPath(node);
    setPointer(pointForEvent(event));
  };
  const move = (event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    const node = nodeAt(event);
    if (node !== null) setNextPath(node);
    setPointer(pointForEvent(event));
  };
  const finish = async (event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    if (gridRef.current.hasPointerCapture(event.pointerId)) gridRef.current.releasePointerCapture(event.pointerId);
    pointerIdRef.current = null;
    setPointer(null);
    const credential = pathRef.current.join('-');
    if (pathRef.current.length < 5) { onTooShort(); reset(); return; }
    await onComplete(credential);
    reset();
  };
  const centers = [[17,17],[92,17],[167,17],[17,92],[92,92],[167,92],[17,167],[92,167],[167,167]];
  const points = path.map((value) => centers[Number(value)]).filter(Boolean);
  const polyline = points.map((point) => point.join(',')).join(' ');
  const last = points.at(-1);
  return <div ref={gridRef} className={`quick-pattern${busy ? ' is-busy' : ''}`} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={reset} aria-label="Графический ключ">
    <svg className="quick-pattern__lines" viewBox="0 0 184 184" aria-hidden="true">
      {points.length > 1 && <polyline points={polyline}/>}
      {last && pointer && <line x1={last[0]} y1={last[1]} x2={pointer.x} y2={pointer.y}/>}
    </svg>
    {centers.map((_, index) => <span key={index} data-pattern-node={index} className={path.includes(String(index)) ? 'is-selected' : ''}><i/></span>)}
  </div>;
}

function Unlock({ vaultExists, quickMode, onUnlock }) {
  const [credential, setCredential] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [masterFallback, setMasterFallback] = useState(false);
  useEffect(() => { setMasterFallback(false); setCredential(''); setError(''); }, [quickMode]);
  if (!vaultExists) return <Empty>Сначала создайте хранилище в основном окне.</Empty>;
  const mode = masterFallback || !['pin', 'pattern'].includes(quickMode) ? 'password' : quickMode;
  const label = mode === 'pattern' ? 'Проведите рисунок' : mode === 'pin' ? 'Введите PIN' : 'Введите мастер-пароль';
  const submitCredential = async (value) => {
    setBusy(true); setError('');
    try {
      const result = await call(api.unlockVault(mode, value));
      if (result.wiped) { setError('Хранилище уничтожено по настройке безопасности.'); return false; }
      if (!result.unlocked) {
        const subject = mode === 'pattern' ? 'Неверный рисунок' : mode === 'pin' ? 'Неверный PIN' : 'Неверный пароль';
        setError(result.retryAfterSeconds ? `${subject}. Повторите через ${result.retryAfterSeconds} сек.` : `${subject}. Попытка ${result.failedAttempts}.`);
        return false;
      }
      setCredential(''); onUnlock(result); return true;
    } catch { setError(mode === 'password' ? 'Не удалось открыть хранилище.' : 'Быстрый вход недоступен. Используйте мастер-пароль.'); return false; }
    finally { setBusy(false); }
  };
  const submit = (event) => { event.preventDefault(); submitCredential(credential); };
  return <div className={`unlock unlock--${mode}`}>
    <div className="unlock__mark">N</div>
    <div className="unlock__copy"><h2>{mode === 'password' ? 'Закрытый раздел' : 'Быстрый вход'}</h2><p>{label}</p></div>
    {mode === 'pattern' ? <PatternPad busy={busy} onComplete={submitCredential} onTooShort={() => setError('Соедините не менее пяти точек.')}/> :
      <form onSubmit={submit}><input autoFocus type="password" inputMode={mode === 'pin' ? 'numeric' : undefined} value={credential} onChange={(event) => setCredential(mode === 'pin' ? event.target.value.replace(/\D/g, '').slice(0, 12) : event.target.value)} placeholder={mode === 'pin' ? 'PIN-код' : 'Мастер-пароль'} minLength={mode === 'pin' ? 6 : 10} maxLength={mode === 'pin' ? 12 : undefined} required/><button disabled={busy}>{busy ? 'Проверка…' : 'Открыть хранилище'}</button></form>}
    {error && <div className="unlock__error">{error}</div>}
    {quickMode !== 'password' && <button className="unlock__fallback" onClick={() => { setMasterFallback(!masterFallback); setCredential(''); setError(''); }}>{masterFallback ? (quickMode === 'pattern' ? 'Вернуться к рисунку' : 'Вернуться к PIN') : 'Войти мастер-паролем'}</button>}
  </div>;
}

function ClipboardView({ items, update }) {
  const remove = async (id) => update(await call(api.deleteItem('clipboard', id)));
  return <section className="view"><ViewHead title="Буфер обмена" count={`${items.length} / 30`} onClear={items.length ? async () => update(await call(api.clear('clipboard'))) : null}/>
    <div className="text-stream">{items.length ? items.map((item) => <article className="clip-row" key={item.id}>
      <button className="clip-row__text" onClick={() => api.copy(item.text)} title="Скопировать"><p>{item.text}</p><time>{time(item.createdAt)}</time></button>
      <button className="icon-button" onClick={() => api.copy(item.text)} aria-label="Скопировать"><Glyph name="copy"/></button>
      <button className="icon-button danger" onClick={() => remove(item.id)} aria-label="Удалить"><Glyph name="trash"/></button>
    </article>) : <Empty>Новый текст из буфера появится здесь.</Empty>}</div>
  </section>;
}

function ScreenshotsView({ items, update }) {
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('');
  const remove = async (id) => { update(await call(api.deleteItem('screenshots', id))); if (selected?.id === id) setSelected(null); };
  return <section className="view"><ViewHead title="Скриншоты" count={`${items.length} / 30`} onClear={items.length ? async () => { update(await call(api.clear('screenshots'))); setSelected(null); } : null}/>
    {selected ? <div className="shot-preview"><button className="preview-back" onClick={() => setSelected(null)}>← Назад</button><img src={selected.url} alt="Скриншот"/><div className="preview-actions">{status && <span>{status}</span>}<button onClick={async () => { await call(api.copyScreenshot(selected.id)); setStatus('Скопировано'); }}><Glyph name="copy"/> Копировать</button><button onClick={async () => { const result = await call(api.saveScreenshot(selected.id)); if (!result.canceled) setStatus('Сохранено'); }}><Glyph name="save"/> Сохранить</button><button className="danger" onClick={() => remove(selected.id)}><Glyph name="trash"/> Удалить</button></div></div> :
      <div className="shot-grid">{items.length ? items.map((item) => <button className="shot" key={item.id} onClick={() => setSelected(item)}><img src={item.url} alt=""/><span>{time(item.createdAt)}</span></button>) : <Empty>Скопированный снимок экрана появится здесь.</Empty>}</div>}
  </section>;
}

function ViewHead({ title, count, onClear }) { return <header className="view-head"><div><h1>{title}</h1><span>{count}</span></div>{onClear && <button onClick={onClear}>Очистить всё</button>}</header>; }

function VaultView({ kind, snapshot, update }) {
  const items = kind === 'notes' ? snapshot.notes : kind === 'documents' ? snapshot.documents : snapshot.entries;
  const [selectedId, setSelectedId] = useState(items[0]?.id || null);
  useEffect(() => setSelectedId(items[0]?.id || null), [kind]);
  const selected = items.find((item) => item.id === selectedId);
  const label = kind === 'notes' ? 'Заметки' : kind === 'documents' ? 'Документы' : 'Пароли';
  return <section className="view"><ViewHead title={label} count={`${items.length}`}/><div className="vault-split">
    <div className="vault-index">{items.length ? items.map((item) => <button className={item.id === selectedId ? 'active' : ''} key={item.id} onClick={() => setSelectedId(item.id)}><strong>{kind === 'documents' ? item.name : item.title}</strong><span>{kind === 'notes' ? (item.body || 'Пустая заметка').replace(/\s+/g, ' ').slice(0, 42) : kind === 'documents' ? `${documentExtension(item.name)} · ${formatBytes(item.size)}` : item.username || 'Без логина'}</span></button>) : <Empty>В хранилище пока ничего нет.</Empty>}</div>
    <div className="vault-detail">{selected ? kind === 'notes' ? <NoteDetail note={selected} onDelete={async () => { const next = await call(api.deleteNote(selected.id)); update(next); setSelectedId(next.notes[0]?.id || null); }}/> : kind === 'documents' ? <DocumentDetail document={selected}/> : <PasswordDetail entry={selected}/> : <Empty>Выберите название слева.</Empty>}</div>
  </div></section>;
}

function OtpView({ snapshot }) {
  const [codes, setCodes] = useState({});
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = () => call(api.otpCodes()).then((items) => {
      if (active) setCodes(Object.fromEntries(items.map((item) => [item.id, item])));
    }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 1_000);
    return () => { active = false; clearInterval(timer); };
  }, [snapshot.otp.length]);

  const copy = async (code) => {
    await call(api.copySecret(code));
    setStatus('Код скопирован. Буфер очистится автоматически.');
  };

  return <section className="view otp-quick"><ViewHead title="Коды доступа" count={`${snapshot.otp.length}`}/>
    {status && <div className="otp-quick__status">{status}</div>}
    <div className="otp-quick__list">{snapshot.otp.length ? snapshot.otp.map((account) => {
      const current = codes[account.id];
      const code = current?.code || '••••••';
      return <button className="otp-quick__row" key={account.id} disabled={!current} onClick={() => copy(current.code)}>
        <span className="otp-quick__mark">{(account.issuer || account.account || '?').slice(0, 1).toUpperCase()}</span>
        <span className="otp-quick__identity"><strong>{account.issuer || account.account}</strong><small>{account.issuer ? account.account : 'TOTP'}</small></span>
        <span className="otp-quick__code">{code.replace(/(.{3})(?=.)/, '$1 ')}</span>
        <span className="otp-quick__remaining">{current ? `${current.remaining} с` : '—'}</span>
      </button>;
    }) : <Empty>Добавьте TOTP-код в основном окне.</Empty>}</div>
  </section>;
}

const formatBytes = (bytes) => bytes < 1024 ? `${bytes} Б` : bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
const documentExtension = (name) => String(name || '').split('.').pop().slice(0, 5).toUpperCase();

function DocumentDetail({ document }) {
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState(null);
  const previewable = ['text/plain', 'text/markdown', 'text/csv'].includes(document.type);
  if (preview) return <article className="document-preview-quick"><button className="detail-back" onClick={() => setPreview(null)}>← К документу</button><strong>{preview.name}</strong><pre>{preview.text}</pre></article>;
  return <article className="document-detail"><div className="document-glyph">{documentExtension(document.name)}</div><span className="detail-kicker">Защищённый документ</span><h2>{document.name}</h2><div className="document-meta"><span>{document.type}</span><span>{formatBytes(document.size)}</span></div><p>{previewable ? 'Документ можно посмотреть внутри Nocturne без создания файла на диске.' : 'Для этого формата доступен только явный экспорт на компьютер.'}</p><div className="document-detail__actions">{previewable && <button onClick={async () => { setPreview(await call(api.previewDocument(document.id))); }}>Смотреть</button>}<button onClick={async () => { const result = await call(api.saveMedia(document.id)); if (!result.canceled) setStatus('Сохранено на ПК'); }}><Glyph name="save"/> Сохранить на ПК</button></div>{status && <div className="copy-status">{status}</div>}</article>;
}

function PasswordDetail({ entry }) {
  const [shown, setShown] = useState(false);
  const [status, setStatus] = useState('');
  const copy = async (value, label) => { await call(api.copySecret(value)); setStatus(`${label} скопирован${label === 'Заметка' ? 'а' : ''}`); };
  return <article className="secret"><span className="detail-kicker">Учётная запись</span><h2>{entry.title}</h2>
    {status && <div className="copy-status">{status}. Буфер очистится автоматически.</div>}
    <label>Логин</label><div className="secret-line"><span>{entry.username || 'Не указан'}</span>{entry.username && <button onClick={() => copy(entry.username, 'Логин')} aria-label="Безопасно скопировать логин"><Glyph name="copy"/></button>}</div>
    <label>Пароль</label><div className="secret-line"><span className={shown ? '' : 'masked'}>{shown ? entry.password : '••••••••••••'}</span><button onClick={() => setShown(!shown)}>{shown ? 'Скрыть' : 'Показать'}</button><button onClick={() => copy(entry.password, 'Пароль')} aria-label="Безопасно скопировать пароль"><Glyph name="copy"/></button></div>
    {entry.url && <><label>Адрес</label><div className="secret-line"><span>{entry.url}</span><button onClick={() => copy(entry.url, 'Адрес')} aria-label="Безопасно скопировать адрес"><Glyph name="copy"/></button></div></>}{entry.notes && <><label>Комментарий</label><div className="secret-line secret-line--multiline"><span>{entry.notes}</span><button onClick={() => copy(entry.notes, 'Заметка')} aria-label="Безопасно скопировать заметку"><Glyph name="copy"/></button></div></>}
  </article>;
}

function NoteDetail({ note, onDelete }) {
  const [media, setMedia] = useState(null);
  const [status, setStatus] = useState('');
  if (media) return <article className="media-detail"><button className="detail-back" onClick={() => setMedia(null)}>← К заметке</button><img src={media.url} alt={media.name}/><div className="media-detail__actions"><span>{media.name}</span><button onClick={async () => { await call(api.copyMedia(media.id)); setStatus('Скопировано'); }}><Glyph name="copy"/> Копировать</button><button onClick={async () => { const result = await call(api.saveMedia(media.id)); if (!result.canceled) setStatus('Сохранено'); }}><Glyph name="save"/> Сохранить</button>{status && <em>{status}</em>}</div></article>;
  return <article className="secret note"><span className="detail-kicker">Заметка</span><h2>{note.title}</h2><div className="note-actions"><button onClick={async () => { await call(api.copySecret(note.body || '')); setStatus('Заметка скопирована'); }}><Glyph name="copy"/> Копировать</button><button className="danger" onClick={onDelete}><Glyph name="trash"/> Удалить</button>{status && <span>{status}. Буфер очистится автоматически.</span>}</div><p className="note-body">{note.body || 'Пустая заметка'}</p>{note.attachments?.length > 0 && <div className="note-images">{note.attachments.map((item) => <button key={item.id} onClick={() => setMedia(item)}><img src={item.url} alt={item.name}/><span>{item.name}</span></button>)}</div>}</article>;
}

function App() {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState('clip');
  const [activity, setActivity] = useState({ clipboard: [], screenshots: [] });
  const [vaultExists, setVaultExists] = useState(false);
  const [quickUnlockMode, setQuickUnlockMode] = useState('password');
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    call(api.bootstrap()).then((data) => { applyQuickPreferences(data.preferences); setExpanded(data.expanded); setActivity(data.activity); setVaultExists(data.vaultExists); setQuickUnlockMode(data.quickUnlockMode || 'password'); });
    api.onExpanded(setExpanded); api.onActivity(setActivity); api.onUnlockMode(setQuickUnlockMode); api.onVaultLocked((data) => { setSnapshot(null); setActivity({ clipboard: [], screenshots: [] }); setQuickUnlockMode(data?.quickUnlockMode || 'password'); }); api.onVaultWiped(() => { setSnapshot(null); setActivity({ clipboard: [], screenshots: [] }); setVaultExists(false); setQuickUnlockMode('password'); }); api.onVaultCreated(() => setVaultExists(true));
    api.onPreferences((preferences) => applyQuickPreferences(preferences));
  }, []);
  useEffect(() => {
    if (!snapshot) return undefined;
    let lastPulse = 0;
    const pulse = () => {
      const now = Date.now();
      if (now - lastPulse >= 1_000) { lastPulse = now; api.recordActivity(); }
    };
    window.addEventListener('pointerdown', pulse, true);
    window.addEventListener('keydown', pulse, true);
    pulse();
    return () => {
      window.removeEventListener('pointerdown', pulse, true);
      window.removeEventListener('keydown', pulse, true);
    };
  }, [snapshot]);
  const tabs = useMemo(() => [{ id: 'clip', label: 'Буфер', icon: 'clip', count: activity.clipboard.length }, { id: 'shots', label: 'Скриншоты', icon: 'shots', count: activity.screenshots.length }, { id: 'notes', label: 'Заметки', icon: 'notes' }, { id: 'passwords', label: 'Пароли', icon: 'passwords' }, { id: 'otp', label: 'Коды', icon: 'otp' }, { id: 'documents', label: 'Документы', icon: 'documents' }], [activity]);
  const protectedTabs = ['clip', 'shots', 'notes', 'passwords', 'otp', 'documents'];
  const choose = (id) => setTab(id);
  return <div className={expanded ? 'quick-root is-expanded' : 'quick-root'}>
    <button className="chevron" onClick={() => api.toggle()} onContextMenu={(event) => { event.preventDefault(); api.showContextMenu(); }} aria-label={expanded ? 'Свернуть' : 'Развернуть'}><span></span></button>
    <div className="drawer">
      <aside className="rail"><nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => choose(item.id)}><Glyph name={item.icon}/><span>{item.label}</span>{item.count !== undefined && <em>{item.count}</em>}</button>)}</nav><button className="open-main" onClick={() => api.openMain()}><Glyph name="open"/><span>Открыть</span></button></aside>
      <main className="surface">{protectedTabs.includes(tab) && (snapshot ? (tab === 'clip' ? <ClipboardView items={activity.clipboard} update={setActivity}/> : tab === 'shots' ? <ScreenshotsView items={activity.screenshots} update={setActivity}/> : tab === 'otp' ? <OtpView snapshot={snapshot}/> : <VaultView kind={tab} snapshot={snapshot} update={setSnapshot}/>) : <Unlock vaultExists={vaultExists} quickMode={quickUnlockMode} onUnlock={(value) => { setSnapshot(value); setActivity(value.quickActivity || { clipboard: [], screenshots: [] }); }}/>)}</main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (quickPreferences.theme === 'system') applyQuickPreferences(quickPreferences);
});
