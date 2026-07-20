/* =========================================================================
   CiteFast — Capa de resolución de metadatos.
   Clasifica el input y consulta APIs públicas (con CORS), normaliza todo a
   nuestro modelo interno (subconjunto de CSL-JSON).
   Sin backend. Peticiones en paralelo, cancelables, con caché.
   ========================================================================= */
(function (global) {
  'use strict';

  // Cambia esto por tu email real para entrar al "polite pool" de Crossref/OpenAlex.
  const MAILTO = 'contacto@citefast.app';

  const cache = new Map(); // query normalizada -> resultados

  /* ---------------------------------------------------------- clasificador */
  function classify(raw) {
    const s = (raw || '').trim();
    if (!s) return { type: 'empty', value: s };

    const doiMatch = s.match(/10\.\d{4,9}\/[^\s"'<>]+/i);
    if (/^(https?:\/\/(dx\.)?doi\.org\/)?10\.\d{4,9}\//i.test(s) || (doiMatch && s.length < 120)) {
      return { type: 'doi', value: doiMatch ? doiMatch[0].replace(/[.,;]$/, '') : s };
    }
    const isbnRaw = s.replace(/[\s-]/g, '');
    if (/^(97[89])?\d{9}[\dXx]$/.test(isbnRaw)) return { type: 'isbn', value: isbnRaw };

    if (/^https?:\/\//i.test(s)) {
      const inner = s.match(/10\.\d{4,9}\/[^\s"'<>?#]+/i);
      if (inner) return { type: 'doi', value: inner[0] };
      return { type: 'url', value: s };
    }
    if (/^\d{6,9}$/.test(s)) return { type: 'pmid', value: s };
    return { type: 'query', value: s };
  }

  /* --------------------------------------------------------------- fetch --*/
  function withMailto(url) {
    return url + (url.includes('?') ? '&' : '?') + 'mailto=' + encodeURIComponent(MAILTO);
  }
  async function getJSON(url, { signal, headers } = {}) {
    const res = await fetch(url, { signal, headers, mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* --------------------------------------------------- normalizadores -----*/
  const CSL_TYPE = {
    'journal-article': 'article-journal', 'article-journal': 'article-journal',
    'book': 'book', 'monograph': 'book', 'book-chapter': 'chapter',
    'chapter': 'chapter', 'proceedings-article': 'paper-conference',
    'paper-conference': 'paper-conference', 'posted-content': 'article',
    'dissertation': 'thesis', 'thesis': 'thesis', 'report': 'report',
    'dataset': 'dataset', 'webpage': 'webpage', 'article': 'article',
  };
  const mapType = (t) => CSL_TYPE[t] || 'article-journal';

  function first(arr) { return Array.isArray(arr) ? arr[0] : arr; }

  // doi.org content negotiation ya devuelve CSL-JSON: casi passthrough.
  function fromCSL(j) {
    return clean({
      type: mapType(j.type),
      title: first(j.title),
      author: (j.author || []).map((a) => ({ family: a.family, given: a.given, literal: a.literal || (a.name && !a.family ? a.name : undefined) })),
      editor: (j.editor || []).map((a) => ({ family: a.family, given: a.given, literal: a.literal })),
      'container-title': first(j['container-title']),
      'collection-title': first(j['collection-title']),
      issued: j.issued,
      DOI: j.DOI, URL: j.URL, ISBN: first(j.ISBN), ISSN: first(j.ISSN),
      volume: j.volume, issue: j.issue, page: j.page,
      publisher: j.publisher, 'publisher-place': j['publisher-place'],
      edition: j.edition, number: j.number,
    });
  }

  function fromCrossref(m) {
    return clean({
      type: mapType(m.type),
      title: first(m.title),
      author: (m.author || []).map((a) => ({ family: a.family, given: a.given, literal: a.name })),
      editor: (m.editor || []).map((a) => ({ family: a.family, given: a.given })),
      'container-title': first(m['container-title']),
      issued: m.issued || m['published-print'] || m['published-online'],
      DOI: m.DOI, URL: m.URL, ISBN: first(m.ISBN), ISSN: first(m.ISSN),
      volume: m.volume, issue: m.issue, page: m.page,
      publisher: m.publisher, edition: m['edition-number'],
    });
  }

  function fromOpenAlex(w) {
    const auth = (w.authorships || []).map((a) => {
      const dn = (a.author && a.author.display_name) || '';
      const parts = dn.trim().split(/\s+/);
      const family = parts.length > 1 ? parts.slice(-1)[0] : dn;
      const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
      return { family, given };
    });
    const loc = w.primary_location || {};
    const src = loc.source || {};
    const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : undefined;
    return clean({
      type: mapType(w.type === 'article' ? 'journal-article' : w.type),
      title: w.title || w.display_name,
      author: auth,
      'container-title': src.display_name,
      issued: w.publication_year ? { 'date-parts': [[w.publication_year]] } : undefined,
      DOI: doi, URL: loc.landing_page_url,
      volume: w.biblio && w.biblio.volume, issue: w.biblio && w.biblio.issue,
      page: (w.biblio && w.biblio.first_page)
        ? (w.biblio.last_page ? `${w.biblio.first_page}-${w.biblio.last_page}` : w.biblio.first_page)
        : undefined,
      ISSN: src.issn_l,
    });
  }

  function fromGoogleBooks(v) {
    const vi = v.volumeInfo || {};
    const isbn = (vi.industryIdentifiers || []).find((x) => /ISBN/.test(x.type));
    const y = vi.publishedDate ? parseInt(vi.publishedDate.slice(0, 4), 10) : undefined;
    return clean({
      type: 'book',
      title: vi.subtitle ? `${vi.title}: ${vi.subtitle}` : vi.title,
      author: (vi.authors || []).map((n) => {
        const parts = n.trim().split(/\s+/);
        return { family: parts.slice(-1)[0], given: parts.slice(0, -1).join(' ') };
      }),
      issued: y ? { 'date-parts': [[y]] } : undefined,
      publisher: vi.publisher,
      ISBN: isbn && isbn.identifier,
      URL: vi.infoLink,
    });
  }

  function fromOpenLibrary(d) {
    const y = d.publish_date ? parseInt((d.publish_date.match(/\d{4}/) || [])[0], 10) : undefined;
    return clean({
      type: 'book',
      title: d.title,
      author: (d.authors || []).map((a) => {
        const parts = (a.name || '').trim().split(/\s+/);
        return { family: parts.slice(-1)[0], given: parts.slice(0, -1).join(' ') };
      }),
      issued: y ? { 'date-parts': [[y]] } : undefined,
      publisher: first(d.publishers) && (first(d.publishers).name || first(d.publishers)),
      'publisher-place': first(d.publish_places) && (first(d.publish_places).name),
      URL: d.url,
    });
  }

  function fromPubMed(s, pmid) {
    const authors = (s.authors || []).map((a) => {
      const parts = (a.name || '').split(/\s+/);
      // PubMed devuelve "Family AB"
      return { family: parts[0], given: (parts[1] || '').split('').join(' ') };
    });
    const y = s.pubdate ? parseInt((s.pubdate.match(/\d{4}/) || [])[0], 10) : undefined;
    const doi = (s.articleids || []).find((x) => x.idtype === 'doi');
    return clean({
      type: 'article-journal',
      title: s.title,
      author: authors,
      'container-title': s.fulljournalname || s.source,
      issued: y ? { 'date-parts': [[y]] } : undefined,
      volume: s.volume, issue: s.issue, page: s.pages,
      DOI: doi && doi.value,
      URL: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    });
  }

  const dec = (s) => (typeof s === 'string' ? CiteEngine.helpers.decodeEntities(s) : s);

  function clean(o) {
    Object.keys(o).forEach((k) => {
      let v = o[k];
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) { delete o[k]; return; }
      if (typeof v === 'string') o[k] = dec(v);
    });
    ['author', 'editor'].forEach((key) => {
      if (o[key]) {
        o[key] = o[key].filter((a) => a.family || a.given || a.literal).map((a) => ({
          family: dec(a.family), given: dec(a.given), literal: dec(a.literal),
        }));
      }
    });
    return o;
  }

  /* ------------------------------------------------------ resolvers -------*/
  async function resolveDOI(doi, signal) {
    // 1) doi.org content negotiation -> CSL-JSON directo.
    try {
      const j = await getJSON('https://doi.org/' + encodeURI(doi), {
        signal, headers: { Accept: 'application/vnd.citationstyles.csl+json' },
      });
      return [fromCSL(j)];
    } catch (_) { /* fallback */ }
    // 2) Crossref.
    const j = await getJSON(withMailto('https://api.crossref.org/works/' + encodeURIComponent(doi)), { signal });
    return [fromCrossref(j.message)];
  }

  async function resolveISBN(isbn, signal) {
    const out = [];
    try {
      const g = await getJSON(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`, { signal });
      if (g.items && g.items.length) out.push(fromGoogleBooks(g.items[0]));
    } catch (_) {}
    if (!out.length) {
      try {
        const o = await getJSON(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { signal });
        const rec = o[`ISBN:${isbn}`];
        if (rec) out.push(fromOpenLibrary(rec));
      } catch (_) {}
    }
    return out;
  }

  async function resolvePMID(pmid, signal) {
    const s = await getJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`, { signal });
    const rec = s.result && s.result[pmid];
    if (!rec) throw new Error('PMID no encontrado');
    return [fromPubMed(rec, pmid)];
  }

  async function resolveQuery(q, signal) {
    const results = [];
    const tasks = [
      // Crossref bibliographic search
      getJSON(withMailto(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=5&select=DOI,title,author,issued,container-title,volume,issue,page,type,ISSN`), { signal })
        .then((j) => (j.message.items || []).map(fromCrossref)).catch(() => []),
      // OpenAlex search
      getJSON(withMailto(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=5`), { signal })
        .then((j) => (j.results || []).map(fromOpenAlex)).catch(() => []),
      // Google Books (por si es un libro)
      getJSON(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3`, { signal })
        .then((j) => (j.items || []).map(fromGoogleBooks)).catch(() => []),
    ];
    const settled = await Promise.allSettled(tasks);
    settled.forEach((r) => { if (r.status === 'fulfilled') results.push(...r.value); });
    return rankAndDedupe(results, q);
  }

  /* ------------------------------------------------ ranking + dedupe ------*/
  function normTitle(t) { return (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function rankAndDedupe(items, q) {
    const seen = new Set();
    const nq = normTitle(q);
    const scored = [];
    for (const it of items) {
      if (!it.title) continue;
      const dkey = it.DOI ? 'doi:' + it.DOI.toLowerCase() : 'ti:' + normTitle(it.title) + '|' + CiteEngine.helpers.year(it);
      if (seen.has(dkey)) continue;
      seen.add(dkey);
      const nt = normTitle(it.title);
      let score = 0;
      if (nt === nq) score += 100;
      else if (nt.includes(nq) || nq.includes(nt)) score += 50;
      score += overlap(nt, nq) * 10;
      if (it.DOI) score += 8;
      if (CiteEngine.helpers.names(it, 'author').length) score += 3;
      const y = parseInt(CiteEngine.helpers.year(it), 10);
      if (y) score += Math.min(5, Math.max(0, (y - 1990) / 10));
      scored.push({ it, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 6).map((s) => s.it);
  }
  function overlap(a, b) {
    const A = new Set(a.split(' ').filter(Boolean));
    const B = new Set(b.split(' ').filter(Boolean));
    if (!A.size || !B.size) return 0;
    let c = 0; A.forEach((w) => { if (B.has(w)) c++; });
    return c / Math.max(A.size, B.size);
  }

  /* ----------------------------------------------------- API pública ------*/
  async function resolve(raw, signal) {
    const key = (raw || '').trim().toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const c = classify(raw);
    let out = [];
    switch (c.type) {
      case 'doi': out = await resolveDOI(c.value, signal); break;
      case 'isbn': out = await resolveISBN(c.value, signal); break;
      case 'pmid': out = await resolvePMID(c.value, signal); break;
      case 'query': out = await resolveQuery(c.value, signal); break;
      case 'url': out = await resolveURL(c.value, signal); break;
      default: out = [];
    }
    if (out.length) cache.set(key, out);
    return out;
  }

  async function resolveURL(url, signal) {
    // Sin DOI extraíble: devolvemos un esqueleto de "webpage" con la URL y el
    // hostname como sitio. El usuario completa título/autor a mano.
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
    return [clean({ type: 'webpage', title: '', URL: url, 'container-title': host,
      accessed: { 'date-parts': [[new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()]] } })];
  }

  /* ==================================================================
     BULK: extracción rigurosa de identificadores + resolución en lote.
     Solo identificadores inequívocos (DOI, arXiv, PMID, ISBN). No se
     "adivinan" citas a partir de texto libre.
     ================================================================== */
  function extractIdentifiers(text) {
    const found = [];
    const seen = new Set();
    const push = (type, value, raw) => {
      const k = type + ':' + String(value).toLowerCase();
      if (!seen.has(k)) { seen.add(k); found.push({ type, value, raw: raw || value }); }
    };
    let m;

    // DOI (excluye paréntesis/corchetes; limpia puntuación final)
    (text.match(/10\.\d{4,9}\/[^\s"'<>()\[\]{}]+/g) || []).forEach((d) => {
      d = d.replace(/[.,;:)\]}>]+$/, '');
      if (d.length > 7) push('doi', d);
    });

    // arXiv → se mapea a su DOI oficial (10.48550/arXiv.ID)
    const arx = /arxiv[:\s]+([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(v\d+)?/gi;
    while ((m = arx.exec(text))) push('doi', '10.48550/arXiv.' + m[1], 'arXiv:' + m[1]);

    // PMID (requiere prefijo explícito para no capturar números sueltos)
    const pmid = /pmid[:\s]+(\d{6,9})/gi;
    while ((m = pmid.exec(text))) push('pmid', m[1], 'PMID: ' + m[1]);

    // ISBN (requiere prefijo; valida longitud 10/13)
    const isbn = /isbn(?:-1[03])?[:\s]+([\dX][\d\- –X]{8,16}[\dX])/gi;
    while ((m = isbn.exec(text))) {
      const v = m[1].replace(/[^\dX]/gi, '');
      if (v.length === 10 || v.length === 13) push('isbn', v, 'ISBN ' + v);
    }
    return found;
  }

  async function resolveMany(ids, opts) {
    opts = opts || {};
    const concurrency = opts.concurrency || 4;
    const signal = opts.signal;
    const onProgress = opts.onProgress;
    const results = new Array(ids.length);
    let idx = 0, done = 0;

    async function worker() {
      while (idx < ids.length) {
        const i = idx++;
        const id = ids[i];
        try {
          let items = [];
          if (id.type === 'doi') items = await resolveDOI(id.value, signal);
          else if (id.type === 'pmid') items = await resolvePMID(id.value, signal);
          else if (id.type === 'isbn') items = await resolveISBN(id.value, signal);
          const ok = !!(items && items.length && items[0].title);
          results[i] = { id, ok, item: ok ? items[0] : null, error: ok ? null : 'notfound' };
        } catch (e) {
          results[i] = { id, ok: false, item: null, error: e.name === 'AbortError' ? 'abort' : 'error' };
        }
        done++;
        if (onProgress) onProgress(done, ids.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length || 1) }, worker));
    return results;
  }

  global.CiteAPI = { classify, resolve, extractIdentifiers, resolveMany, MAILTO };
})(window);
