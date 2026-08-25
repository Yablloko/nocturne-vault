const React = require('react');
const { createRoot } = require('react-dom/client');
const { useEffect, useMemo, useState } = React;

const api = window.nocturneQuick;
const call = async (promise) => { const result = await promise; if (!result?.ok) throw new Error(result?.error || 'UNKNOWN'); return result.data; };
const time = (value) => new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(value));

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

function Unlock({ vaultExists, onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!vaultExists) return <Empty>Сначала создайте хранилище в основном окне.</Empty>;
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await call(api.unlockVault(password));
      if (result.wiped) return setError('Хранилище уничтожено по настройке безопасности.');
      if (!result.unlocked) return setError(result.retryAfterSeconds ? `Неверный пароль. Повторите через ${result.retryAfterSeconds} сек.` : `Неверный пароль. Попытка ${result.failedAttempts}.`);
      setPassword(''); onUnlock(result);
    } catch { setError('Не удалось открыть хранилище.'); }
    finally { setBusy(false); }
  };
  return <div className="unlock">
    <div className="unlock__mark">N</div>
    <div><h2>Закрытый раздел</h2><p>Введите мастер-пароль Nocturne. Он не сохраняется в этой панели.</p></div>
    <form onSubmit={submit}><input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Мастер-пароль" minLength="10" required/><button disabled={busy}>{busy ? 'Проверка…' : 'Открыть'}</button></form>
    {error && <div className="unlock__error">{error}</div>}
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
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    call(api.bootstrap()).then((data) => { setExpanded(data.expanded); setActivity(data.activity); setVaultExists(data.vaultExists); });
    api.onExpanded((value) => { setExpanded(value); if (!value) setSnapshot(null); }); api.onActivity(setActivity); api.onVaultLocked(() => setSnapshot(null)); api.onVaultWiped(() => { setSnapshot(null); setVaultExists(false); }); api.onVaultCreated(() => setVaultExists(true));
  }, []);
  const tabs = useMemo(() => [{ id: 'clip', label: 'Буфер', icon: 'clip', count: activity.clipboard.length }, { id: 'shots', label: 'Скриншоты', icon: 'shots', count: activity.screenshots.length }, { id: 'notes', label: 'Заметки', icon: 'notes' }, { id: 'passwords', label: 'Пароли', icon: 'passwords' }, { id: 'otp', label: 'Коды', icon: 'otp' }, { id: 'documents', label: 'Документы', icon: 'documents' }], [activity]);
  const protectedTabs = ['notes', 'passwords', 'otp', 'documents'];
  const choose = (id) => { setTab(id); if (!protectedTabs.includes(id)) setSnapshot(null); };
  return <div className={expanded ? 'quick-root is-expanded' : 'quick-root'}>
    <button className="chevron" onClick={() => api.toggle()} aria-label={expanded ? 'Свернуть' : 'Развернуть'}><span></span></button>
    <div className="drawer">
      <aside className="rail"><nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => choose(item.id)}><Glyph name={item.icon}/><span>{item.label}</span>{item.count !== undefined && <em>{item.count}</em>}</button>)}</nav><button className="open-main" onClick={() => api.openMain()}><Glyph name="open"/><span>Открыть</span></button></aside>
      <main className="surface">{tab === 'clip' && <ClipboardView items={activity.clipboard} update={setActivity}/>} {tab === 'shots' && <ScreenshotsView items={activity.screenshots} update={setActivity}/>} {protectedTabs.includes(tab) && (snapshot ? (tab === 'otp' ? <OtpView snapshot={snapshot}/> : <VaultView kind={tab} snapshot={snapshot} update={setSnapshot}/>) : <Unlock vaultExists={vaultExists} onUnlock={setSnapshot}/>)}</main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
