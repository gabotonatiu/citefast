/* =========================================================================
   CiteFast — Lógica de interfaz (con i18n).
   Estado en memoria + biblioteca en localStorage. Sin frameworks.
   ========================================================================= */
(function () {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const LS_LIB = 'citefast.library.v1';
  const LS_STYLE = 'citefast.style.v1';
  const LS_THEME = 'citefast.theme.v1';
  const LS_LANG = 'citefast.lang.v1';
  const LS_LANGSEEN = 'citefast.langchosen.v1';

  const MANUAL_TYPES = ['article-journal', 'book', 'chapter', 'paper-conference', 'thesis', 'report', 'webpage', 'dataset'];

  const state = {
    lang: window.I18N_DETECT(),
    style: localStorage.getItem(LS_STYLE) || 'apa7',
    current: null,
    candidates: [],
    library: load(LS_LIB, []),
    abort: null,
    debounce: null,
    bulkFile: null,
    bulkResolved: [],
    bulkAbort: null,
  };

  /* -------------------------------------------------------- i18n helpers */
  const dict = () => window.I18N[state.lang] || window.I18N.en;
  const t = (key) => { const d = dict(); return d[key] != null ? d[key] : (window.I18N.en[key] || key); };
  const tg = (group, key) => { const d = dict()[group] || window.I18N.en[group] || {}; return d[key] != null ? d[key] : key; };

  /* ------------------------------------------------------------ arranque */
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    // Tema
    const savedTheme = localStorage.getItem(LS_THEME);
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    $('#themeToggle').addEventListener('click', toggleTheme);

    // Selector de idioma
    const langSel = $('#langSelect');
    window.I18N_ORDER.forEach((code) => {
      const o = document.createElement('option');
      o.value = code; o.textContent = window.I18N[code]._name;
      if (code === state.lang) o.selected = true;
      langSel.appendChild(o);
    });
    langSel.addEventListener('change', () => {
      state.lang = langSel.value;
      localStorage.setItem(LS_LANG, state.lang);
      applyI18n();
    });

    // Selector de estilo (los nombres de estilo no se traducen)
    const styleSel = $('#styleSelect');
    Object.entries(window.CiteEngine.STYLES).forEach(([k, v]) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = v.label;
      if (k === state.style) o.selected = true;
      styleSel.appendChild(o);
    });
    styleSel.addEventListener('change', () => {
      state.style = styleSel.value;
      localStorage.setItem(LS_STYLE, state.style);
      renderPreview(); renderLibrary();
    });

    // Input héroe
    const input = $('#heroInput');
    input.addEventListener('input', onInput);
    input.addEventListener('paste', () => setTimeout(onInput, 0));

    $('#clearInput').addEventListener('click', () => {
      input.value = ''; hideChip(); setCandidates([]); input.focus();
    });

    // Acordeón manual
    $('#manualToggle').addEventListener('click', () => {
      const body = $('#manualBody');
      if (body.hasAttribute('hidden')) { body.removeAttribute('hidden'); $('#manualToggle').setAttribute('aria-expanded', 'true'); }
      else { body.setAttribute('hidden', ''); $('#manualToggle').setAttribute('aria-expanded', 'false'); }
    });
    $('#manualType').addEventListener('change', updateManualFields);
    $('#manualBuild').addEventListener('click', buildFromManual);

    // Acciones de vista previa (delegadas)
    $('#previewActions').addEventListener('click', onPreviewAction);

    // Biblioteca
    $('#library').addEventListener('click', onLibraryAction);
    $('#exportAll').addEventListener('change', onExportAll);
    $('#clearLibrary').addEventListener('click', () => {
      if (state.library.length && confirm(t('confirmClear'))) {
        state.library = []; save(LS_LIB, state.library); renderLibrary();
      }
    });

    // Modo por lotes (bulk)
    $('#bulkOpen').addEventListener('click', openBulk);
    $$('[data-bulk-close]').forEach((el) => el.addEventListener('click', closeBulk));
    $('#bulkFile').addEventListener('change', (e) => {
      state.bulkFile = e.target.files[0] || null;
      $('#bulkFileName').textContent = state.bulkFile ? state.bulkFile.name : '';
    });
    $('#bulkAnalyze').addEventListener('click', runBulk);
    $('#bulkAddAll').addEventListener('click', bulkAddAll);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeBulk(); }
    });

    applyI18n();

    // Modal de idioma: solo la PRIMERA visita.
    if (!localStorage.getItem(LS_LANGSEEN)) showLangModal();
    else input.focus();
  }

  /* ------------------------------------------------ modal de idioma -----*/
  function showLangModal() {
    const grid = $('#langModalGrid');
    grid.innerHTML = '';
    window.I18N_ORDER.forEach((code) => {
      const btn = document.createElement('button');
      btn.className = 'langgrid__btn' + (code === state.lang ? ' is-current' : '');
      btn.type = 'button';
      btn.innerHTML = `<span class="langgrid__name">${esc(window.I18N[code]._name)}</span>`;
      btn.addEventListener('click', () => {
        state.lang = code;
        localStorage.setItem(LS_LANG, code);
        localStorage.setItem(LS_LANGSEEN, '1');
        $('#langSelect').value = code;
        applyI18n();
        hideModal($('#langModal'));
        $('#heroInput').focus();
      });
      grid.appendChild(btn);
    });
    showModal($('#langModal'));
  }

  /* --------------------------------------------------- modo por lotes ---*/
  function openBulk() { showModal($('#bulkModal')); $('#bulkInput').focus(); }
  function closeBulk() {
    if (state.bulkAbort) { state.bulkAbort.abort(); state.bulkAbort = null; }
    hideModal($('#bulkModal'));
  }

  async function runBulk() {
    const pasted = $('#bulkInput').value.trim();
    const file = state.bulkFile;
    if (!pasted && !file) return;
    $('#bulkResults').innerHTML = '';
    $('#bulkFooter').hidden = true;
    state.bulkResolved = [];
    setBulkStatus('loading', t('bulkReading'));

    try {
      let text = pasted;
      if (file) {
        const extracted = await window.CiteBulk.extractText(file, (p, total) =>
          setBulkStatus('loading', `${t('bulkReading')} ${p}/${total}`));
        text = pasted ? pasted + '\n' + extracted : extracted;
      }
      const ids = window.CiteAPI.extractIdentifiers(text || '');

      if (!ids.length) {
        setBulkStatus('empty', t('bulkNone'));
        renderSkipNote();
        return;
      }
      setBulkStatus('loading', t('bulkResolving').replace('%n', ids.length));
      state.bulkAbort = new AbortController();
      const results = await window.CiteAPI.resolveMany(ids, {
        concurrency: 4, signal: state.bulkAbort.signal,
        onProgress: (d, total) => setBulkStatus('loading', t('bulkResolving').replace('%n', `${d}/${total}`)),
      });
      renderBulkResults(results);
    } catch (e) {
      if (e && e.message === 'nodecompress') setBulkStatus('error', t('bulkDocxUnsupported'));
      else setBulkStatus('error', t('bulkErr'));
    }
  }

  function setBulkStatus(kind, msg) {
    const el = $('#bulkStatus');
    el.hidden = false;
    el.className = 'bulk__status bulk__status--' + kind;
    el.innerHTML = kind === 'loading' ? `<span class="spinner" aria-hidden="true"></span> ${esc(msg)}` : esc(msg);
  }

  function renderBulkResults(results) {
    const resolved = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok && r.error !== 'abort');
    state.bulkResolved = resolved.map((r) => r.item);

    setBulkStatus('ok', t('bulkFound').replace('%n', resolved.length));

    const box = $('#bulkResults');
    box.innerHTML = '';

    resolved.forEach((r, idx) => {
      const row = document.createElement('label');
      row.className = 'bulkrow';
      row.innerHTML =
        `<input type="checkbox" class="bulkrow__chk" data-idx="${idx}" checked>
         <span class="bulkrow__cite">${fmt(r.item).html}</span>`;
      box.appendChild(row);
    });

    failed.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'bulkrow bulkrow--fail';
      row.innerHTML = `<span class="bulkrow__x" aria-hidden="true">⚠</span>
        <span class="bulkrow__cite"><code>${esc(r.id.raw || r.id.value)}</code> — ${esc(t('bulkFailed'))}</span>`;
      box.appendChild(row);
    });

    renderSkipNote();

    const footer = $('#bulkFooter');
    if (resolved.length) {
      footer.hidden = false;
      $('#bulkAddAll').textContent = t('bulkAddAll').replace('%n', resolved.length);
    } else { footer.hidden = true; }
  }

  // Aviso honesto (sin número inventado): lo no identificable no se genera.
  function renderSkipNote() {
    const note = document.createElement('div');
    note.className = 'bulkrow bulkrow--note';
    note.innerHTML = `<span aria-hidden="true">✋</span> <span>${esc(t('bulkUnverifiable'))}</span>`;
    $('#bulkResults').appendChild(note);
  }

  function bulkAddAll() {
    const checks = $$('#bulkResults .bulkrow__chk');
    let added = 0;
    checks.forEach((chk) => {
      if (!chk.checked) return;
      const item = state.bulkResolved[parseInt(chk.dataset.idx, 10)];
      if (!item) return;
      if (state.library.some((x) => libKey(x) === libKey(item))) return;
      state.library.unshift(Object.assign({ _id: uid() }, item));
      added++;
    });
    if (added) { save(LS_LIB, state.library); renderLibrary(); }
    closeBulk();
    $('#bulkInput').value = ''; state.bulkFile = null; $('#bulkFileName').textContent = '';
    document.querySelector('.lib').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* -------------------------------------------------------- modales -----*/
  function showModal(el) { el.hidden = false; document.body.style.overflow = 'hidden'; }
  function hideModal(el) { el.hidden = true; document.body.style.overflow = ''; }

  /* ------------------------------------------------- aplicar traducción */
  function applyI18n() {
    document.documentElement.lang = state.lang;

    $$('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
    $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $$('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });

    // Título héroe con resaltado
    $('#heroTitle').innerHTML = t('heroTitle').replace('%s', `<span>${t('heroHighlight')}</span>`);

    // Reconstruir selects con etiquetas traducidas
    buildManualTypeSelect();
    buildExportSelect();
    updateManualFields();

    $('#previewStyleTag').textContent = window.CiteEngine.STYLES[state.style].label;
    renderFAQ();
    renderPreview();
    renderLibrary();
  }

  function buildManualTypeSelect() {
    const sel = $('#manualType');
    const cur = sel.value || 'article-journal';
    sel.innerHTML = '';
    MANUAL_TYPES.forEach((type) => {
      const o = document.createElement('option');
      o.value = type; o.textContent = tg('types', type);
      sel.appendChild(o);
    });
    sel.value = cur;
  }

  function buildExportSelect() {
    const sel = $('#exportAll');
    sel.innerHTML = '';
    const opts = [['', t('exportFormat')], ['text', t('exportText')], ['html', t('exportHtml')],
      ['bibtex', 'BibTeX (.bib)'], ['ris', 'RIS (.ris)'], ['json', t('exportJson')]];
    opts.forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      sel.appendChild(o);
    });
  }

  /* --------------------------------------------------------- entrada -----*/
  function onInput() {
    const raw = $('#heroInput').value.trim();
    clearTimeout(state.debounce);
    if (!raw) { hideChip(); setCandidates([]); return; }
    const c = window.CiteAPI.classify(raw);
    showChip(c.type);
    state.debounce = setTimeout(() => runResolve(raw), c.type === 'query' ? 350 : 120);
  }

  async function runResolve(raw) {
    if (state.abort) state.abort.abort();
    state.abort = new AbortController();
    const timeout = setTimeout(() => state.abort.abort(), 9000);
    setStatus('loading', tg('status', 'loading'));
    try {
      const results = await window.CiteAPI.resolve(raw, state.abort.signal);
      clearTimeout(timeout);
      if (!results.length) {
        setStatus('empty', tg('status', 'none')); setCandidates([]); openManual(); return;
      }
      if (results.length === 1) {
        setStatus('ok', tg('status', 'found')); setCandidates([]); setCurrent(results[0]);
      } else {
        setStatus('ok', tg('status', 'foundMany').replace('%n', results.length)); setCandidates(results);
      }
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') return;
      setStatus('error', tg('status', 'error'));
    }
  }

  /* ----------------------------------------------------- chip + estado ---*/
  function showChip(type) {
    const chip = $('#typeChip');
    const label = tg('chips', type);
    if (!label || label === type) { hideChip(); return; }
    chip.textContent = label; chip.hidden = false;
  }
  function hideChip() { $('#typeChip').hidden = true; setStatus('idle', ''); }

  function setStatus(kind, msg) {
    const el = $('#status');
    el.className = 'status status--' + kind;
    el.innerHTML = kind === 'loading'
      ? `<span class="spinner" aria-hidden="true"></span> ${esc(msg)}` : esc(msg);
  }

  /* ------------------------------------------------------ candidatos ------*/
  function setCandidates(list) {
    state.candidates = list;
    const box = $('#candidates');
    box.innerHTML = '';
    if (!list.length) { box.hidden = true; return; }
    box.hidden = false;
    list.forEach((it) => {
      const authors = window.CiteEngine.helpers.names(it, 'author')
        .slice(0, 3).map((a) => a.family || a.literal).filter(Boolean).join(', ');
      const yr = window.CiteEngine.helpers.year(it);
      const meta = [authors, yr, it['container-title']].filter(Boolean).join(' · ');
      const card = document.createElement('button');
      card.className = 'candidate'; card.type = 'button';
      card.innerHTML = `<span class="candidate__title">${esc(it.title || '—')}</span>
        <span class="candidate__meta">${esc(meta)}</span>
        <span class="candidate__type">${esc(tg('types', it.type) || '')}</span>`;
      card.addEventListener('click', () => { setCurrent(it); setCandidates([]); });
      box.appendChild(card);
    });
  }

  /* ------------------------------------------------------ vista previa ----*/
  function setCurrent(item) {
    state.current = item;
    renderPreview();
    $('#previewCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderPreview() {
    const card = $('#previewCard');
    const out = $('#previewText');
    const warnBox = $('#previewWarnings');
    const actions = $('#previewActions');
    $('#previewStyleTag').textContent = window.CiteEngine.STYLES[state.style].label;
    if (!state.current) {
      card.classList.add('is-empty');
      out.innerHTML = `<span class="placeholder">${esc(t('previewPlaceholder'))}</span>`;
      warnBox.hidden = true; actions.hidden = true; return;
    }
    card.classList.remove('is-empty');
    out.innerHTML = window.CiteEngine.format(state.current, state.style, state.lang).html;

    const warns = window.CiteEngine.validate(state.current);
    if (warns.length) {
      warnBox.hidden = false;
      warnBox.innerHTML = warns.map((k) => `<span class="warn">⚠ ${esc(tg('warn', k))}</span>`).join('');
    } else { warnBox.hidden = true; }
    actions.hidden = false;
  }

  /* --------------------------------------------- acciones vista previa ----*/
  function onPreviewAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || !state.current) return;
    const act = btn.dataset.act;
    const item = state.current;
    if (act === 'copy') copyFormatted(item, btn);
    else if (act === 'copytext') copyPlain(item, btn);
    else if (act === 'bibtex') download(`${window.CiteEngine.bibtex(item)}\n`, filename(item, 'bib'), 'text/plain');
    else if (act === 'ris') download(`${window.CiteEngine.ris(item)}\n`, filename(item, 'ris'), 'text/plain');
    else if (act === 'add') addToLibrary(item, btn);
    else if (act === 'edit') editInManual(item);
  }

  async function copyFormatted(item, btn) {
    const { html, text } = window.CiteEngine.format(item, state.style, state.lang);
    const wrapped = `<div style="text-indent:-2em;padding-left:2em;line-height:1.6">${html}</div>`;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([wrapped], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
      } else { await navigator.clipboard.writeText(text); }
      flash(btn, t('copied'));
    } catch (_) { legacyCopy(text, btn); }
  }
  async function copyPlain(item, btn) {
    const { text } = window.CiteEngine.format(item, state.style, state.lang);
    try { await navigator.clipboard.writeText(text); flash(btn, t('copied')); }
    catch (_) { legacyCopy(text, btn); }
  }
  function legacyCopy(text, btn) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); flash(btn, t('copied')); } catch (_) {}
    document.body.removeChild(ta);
  }

  /* ----------------------------------------------------- biblioteca ------*/
  function addToLibrary(item, btn) {
    const key = libKey(item);
    if (state.library.some((x) => libKey(x) === key)) { if (btn) flash(btn, t('alreadyIn')); return; }
    state.library.unshift(Object.assign({ _id: uid() }, item));
    save(LS_LIB, state.library);
    renderLibrary();
    if (btn) flash(btn, t('added'));
    $('#heroInput').value = ''; hideChip(); setCandidates([]);
    state.current = null; renderPreview(); $('#heroInput').focus();
  }

  function renderLibrary() {
    const box = $('#library');
    box.innerHTML = '';
    $('#libCount').textContent = state.library.length;
    $('#libraryEmpty').hidden = state.library.length > 0;
    $('#libraryTools').hidden = state.library.length === 0;

    const numeric = ['ieee', 'vancouver'].includes(state.style);
    let list = state.library.slice();
    if (!numeric) {
      list.sort((a, b) => fmt(a).text.localeCompare(fmt(b).text, state.lang));
    }
    list.forEach((it, idx) => {
      const li = document.createElement('li');
      li.className = 'ref';
      li.innerHTML =
        `${numeric ? `<span class="ref__num">[${idx + 1}]</span>` : '<span class="ref__bullet"></span>'}
         <div class="ref__body">${fmt(it).html}</div>
         <div class="ref__actions">
           <button class="icon-btn" data-libact="copy" data-id="${it._id}" title="Copy">⧉</button>
           <button class="icon-btn" data-libact="edit" data-id="${it._id}" title="Edit">✎</button>
           <button class="icon-btn icon-btn--danger" data-libact="del" data-id="${it._id}" title="Delete">✕</button>
         </div>`;
      box.appendChild(li);
    });
  }
  const fmt = (it) => window.CiteEngine.format(it, state.style, state.lang);

  function onLibraryAction(e) {
    const btn = e.target.closest('[data-libact]');
    if (!btn) return;
    const item = state.library.find((x) => x._id === btn.dataset.id);
    if (!item) return;
    const act = btn.dataset.libact;
    if (act === 'del') { state.library = state.library.filter((x) => x._id !== item._id); save(LS_LIB, state.library); renderLibrary(); }
    else if (act === 'copy') copyPlain(item, btn);
    else if (act === 'edit') editInManual(item);
  }

  function onExportAll(e) {
    const f = e.target.value; e.target.selectedIndex = 0;
    if (!state.library.length || !f) return;
    if (f === 'bibtex') download(state.library.map(window.CiteEngine.bibtex).join('\n\n') + '\n', 'citefast-library.bib', 'text/plain');
    else if (f === 'ris') download(state.library.map(window.CiteEngine.ris).join('\n\n') + '\n', 'citefast-library.ris', 'text/plain');
    else if (f === 'json') download(JSON.stringify(state.library, null, 2), 'citefast-library.json', 'application/json');
    else if (f === 'text' || f === 'html') {
      const numeric = ['ieee', 'vancouver'].includes(state.style);
      let list = state.library.slice();
      if (!numeric) list.sort((a, b) => fmt(a).text.localeCompare(fmt(b).text, state.lang));
      if (f === 'text') {
        download(list.map((it, i) => `${numeric ? '[' + (i + 1) + '] ' : ''}${fmt(it).text}`).join('\n\n') + '\n', 'references.txt', 'text/plain');
      } else {
        const body = list.map((it, i) => `<p style="text-indent:-2em;padding-left:2em">${numeric ? '[' + (i + 1) + '] ' : ''}${fmt(it).html}</p>`).join('\n');
        download(`<!doctype html><meta charset="utf-8"><title>References</title><body style="font-family:Georgia,serif;max-width:40em;margin:2em auto">${body}</body>`, 'references.html', 'text/html');
      }
    }
  }

  /* ----------------------------------------------- formulario manual -----*/
  const FIELD_MAP = {
    'article-journal': ['author', 'title', 'container', 'year', 'volume', 'issue', 'page', 'doi'],
    'book': ['author', 'title', 'year', 'edition', 'place', 'publisher', 'isbn'],
    'chapter': ['author', 'title', 'editor', 'container', 'year', 'page', 'publisher'],
    'paper-conference': ['author', 'title', 'container', 'year', 'page', 'place'],
    'thesis': ['author', 'title', 'year', 'publisher'],
    'report': ['author', 'title', 'year', 'number', 'publisher'],
    'webpage': ['author', 'title', 'container', 'year', 'url'],
    'dataset': ['author', 'title', 'year', 'publisher', 'doi'],
  };

  function updateManualFields() {
    const type = $('#manualType').value || 'article-journal';
    const wrap = $('#manualFields');
    wrap.innerHTML = '';
    (FIELD_MAP[type] || FIELD_MAP['article-journal']).forEach((f) => {
      const id = 'mf_' + f;
      const isArea = (f === 'author' || f === 'editor');
      const field = document.createElement('label');
      field.className = 'field' + (isArea ? ' field--wide' : '');
      field.innerHTML = `<span>${esc(tg('fields', f))}</span>` +
        (isArea ? `<textarea id="${id}" rows="2"></textarea>` : `<input id="${id}" type="text">`);
      wrap.appendChild(field);
    });
  }

  function buildFromManual() {
    const type = $('#manualType').value;
    const get = (f) => { const el = $('#mf_' + f); return el ? el.value.trim() : ''; };
    const parsePeople = (txt) => txt.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
      if (l.includes(',')) { const [fam, giv] = l.split(','); return { family: fam.trim(), given: (giv || '').trim() }; }
      const parts = l.split(/\s+/); return { family: parts.slice(-1)[0], given: parts.slice(0, -1).join(' ') };
    });
    const item = { type };
    const authors = get('author'); if (authors) item.author = parsePeople(authors);
    const eds = get('editor'); if (eds) item.editor = parsePeople(eds);
    if (get('title')) item.title = get('title');
    if (get('container')) item['container-title'] = get('container');
    if (get('year')) item.issued = { 'date-parts': [[parseInt(get('year'), 10)]] };
    ['volume', 'issue', 'page', 'publisher', 'edition', 'number'].forEach((f) => { if (get(f)) item[f] = get(f); });
    if (get('place')) item['publisher-place'] = get('place');
    if (get('doi')) item.DOI = get('doi');
    if (get('url')) item.URL = get('url');
    if (get('isbn')) item.ISBN = get('isbn');
    if (!item.title) { alert(t('needTitle')); return; }
    setCurrent(item);
  }

  function editInManual(item) {
    openManual();
    $('#manualType').value = item.type || 'article-journal';
    updateManualFields();
    const set = (f, v) => { const el = $('#mf_' + f); if (el && v != null) el.value = v; };
    const peopleStr = (arr) => (arr || []).map((p) => p.literal || `${p.family || ''}${p.given ? ', ' + p.given : ''}`).join('\n');
    set('author', peopleStr(item.author));
    set('editor', peopleStr(item.editor));
    set('title', item.title);
    set('container', item['container-title']);
    set('year', window.CiteEngine.helpers.year(item));
    ['volume', 'issue', 'page', 'publisher', 'edition', 'number'].forEach((f) => set(f, item[f]));
    set('place', item['publisher-place']);
    set('doi', item.DOI); set('url', item.URL); set('isbn', item.ISBN);
    $('#manualBody').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function openManual() {
    $('#manualBody').removeAttribute('hidden');
    $('#manualToggle').setAttribute('aria-expanded', 'true');
  }

  /* --------------------------------------------------------- FAQ + guía --*/
  function renderFAQ() {
    const d = dict();
    const sg = $('#styleGuideTable');
    sg.innerHTML = `<table><thead><tr><th>${esc(d.styleGuideCols.style)}</th><th>${esc(d.styleGuideCols.field)}</th></tr></thead><tbody>` +
      d.styleGuide.map((r) => `<tr><td><b>${esc(r.s)}</b></td><td>${esc(r.f)}</td></tr>`).join('') + '</tbody></table>';
    $('#faqList').innerHTML = d.faq.map((it) =>
      `<details class="faq__item"><summary>${esc(it.q)}</summary><div class="faq__a">${it.a}</div></details>`).join('');
  }

  /* ---------------------------------------------------------- helpers ----*/
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : (cur === 'light' ? 'dark' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'));
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(LS_THEME, next);
  }
  function filename(item, ext) {
    const a = window.CiteEngine.helpers.names(item, 'author')[0];
    const base = ((a && a.family) || (item.title || 'cita')).replace(/[^A-Za-z0-9]+/g, '_').slice(0, 30);
    return `${base}_${window.CiteEngine.helpers.year(item) || ''}.${ext}`;
  }
  function download(content, name, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }
  function flash(btn, msg) {
    if (!btn) return;
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old; btn.textContent = msg; btn.classList.add('is-flash');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('is-flash'); }, 1400);
  }
  function libKey(it) {
    return it.DOI ? 'doi:' + String(it.DOI).toLowerCase()
      : 'ti:' + (it.title || '').toLowerCase().replace(/\W+/g, '') + (window.CiteEngine.helpers.year(it) || '');
  }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function load(k, dflt) { try { return JSON.parse(localStorage.getItem(k)) || dflt; } catch (_) { return dflt; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
})();
