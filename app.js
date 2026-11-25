'use strict';
/* 내 손안의 포스트잇 - 메인 스크립트
 * 저장소: IndexedDB (휴대폰 내부 저장, 인터넷 불필요)
 * 백업/복원: JSON 파일
 */
(function () {
  // ---------- 상수 ----------
  const DB_NAME = 'my-postit-db';
  const DB_VERSION = 1;
  const STORE = 'notes';
  const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'];
  const KEY_THEME = 'postit.theme';
  const KEY_SORT = 'postit.sort';
  const KEY_COLOR = 'postit.lastColor';
  const KEY_BACKUP = 'postit.lastBackup';
  const KEY_WELCOME = 'postit.welcomed';

  // ---------- 도우미 ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    grid: $('notesGrid'), empty: $('emptyState'), emptyText: $('emptyText'),
    search: $('searchInput'), clearSearch: $('clearSearch'),
    count: $('countText'), sort: $('sortSelect'),
    themeBtn: $('themeBtn'), themeMeta: $('themeMeta'), menuBtn: $('menuBtn'), fab: $('fab'),
    editor: $('editor'), sheet: $('editorSheet'), closeEditor: $('closeEditor'),
    editorDate: $('editorDate'), pinBtn: $('pinBtn'),
    title: $('titleInput'), content: $('contentInput'), colors: $('colorPicker'),
    copyBtn: $('copyBtn'), shareBtn: $('shareBtn'), deleteBtn: $('deleteBtn'), saveBtn: $('saveBtn'),
    menu: $('menu'), menuClose: $('menuClose'), menuBackup: $('menuBackup'),
    menuRestore: $('menuRestore'), menuTheme: $('menuTheme'), menuInstall: $('menuInstall'),
    backupInfo: $('backupInfo'), restoreFile: $('restoreFile'),
    dialog: $('dialog'), dialogTitle: $('dialogTitle'), dialogMsg: $('dialogMsg'), dialogBtns: $('dialogBtns'),
    toast: $('toast')
  };

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  };

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function fmtShort(ts) {
    return new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function fmtLong(ts) {
    return new Date(ts).toLocaleString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit'
    });
  }

  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
  }

  // ---------- IndexedDB ----------
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let out;
      try { out = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const dbGetAll = () => tx('readonly', (s) => s.getAll());
  const dbPut = (note) => tx('readwrite', (s) => s.put(note));
  const dbDelete = (id) => tx('readwrite', (s) => s.delete(id));
  const dbPutMany = (list) => tx('readwrite', (s) => { list.forEach((n) => s.put(n)); });
  const dbReplaceAll = (list) => tx('readwrite', (s) => { s.clear(); list.forEach((n) => s.put(n)); });

  // ---------- 상태 ----------
  let notes = [];
  let query = '';
  let sortMode = ls.get(KEY_SORT) === 'old' ? 'old' : 'new';
  let editing = null;     // 편집 중인 메모 (복사본)
  let isNew = false;
  let baseline = '';
  let closing = false;
  let lastColor = COLORS.includes(ls.get(KEY_COLOR)) ? ls.get(KEY_COLOR) : 'yellow';

  // ---------- 화면 그리기 ----------
  function sortNotes(list) {
    return list.slice().sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return sortMode === 'new' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
    });
  }

  function render() {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? notes.filter((n) => ((n.title || '') + '\n' + (n.content || '')).toLowerCase().includes(q))
      : notes;
    const list = sortNotes(filtered);

    els.grid.textContent = '';
    const frag = document.createDocumentFragment();
    list.forEach((n) => {
      const card = document.createElement('article');
      card.className = 'note';
      card.dataset.id = n.id;
      card.dataset.color = n.color;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');

      if (n.pinned) {
        const pin = document.createElement('span');
        pin.className = 'pin';
        pin.textContent = '📌';
        pin.setAttribute('aria-label', '고정된 메모');
        card.append(pin);
      }
      const t = document.createElement('h2');
      t.className = 'note-title' + (n.title ? '' : ' untitled');
      t.textContent = n.title || '제목 없음';
      const b = document.createElement('p');
      b.className = 'note-body';
      b.textContent = n.content;
      const d = document.createElement('time');
      d.className = 'note-date';
      d.textContent = fmtShort(n.createdAt);
      card.append(t, b, d);
      frag.append(card);
    });
    els.grid.append(frag);

    els.count.textContent = q
      ? '검색 결과 ' + list.length + '개 / 전체 ' + notes.length + '개'
      : '전체 ' + notes.length + '개';

    if (list.length === 0) {
      els.empty.hidden = false;
      els.emptyText.textContent = notes.length === 0
        ? '아직 메모가 없어요.\n오른쪽 아래 ＋ 버튼을 눌러 보세요!'
        : '검색 결과가 없어요.';
    } else {
      els.empty.hidden = true;
    }
    els.clearSearch.hidden = !els.search.value;
  }

  // ---------- 테마 ----------
  function isDark() {
    const s = ls.get(KEY_THEME);
    if (s === 'dark') return true;
    if (s === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function applyTheme() {
    const d = isDark();
    document.documentElement.dataset.theme = d ? 'dark' : 'light';
    els.themeMeta.setAttribute('content', d ? '#17171a' : '#FFD54F');
    els.themeBtn.textContent = d ? '☀️' : '🌙';
    els.menuTheme.textContent = d ? '☀️ 밝은 모드로 바꾸기' : '🌙 다크모드로 바꾸기';
  }
  function toggleTheme() {
    ls.set(KEY_THEME, isDark() ? 'light' : 'dark');
    applyTheme();
  }

  // ---------- 확인 창 ----------
  let dialogResolve = null;
  function ask(opts) {
    return new Promise((resolve) => {
      dialogResolve = resolve;
      els.dialogTitle.textContent = opts.title;
      els.dialogMsg.textContent = opts.message;
      els.dialogBtns.textContent = '';
      opts.buttons.forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dlg-btn ' + (b.cls || '');
        btn.textContent = b.label;
        btn.addEventListener('click', () => closeDialog(b.value));
        els.dialogBtns.append(btn);
      });
      els.dialog.hidden = false;
    });
  }
  function closeDialog(value) {
    els.dialog.hidden = true;
    const r = dialogResolve;
    dialogResolve = null;
    if (r) r(value);
  }

  // ---------- 편집 화면 ----------
  function snapshot() {
    return [els.title.value.trim(), els.content.value.trimEnd(), editing ? editing.color : '', editing && editing.pinned ? 1 : 0].join('\u0001');
  }
  function hasContent() {
    return !!(els.title.value.trim() || els.content.value.trim());
  }
  function setColor(color) {
    editing.color = color;
    els.sheet.dataset.color = color;
    els.colors.querySelectorAll('.color-dot').forEach((b) => {
      const on = b.dataset.color === color;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function updatePinUI() {
    const on = !!editing.pinned;
    els.pinBtn.classList.toggle('active', on);
    els.pinBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    els.pinBtn.setAttribute('aria-label', on ? '고정 해제' : '상단에 고정');
  }
  function updateDateLabel() {
    let text = '작성 ' + fmtLong(editing.createdAt);
    if (!isNew && editing.updatedAt && editing.updatedAt !== editing.createdAt) {
      text += '\n수정 ' + fmtShort(editing.updatedAt);
    }
    els.editorDate.textContent = text;
    els.editorDate.style.whiteSpace = 'pre-line';
  }

  function openEditor(note) {
    isNew = !note;
    editing = note
      ? Object.assign({}, note)
      : { id: null, title: '', content: '', color: lastColor, pinned: false, createdAt: Date.now(), updatedAt: null };
    els.title.value = editing.title;
    els.content.value = editing.content;
    setColor(editing.color);
    updatePinUI();
    updateDateLabel();
    els.deleteBtn.hidden = isNew;
    baseline = snapshot();
    els.editor.hidden = false;
    document.body.classList.add('no-scroll');
    history.pushState({ editor: true }, '');
    if (isNew) setTimeout(() => els.title.focus(), 50);
  }

  async function persist() {
    const now = Date.now();
    const note = {
      id: editing.id || newId(),
      title: els.title.value.trim(),
      content: els.content.value.trimEnd(),
      color: editing.color,
      pinned: !!editing.pinned,
      createdAt: editing.createdAt,
      updatedAt: now
    };
    await dbPut(note);
    const i = notes.findIndex((n) => n.id === note.id);
    if (i >= 0) notes[i] = note; else notes.push(note);
    editing = Object.assign({}, note);
    isNew = false;
    baseline = snapshot();
    lastColor = note.color;
    ls.set(KEY_COLOR, lastColor);
    render();
  }

  function hideEditor() {
    els.editor.hidden = true;
    document.body.classList.remove('no-scroll');
    editing = null;
  }

  // 닫을 때: 바뀐 내용이 있으면 자동 저장
  async function closeEditor() {
    if (els.editor.hidden || closing) return;
    closing = true;
    try {
      if (editing && snapshot() !== baseline && hasContent()) {
        try { await persist(); toast('자동 저장했어요'); } catch (e) { toast('저장에 실패했어요'); }
      }
    } finally {
      hideEditor();
      closing = false;
    }
  }
  function leaveEditor() {
    if (history.state && history.state.editor) history.back();
    else closeEditor();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
      return ok;
    }
  }
  function currentText() {
    return [els.title.value.trim(), els.content.value.trimEnd()].filter(Boolean).join('\n\n');
  }

  // ---------- 백업 / 복원 ----------
  function sanitizeNote(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = typeof raw.title === 'string' ? raw.title.slice(0, 200) : '';
    const content = typeof raw.content === 'string' ? raw.content.slice(0, 200000) : '';
    if (!title.trim() && !content.trim()) return null;
    const c = Number(raw.createdAt);
    const u = Number(raw.updatedAt);
    const createdAt = Number.isFinite(c) && c > 0 ? c : Date.now();
    const updatedAt = Number.isFinite(u) && u > 0 ? u : createdAt;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 100) : newId(),
      title, content,
      color: COLORS.includes(raw.color) ? raw.color : 'yellow',
      pinned: !!raw.pinned,
      createdAt, updatedAt
    };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function updateBackupInfo() {
    const t = Number(ls.get(KEY_BACKUP));
    els.backupInfo.textContent = t
      ? '마지막 백업: ' + fmtLong(t) + '\n백업 파일은 휴대폰 "다운로드" 폴더에 저장돼요.'
      : '아직 백업한 적이 없어요.\n가끔 백업 파일을 저장해 두면 안심이에요.';
    els.backupInfo.style.whiteSpace = 'pre-line';
  }

  function backup() {
    const data = { app: 'my-postit', version: 1, exportedAt: new Date().toISOString(), notes: notes };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const d = new Date();
    const name = 'postit-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    ls.set(KEY_BACKUP, String(Date.now()));
    updateBackupInfo();
    toast('백업 파일을 저장했어요 💾');
  }

  async function restoreFromFile(file) {
    let incoming;
    try {
      const data = JSON.parse(await file.text());
      const arr = Array.isArray(data) ? data : (data && Array.isArray(data.notes) ? data.notes : null);
      if (!arr) throw new Error('형식 오류');
      incoming = arr.map(sanitizeNote).filter(Boolean);
    } catch (e) {
      toast('올바른 백업 파일이 아니에요');
      return;
    }
    if (!incoming.length) { toast('복원할 메모가 없어요'); return; }

    const choice = await ask({
      title: '백업 복원',
      message: '백업 파일에서 메모 ' + incoming.length + '개를 찾았어요.\n\n· 합치기: 지금 메모를 그대로 두고 추가해요.\n· 모두 바꾸기: 지금 메모를 지우고 백업으로 바꿔요.',
      buttons: [
        { label: '합치기 (추천)', value: 'merge', cls: 'primary' },
        { label: '모두 바꾸기', value: 'replace', cls: 'danger' },
        { label: '취소', value: null }
      ]
    });
    if (!choice) return;

    try {
      if (choice === 'replace') {
        await dbReplaceAll(incoming);
      } else {
        const existing = new Map(notes.map((n) => [n.id, n]));
        const toPut = incoming.filter((n) => {
          const ex = existing.get(n.id);
          return !ex || n.updatedAt > ex.updatedAt;
        });
        await dbPutMany(toPut);
      }
      notes = await dbGetAll();
      render();
      closeMenu();
      toast('복원했어요 ✅ (전체 ' + notes.length + '개)');
    } catch (e) {
      toast('복원에 실패했어요');
    }
  }

  // ---------- 메뉴 ----------
  function openMenu() { updateBackupInfo(); els.menu.hidden = false; }
  function closeMenu() { els.menu.hidden = true; }

  // ---------- 이벤트 ----------
  function bindEvents() {
    els.fab.addEventListener('click', () => openEditor(null));

    els.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.note');
      if (!card) return;
      const note = notes.find((n) => n.id === card.dataset.id);
      if (note) openEditor(note);
    });
    els.grid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.note');
      if (!card) return;
      e.preventDefault();
      const note = notes.find((n) => n.id === card.dataset.id);
      if (note) openEditor(note);
    });

    els.search.addEventListener('input', () => { query = els.search.value; render(); });
    els.clearSearch.addEventListener('click', () => { els.search.value = ''; query = ''; render(); els.search.focus(); });

    els.sort.value = sortMode;
    els.sort.addEventListener('change', () => {
      sortMode = els.sort.value === 'old' ? 'old' : 'new';
      ls.set(KEY_SORT, sortMode);
      render();
    });

    els.themeBtn.addEventListener('click', toggleTheme);
    els.menuTheme.addEventListener('click', toggleTheme);
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (!ls.get(KEY_THEME)) applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    }

    // 편집 화면
    els.closeEditor.addEventListener('click', leaveEditor);
    els.colors.addEventListener('click', (e) => {
      const b = e.target.closest('.color-dot');
      if (b && editing) setColor(b.dataset.color);
    });
    els.pinBtn.addEventListener('click', () => {
      if (!editing) return;
      editing.pinned = !editing.pinned;
      updatePinUI();
      toast(editing.pinned ? '상단에 고정했어요 📌' : '고정을 풀었어요');
    });
    els.saveBtn.addEventListener('click', async () => {
      if (!editing) return;
      if (!hasContent()) { toast('제목이나 내용을 입력해 주세요'); return; }
      try {
        await persist();
        toast('저장했어요 ✅');
        leaveEditor();
      } catch (e) {
        toast('저장에 실패했어요');
      }
    });
    els.copyBtn.addEventListener('click', async () => {
      const text = currentText();
      if (!text) { toast('복사할 내용이 없어요'); return; }
      toast((await copyText(text)) ? '복사했어요 📋' : '복사에 실패했어요');
    });
    els.shareBtn.addEventListener('click', async () => {
      const text = currentText();
      if (!text) { toast('공유할 내용이 없어요'); return; }
      if (navigator.share) {
        try {
          await navigator.share({ title: els.title.value.trim() || '메모', text: text });
        } catch (e) {
          if (e && e.name !== 'AbortError') toast('공유에 실패했어요');
        }
      } else {
        toast((await copyText(text)) ? '공유 기능이 없어 복사했어요 📋' : '공유에 실패했어요');
      }
    });
    els.deleteBtn.addEventListener('click', async () => {
      if (!editing || isNew || !editing.id) return;
      const ok = await ask({
        title: '메모 삭제',
        message: '이 메모를 삭제할까요?\n삭제하면 되돌릴 수 없어요.',
        buttons: [{ label: '취소', value: false }, { label: '삭제', value: true, cls: 'danger' }]
      });
      if (!ok) return;
      const id = editing.id;
      try {
        await dbDelete(id);
        notes = notes.filter((n) => n.id !== id);
        editing = null;
        render();
        toast('삭제했어요 🗑️');
        leaveEditor();
      } catch (e) {
        toast('삭제에 실패했어요');
      }
    });

    // 안드로이드 뒤로가기 버튼
    window.addEventListener('popstate', () => { if (!els.editor.hidden) closeEditor(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!els.dialog.hidden) closeDialog(null);
      else if (!els.menu.hidden) closeMenu();
      else if (!els.editor.hidden) leaveEditor();
    });
    els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) closeDialog(null); });

    // 메뉴
    els.menuBtn.addEventListener('click', openMenu);
    els.menuClose.addEventListener('click', closeMenu);
    els.menu.addEventListener('click', (e) => { if (e.target === els.menu) closeMenu(); });
    els.menuBackup.addEventListener('click', () => {
      if (!notes.length) { toast('백업할 메모가 없어요'); return; }
      backup();
    });
    els.menuRestore.addEventListener('click', () => els.restoreFile.click());
    els.restoreFile.addEventListener('change', async () => {
      const file = els.restoreFile.files && els.restoreFile.files[0];
      if (file) await restoreFromFile(file);
      els.restoreFile.value = '';
    });

    // 홈 화면 설치 버튼
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      els.menuInstall.hidden = false;
    });
    els.menuInstall.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { /* 무시 */ }
      deferredPrompt = null;
      els.menuInstall.hidden = true;
      closeMenu();
    });
    window.addEventListener('appinstalled', () => { els.menuInstall.hidden = true; toast('설치됐어요 🎉'); });
  }

  // ---------- 시작 ----------
  async function init() {
    applyTheme();
    bindEvents();
    render();

    try {
      db = await openDB();
      notes = await dbGetAll();
    } catch (e) {
      toast('저장소를 열 수 없어요. 시크릿 모드를 끄고 다시 열어 주세요.');
      notes = [];
    }

    // 처음 실행: 환영 메모 1개
    if (db && !ls.get(KEY_WELCOME) && notes.length === 0) {
      const now = Date.now();
      const welcome = {
        id: newId(),
        title: '환영해요! 👋',
        content: '＋ 버튼으로 새 메모를 만들고, 📌로 중요한 메모를 위에 고정해 보세요.\n\n메뉴(⋮)에서 백업 파일을 저장해 두면 더 안전해요.',
        color: 'yellow', pinned: true, createdAt: now, updatedAt: now
      };
      try { await dbPut(welcome); notes.push(welcome); } catch (e) { /* 무시 */ }
    }
    ls.set(KEY_WELCOME, '1');
    render();

    // 브라우저가 저장소를 함부로 지우지 않도록 요청
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    // 홈 화면 바로가기에서 "새 메모"로 열린 경우
    if (db && /[?&]new=1/.test(location.search)) {
      history.replaceState(null, '', location.pathname);
      openEditor(null);
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(() => {});
      });
    }
  }

  init();
})();
