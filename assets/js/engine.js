/* =========================================================================
   CiteFast — Motor de citas (Vanilla JS, sin dependencias)
   Modelo interno: subconjunto de CSL-JSON.
   Estilos: APA 7, MLA 9, Chicago (author-date), IEEE, Vancouver, ABNT.
   Cada formateador devuelve { html, text }.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ util */
  const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio',
    'agosto','septiembre','octubre','noviembre','diciembre'];
  const MONTHS_EN = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];

  /* --- Términos de cita localizados (dentro de la referencia, no la UI) --- */
  const TERMS = {
    en: { in: 'In', ed: 'Ed.', eds: 'Eds.', editedBy: 'edited by', nd: 'n.d.', pp: 'pp.', thesisLbl: 'Thesis', datasetLbl: 'Data set', reportNo: 'Report No.', availableFrom: 'Available from:', internet: 'Internet', edAbbr: 'ed.' },
    es: { in: 'En', ed: 'Ed.', eds: 'Eds.', editedBy: 'editado por', nd: 's. f.', pp: 'pp.', thesisLbl: 'Tesis', datasetLbl: 'Conjunto de datos', reportNo: 'Informe n.º', availableFrom: 'Disponible en:', internet: 'Internet', edAbbr: 'ed.' },
    pt: { in: 'Em', ed: 'Ed.', eds: 'Eds.', editedBy: 'editado por', nd: 's.d.', pp: 'pp.', thesisLbl: 'Tese', datasetLbl: 'Conjunto de dados', reportNo: 'Relatório n.º', availableFrom: 'Disponível em:', internet: 'Internet', edAbbr: 'ed.' },
    fr: { in: 'Dans', ed: 'dir.', eds: 'dir.', editedBy: 'sous la direction de', nd: 's.d.', pp: 'p.', thesisLbl: 'Thèse', datasetLbl: 'Jeu de données', reportNo: 'Rapport n°', availableFrom: 'Disponible à l’adresse :', internet: 'Internet', edAbbr: 'éd.' },
    de: { in: 'In', ed: 'Hrsg.', eds: 'Hrsg.', editedBy: 'herausgegeben von', nd: 'o.J.', pp: 'S.', thesisLbl: 'Dissertation', datasetLbl: 'Datensatz', reportNo: 'Bericht Nr.', availableFrom: 'Verfügbar unter:', internet: 'Internet', edAbbr: 'Aufl.' },
  };
  const terms = (lang) => TERMS[lang] || TERMS.en;

  function ordinalEd(ed, lang) {
    const T = terms(lang);
    const n = parseInt(ed, 10);
    if (isNaN(n)) return `${ed} ${T.edAbbr}`;
    if (lang === 'en') { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]} ${T.edAbbr}`; }
    if (lang === 'es' || lang === 'pt') return `${n}.ª ${T.edAbbr}`;
    if (lang === 'fr') return `${n}e ${T.edAbbr}`;
    if (lang === 'de') return `${n}. ${T.edAbbr}`;
    return `${n} ${T.edAbbr}`;
  }
  function getYear(item, lang) {
    const { y } = dateParts(item);
    return y != null ? String(y) : terms(lang).nd;
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const nonEmpty = (s) => s != null && String(s).trim() !== '';

  // Minor words that stay lowercase in title case (unless first/last).
  const MINOR = new Set(['a','an','and','as','at','but','by','for','if','in',
    'nor','of','off','on','or','per','so','the','to','up','via','vs','yet',
    'with','from','into','onto','over','than','that','when']);

  function titleCase(str) {
    if (!nonEmpty(str)) return str || '';
    const tokens = String(str).split(/(\s+)/);
    const words = tokens.filter((t) => !/^\s+$/.test(t));
    let wi = 0;
    return tokens.map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      const isFirst = wi === 0;
      const isLast = wi === words.length - 1;
      wi++;
      const bare = tok.replace(/[^A-Za-zÀ-ÿ].*$/, '');
      if (isPreserved(tok)) return tok;
      const lower = tok.toLowerCase();
      if (!isFirst && !isLast && MINOR.has(bare.toLowerCase())) return lower;
      return capFirst(lower);
    }).join('');
  }

  // Best-effort sentence case (APA titles). Preserves acronyms & proper-ish tokens.
  function sentenceCase(str) {
    if (!nonEmpty(str)) return str || '';
    const tokens = String(str).split(/(\s+)/);
    let capitalizeNext = true;
    return tokens.map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      const cap = capitalizeNext;
      // Capitalize the word after a colon / question / exclamation.
      capitalizeNext = /[:?!]$/.test(tok.trim());
      if (isPreserved(tok)) return tok;
      const lower = tok.toLowerCase();
      return cap ? capFirst(lower) : lower;
    }).join('');
  }

  // Preserve tokens that look like acronyms (all caps len>1) or have internal
  // capitals (iPhone, McArthur, DNA), so we never mangle proper nouns/brands.
  function isPreserved(tok) {
    const core = tok.replace(/^[^A-Za-zÀ-ÿ]+/, '').replace(/[^A-Za-zÀ-ÿ]+$/, '');
    if (core.length < 2) return false;
    if (core === core.toUpperCase() && /[A-ZÀ-Ý]/.test(core)) return true; // ALL CAPS
    if (/[A-ZÀ-Ý]/.test(core.slice(1))) return true;                        // internal cap
    return false;
  }

  const capFirst = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  const initials = (given, opts) => {
    if (!nonEmpty(given)) return '';
    const dot = opts && opts.noDot ? '' : '.';
    const sep = opts && opts.spaced ? ' ' : (opts && opts.tight ? '' : ' ');
    return String(given).trim().split(/[\s.\-]+/).filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + dot).join(sep).trim();
  };

  /* ----------------------------------------------------------------- dates */
  function dateParts(item) {
    const dp = item && item.issued && item.issued['date-parts'] && item.issued['date-parts'][0];
    if (!dp || !dp.length) return {};
    return { y: dp[0], m: dp[1], d: dp[2] };
  }
  function year(item) {
    const { y } = dateParts(item);
    return y != null ? String(y) : 's. f.'; // "sin fecha"
  }
  function yearRaw(item) {
    const { y } = dateParts(item);
    return y != null ? String(y) : '';
  }
  function accessedDate(item, lang) {
    const dp = item && item.accessed && item.accessed['date-parts'] && item.accessed['date-parts'][0];
    if (!dp || !dp.length) return '';
    const months = lang === 'en' ? MONTHS_EN : MONTHS;
    const [y, m, d] = dp;
    if (m && d) return `${d} de ${months[m - 1]} de ${y}`;
    return String(y || '');
  }

  /* --------------------------------------------------------------- authors */
  // people: array of {family, given, literal}
  function names(item, key) {
    const arr = (item && item[key]) || [];
    return arr.filter((a) => a && (nonEmpty(a.family) || nonEmpty(a.literal) || nonEmpty(a.given)));
  }

  // "Family, G. G." (APA / Chicago first author / ABNT-ish)
  function apaName(p) {
    if (nonEmpty(p.literal)) return p.literal;
    const fam = (p.family || '').trim();
    const ini = initials(p.given, { spaced: true });
    return ini ? `${fam}, ${ini}` : fam;
  }
  // "G. G. Family" (IEEE / MLA subsequent)
  function givenFirst(p) {
    if (nonEmpty(p.literal)) return p.literal;
    const ini = initials(p.given, { spaced: true });
    return ini ? `${ini} ${p.family || ''}`.trim() : (p.family || '');
  }
  // "Family GG" (Vancouver)
  function vancouverName(p) {
    if (nonEmpty(p.literal)) return p.literal;
    const ini = initials(p.given, { noDot: true, tight: true });
    return `${(p.family || '').trim()}${ini ? ' ' + ini : ''}`.trim();
  }
  // "SOBRENOME, Nome" (ABNT)
  function abntName(p) {
    if (nonEmpty(p.literal)) return p.literal.toUpperCase();
    const fam = (p.family || '').trim().toUpperCase();
    const giv = (p.given || '').trim();
    return giv ? `${fam}, ${giv}` : fam;
  }

  /* -------- author-list builders per style -------- */
  function apaAuthors(people) {
    if (!people.length) return '';
    const list = people.slice(0, 20).map(apaName);
    if (people.length === 1) return list[0];
    if (people.length <= 20) {
      return list.slice(0, -1).join(', ') + ', & ' + list[list.length - 1];
    }
    // 21+: first 19, ellipsis, last.
    const first19 = people.slice(0, 19).map(apaName).join(', ');
    return `${first19}, … ${apaName(people[people.length - 1])}`;
  }

  function mlaAuthors(people) {
    if (!people.length) return '';
    const first = apaNameFull(people[0]); // MLA: "Family, Given"
    if (people.length === 1) return first;
    if (people.length === 2) return `${first}, and ${givenFull(people[1])}`;
    return `${first}, et al`;
  }
  function apaNameFull(p) { // Family, Given (full given, MLA/Chicago)
    if (nonEmpty(p.literal)) return p.literal;
    const fam = (p.family || '').trim();
    const giv = (p.given || '').trim();
    return giv ? `${fam}, ${giv}` : fam;
  }
  function givenFull(p) {
    if (nonEmpty(p.literal)) return p.literal;
    return `${(p.given || '').trim()} ${(p.family || '').trim()}`.trim();
  }

  function chicagoAuthors(people) {
    if (!people.length) return '';
    const first = apaNameFull(people[0]);
    if (people.length === 1) return first;
    const rest = people.slice(1, 10).map(givenFull);
    if (people.length <= 10) {
      if (rest.length === 1) return `${first}, and ${rest[0]}`;
      return `${first}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`;
    }
    return `${first}, ${people.slice(1, 7).map(givenFull).join(', ')}, et al.`;
  }

  function ieeeAuthors(people) {
    if (!people.length) return '';
    const list = people.slice(0, 6).map(givenFirst);
    if (people.length > 6) return `${givenFirst(people[0])} et al.`;
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
  }

  function vancouverAuthors(people) {
    if (!people.length) return '';
    const list = people.slice(0, 6).map(vancouverName);
    let out = list.join(', ');
    if (people.length > 6) out += ', et al';
    return out;
  }

  function abntAuthors(people) {
    if (!people.length) return '';
    if (people.length > 3) return `${abntName(people[0])} et al.`;
    return people.map(abntName).join('; ');
  }

  /* ---------------------------------------------------------------- pieces */
  const i = (s) => `<i>${esc(s)}</i>`;               // italic (html)
  const pagesRange = (p) => (p || '').replace(/-+/g, '–'); // en-dash
  const pagesRangeBib = (p) => (p || '').replace(/–/g, '--');

  function doiUrl(item) {
    if (nonEmpty(item.DOI)) {
      const d = String(item.DOI).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
      return `https://doi.org/${d}`;
    }
    if (nonEmpty(item.URL)) return item.URL;
    return '';
  }

  /* =======================================================================
     STYLE: APA 7
     ======================================================================= */
  function apa7(item, lang) {
    const T = terms(lang);
    const people = names(item, 'author');
    const eds = names(item, 'editor');
    const A = apaAuthors(people);
    const yr = `(${getYear(item, lang)})`;
    const link = doiUrl(item);
    const linkHtml = link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : '';
    const linkText = link ? ` ${link}` : '';
    const t = item.type;

    let core, coreText;
    if (t === 'article-journal' || t === 'article' || t === 'paper-conference') {
      const title = sentenceCase(item.title);
      const jour = item['container-title'] || '';
      const vol = item.volume ? i(item.volume) : '';
      const iss = item.issue ? `(${esc(item.issue)})` : '';
      const pp = item.page ? esc(pagesRange(item.page)) : '';
      const jparts = [jour ? i(jour) : '', [vol, iss].filter(Boolean).join(''), pp]
        .filter(Boolean).join(', ');
      core = `${esc(title)}. ${jparts}.`;
      coreText = `${title}. ${strip(jparts)}.`;
    } else if (t === 'book') {
      const ed = item.edition ? ` (${esc(ordinalEd(item.edition, lang))})` : '';
      const pub = item.publisher ? `${esc(item.publisher)}.` : '';
      core = `${i(sentenceCase(item.title))}${ed}. ${pub}`;
      coreText = `${sentenceCase(item.title)}${strip(ed)}. ${item.publisher || ''}.`;
    } else if (t === 'chapter') {
      const edStr = eds.length
        ? eds.map((e) => `${initials(e.given, { spaced: true })} ${e.family}`.trim()).join(', ')
        : '';
      const inEd = edStr ? `${T.in} ${esc(edStr)} (${eds.length > 1 ? T.eds : T.ed}), ` : `${T.in} `;
      const pp = item.page ? ` (${T.pp} ${esc(pagesRange(item.page))})` : '';
      const pub = item.publisher ? `${esc(item.publisher)}.` : '';
      core = `${esc(sentenceCase(item.title))}. ${inEd}${i(item['container-title'] || '')}${pp}. ${pub}`;
      coreText = `${sentenceCase(item.title)}. ${strip(inEd)}${item['container-title'] || ''}${strip(pp)}. ${item.publisher || ''}.`;
    } else if (t === 'thesis') {
      const inst = item.publisher || item['container-title'] || '';
      core = `${i(sentenceCase(item.title))} [${T.thesisLbl}, ${esc(inst)}].`;
      coreText = `${sentenceCase(item.title)} [${T.thesisLbl}, ${inst}].`;
    } else if (t === 'report') {
      const num = item.number ? ` (${T.reportNo} ${esc(item.number)})` : '';
      const pub = item.publisher ? `${esc(item.publisher)}.` : '';
      core = `${i(sentenceCase(item.title))}${num}. ${pub}`;
      coreText = `${sentenceCase(item.title)}${strip(num)}. ${item.publisher || ''}.`;
    } else if (t === 'dataset') {
      const pub = item.publisher ? `${esc(item.publisher)}.` : '';
      core = `${i(sentenceCase(item.title))} [${T.datasetLbl}]. ${pub}`;
      coreText = `${sentenceCase(item.title)} [${T.datasetLbl}]. ${item.publisher || ''}.`;
    } else { // webpage / default
      const site = item['container-title'] ? `${esc(item['container-title'])}.` : '';
      core = `${i(sentenceCase(item.title))}. ${site}`;
      coreText = `${sentenceCase(item.title)}. ${item['container-title'] || ''}.`;
    }

    const authPart = A ? `${esc(A)} ` : '';
    const html = `${authPart}${yr}. ${core}${linkHtml}`.replace(/\s+\./g, '.').trim();
    const text = `${A ? A + ' ' : ''}${yr}. ${coreText}${linkText}`.replace(/\s+/g, ' ').trim();
    return { html, text };
  }

  /* =======================================================================
     STYLE: MLA 9
     ======================================================================= */
  function mla9(item, lang) {
    const T = terms(lang);
    const people = names(item, 'author');
    const A = mlaAuthors(people);
    const t = item.type;
    const link = doiUrl(item);
    const yr = yearRaw(item);
    let body, bodyText;

    if (t === 'article-journal' || t === 'article' || t === 'paper-conference') {
      const parts = [];
      if (item.volume) parts.push(`vol. ${esc(item.volume)}`);
      if (item.issue) parts.push(`no. ${esc(item.issue)}`);
      if (yr) parts.push(esc(yr));
      if (item.page) parts.push(`pp. ${esc(pagesRange(item.page))}`);
      body = `"${esc(titleCase(item.title))}." ${i(item['container-title'] || '')}, ${parts.join(', ')}`;
      bodyText = `"${titleCase(item.title)}." ${item['container-title'] || ''}, ${strip(parts.join(', '))}`;
    } else if (t === 'book' || t === 'thesis' || t === 'report' || t === 'dataset') {
      const pub = [item.publisher, yr].filter(Boolean).map(esc).join(', ');
      body = `${i(titleCase(item.title))}. ${pub}`;
      bodyText = `${titleCase(item.title)}. ${[item.publisher, yr].filter(Boolean).join(', ')}`;
    } else if (t === 'chapter') {
      const eds = names(item, 'editor').map(givenFull).join(', ');
      const editedBy = eds ? `${T.editedBy} ${esc(eds)}, ` : '';
      const pp = item.page ? `, pp. ${esc(pagesRange(item.page))}` : '';
      body = `"${esc(titleCase(item.title))}." ${i(item['container-title'] || '')}, ${editedBy}${esc([item.publisher, yr].filter(Boolean).join(', '))}${pp}`;
      bodyText = `"${titleCase(item.title)}." ${item['container-title'] || ''}, ${strip(editedBy)}${[item.publisher, yr].filter(Boolean).join(', ')}${strip(pp)}`;
    } else { // webpage / default
      const site = item['container-title'] ? `${i(item['container-title'])}, ` : '';
      const linkTxt = link ? `${esc(link.replace(/^https?:\/\//, ''))}` : '';
      body = `"${esc(titleCase(item.title))}." ${site}${yr ? esc(yr) + ', ' : ''}${linkTxt}`;
      bodyText = `"${titleCase(item.title)}." ${item['container-title'] ? item['container-title'] + ', ' : ''}${yr ? yr + ', ' : ''}${link ? link.replace(/^https?:\/\//, '') : ''}`;
    }

    const linkTail = (t !== 'webpage' && link)
      ? ((/^article|paper|thesis|dataset/.test(t) || item.DOI) ? `, <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : '')
      : '';
    const linkTailText = (t !== 'webpage' && link && (/^article|paper|thesis|dataset/.test(t) || item.DOI))
      ? `, ${link}` : '';

    const html = `${A ? esc(A) + '. ' : ''}${body}${linkTail}.`.replace(/\s+\./g, '.').trim();
    const text = `${A ? A + '. ' : ''}${bodyText}${linkTailText}.`.replace(/\s+/g, ' ').trim();
    return { html, text };
  }

  /* =======================================================================
     STYLE: Chicago 17 (author-date)
     ======================================================================= */
  function chicago(item, lang) {
    const T = terms(lang);
    const people = names(item, 'author');
    const A = chicagoAuthors(people);
    const yr = yearRaw(item) || T.nd;
    const link = doiUrl(item);
    const linkHtml = link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : '';
    const t = item.type;
    let body, bodyText;

    if (t === 'article-journal' || t === 'article' || t === 'paper-conference') {
      const vol = item.volume ? ` ${esc(item.volume)}` : '';
      const iss = item.issue ? ` (${esc(item.issue)})` : '';
      const pp = item.page ? `: ${esc(pagesRange(item.page))}` : '';
      body = `"${esc(titleCase(item.title))}." ${i(item['container-title'] || '')}${vol}${iss}${pp}.`;
      bodyText = `"${titleCase(item.title)}." ${item['container-title'] || ''}${strip(vol + iss)}${strip(pp)}.`;
    } else if (t === 'book') {
      const place = item['publisher-place'] ? `${esc(item['publisher-place'])}: ` : '';
      body = `${i(titleCase(item.title))}. ${place}${esc(item.publisher || '')}.`;
      bodyText = `${titleCase(item.title)}. ${item['publisher-place'] ? item['publisher-place'] + ': ' : ''}${item.publisher || ''}.`;
    } else if (t === 'chapter') {
      const eds = names(item, 'editor').map(givenFull).join(', ');
      const pp = item.page ? `, ${esc(pagesRange(item.page))}` : '';
      const place = item['publisher-place'] ? `${esc(item['publisher-place'])}: ` : '';
      body = `"${esc(titleCase(item.title))}." ${T.in} ${i(item['container-title'] || '')}${eds ? ', ' + T.editedBy + ' ' + esc(eds) : ''}${pp}. ${place}${esc(item.publisher || '')}.`;
      bodyText = `"${titleCase(item.title)}." ${T.in} ${item['container-title'] || ''}${eds ? ', ' + T.editedBy + ' ' + eds : ''}${strip(pp)}. ${item['publisher-place'] ? item['publisher-place'] + ': ' : ''}${item.publisher || ''}.`;
    } else {
      const site = item['container-title'] ? `${esc(item['container-title'])}. ` : '';
      body = `"${esc(titleCase(item.title))}." ${site}`;
      bodyText = `"${titleCase(item.title)}." ${item['container-title'] ? item['container-title'] + '. ' : ''}`;
    }

    const html = `${A ? esc(A) + '. ' : ''}${esc(yr)}. ${body}${linkHtml}`.replace(/\s+\./g, '.').trim();
    const text = `${A ? A + '. ' : ''}${yr}. ${bodyText}${link ? ' ' + link : ''}`.replace(/\s+/g, ' ').trim();
    return { html, text };
  }

  /* =======================================================================
     STYLE: IEEE
     ======================================================================= */
  function ieee(item) {
    const people = names(item, 'author');
    const A = ieeeAuthors(people);
    const yr = yearRaw(item);
    const link = doiUrl(item);
    const t = item.type;
    let body, bodyText;

    // Los cuerpos NO terminan en punto; el punto final se añade al ensamblar.
    if (t === 'article-journal' || t === 'article') {
      const parts = [];
      if (item.volume) parts.push(`vol. ${esc(item.volume)}`);
      if (item.issue) parts.push(`no. ${esc(item.issue)}`);
      if (item.page) parts.push(`pp. ${esc(pagesRange(item.page))}`);
      if (yr) parts.push(esc(yr));
      body = `"${esc(item.title)}," ${i(item['container-title'] || '')}, ${parts.join(', ')}`;
      bodyText = `"${item.title}," ${item['container-title'] || ''}, ${strip(parts.join(', '))}`;
    } else if (t === 'paper-conference') {
      const pp = item.page ? `, pp. ${esc(pagesRange(item.page))}` : '';
      body = `"${esc(item.title)}," in ${i(item['container-title'] || 'Proc.')}, ${yr ? esc(yr) : ''}${pp}`;
      bodyText = `"${item.title}," in ${item['container-title'] || 'Proc.'}, ${yr}${strip(pp)}`;
    } else if (t === 'book') {
      const ed = item.edition ? `, ${esc(item.edition)} ed.` : '';
      const place = item['publisher-place'] ? `${esc(item['publisher-place'])}: ` : '';
      body = `${i(item.title)}${ed}. ${place}${esc(item.publisher || '')}, ${esc(yr)}`;
      bodyText = `${item.title}${strip(ed)}. ${item['publisher-place'] ? item['publisher-place'] + ': ' : ''}${item.publisher || ''}, ${yr}`;
    } else {
      const site = item['container-title'] ? `${esc(item['container-title'])}. ` : '';
      const acc = link ? ` [Online]. Available: ${esc(link)}` : '';
      body = `"${esc(item.title)}," ${site}${yr ? '(' + esc(yr) + ').' : ''}${acc}`;
      bodyText = `"${item.title}," ${item['container-title'] ? item['container-title'] + '. ' : ''}${yr ? '(' + yr + ').' : ''}${link ? ' [Online]. Available: ' + link : ''}`;
      return { html: `${A ? esc(A) + ', ' : ''}${body}`.trim(), text: `${A ? A + ', ' : ''}${bodyText}`.replace(/\s+/g, ' ').trim() };
    }

    const doi = item.DOI ? String(item.DOI).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : '';
    const doiTail = doi ? `, doi: ${esc(doi)}` : '';
    const html = `${A ? esc(A) + ', ' : ''}${body}${doiTail}.`.trim();
    const text = `${A ? A + ', ' : ''}${bodyText}${doi ? ', doi: ' + doi : ''}.`.replace(/\s+/g, ' ').trim();
    return { html, text };
  }

  /* =======================================================================
     STYLE: Vancouver
     ======================================================================= */
  function vancouver(item, lang) {
    const T = terms(lang);
    const people = names(item, 'author');
    const A = vancouverAuthors(people);
    const yr = yearRaw(item);
    const t = item.type;
    let body, bodyText;

    if (t === 'article-journal' || t === 'article' || t === 'paper-conference') {
      const vi = `${yr}${item.volume ? ';' + esc(item.volume) : ''}${item.issue ? '(' + esc(item.issue) + ')' : ''}${item.page ? ':' + esc(pagesRange(item.page)) : ''}`;
      body = `${esc(item.title)}. ${esc(item['container-title'] || '')}. ${vi}.`;
      bodyText = `${item.title}. ${item['container-title'] || ''}. ${strip(vi)}.`;
    } else if (t === 'book') {
      const ed = item.edition ? `${esc(item.edition)} ed. ` : '';
      const place = item['publisher-place'] ? `${esc(item['publisher-place'])}: ` : '';
      body = `${esc(item.title)}. ${ed}${place}${esc(item.publisher || '')}; ${esc(yr)}.`;
      bodyText = `${item.title}. ${item.edition ? item.edition + ' ed. ' : ''}${item['publisher-place'] ? item['publisher-place'] + ': ' : ''}${item.publisher || ''}; ${yr}.`;
    } else {
      const site = item['container-title'] ? `${esc(item['container-title'])} ` : '';
      const link = doiUrl(item);
      body = `${esc(item.title)} [${T.internet}]. ${site}${yr ? esc(yr) + '. ' : ''}${link ? T.availableFrom + ' ' + esc(link) : ''}`;
      bodyText = `${item.title} [${T.internet}]. ${item['container-title'] ? item['container-title'] + ' ' : ''}${yr ? yr + '. ' : ''}${link ? T.availableFrom + ' ' + link : ''}`;
    }

    const html = `${A ? esc(A) + '. ' : ''}${body}`.replace(/\s+\./g, '.').trim();
    const text = `${A ? A + '. ' : ''}${bodyText}`.replace(/\s+/g, ' ').trim();
    return { html, text };
  }

  /* =======================================================================
     STYLE: ABNT (NBR 6023)
     ======================================================================= */
  function abnt(item) {
    const people = names(item, 'author');
    const A = abntAuthors(people);
    const yr = yearRaw(item) || '[s.d.]';
    const t = item.type;
    let body, bodyText;

    if (t === 'article-journal' || t === 'article' || t === 'paper-conference') {
      const parts = [];
      if (item.volume) parts.push(`v. ${esc(item.volume)}`);
      if (item.issue) parts.push(`n. ${esc(item.issue)}`);
      if (item.page) parts.push(`p. ${esc(pagesRange(item.page))}`);
      parts.push(esc(yr));
      body = `${esc(capFirst(item.title))}. ${i(item['container-title'] || '')}, ${parts.join(', ')}.`;
      bodyText = `${capFirst(item.title)}. ${item['container-title'] || ''}, ${strip(parts.join(', '))}.`;
    } else if (t === 'chapter') {
      const eds = names(item, 'editor').map((e) => `${(e.family || '').toUpperCase()}, ${e.given || ''}`.replace(/, $/, '')).join('; ');
      const place = item['publisher-place'] ? `${esc(item['publisher-place'])}: ` : '';
      const pp = item.page ? ` p. ${esc(pagesRange(item.page))}.` : '';
      const pub = item.publisher ? `${place}${esc(item.publisher)}, ${esc(yr)}.` : `${esc(yr)}.`;
      body = `${esc(capFirst(item.title))}. In: ${eds ? esc(eds) + '. ' : ''}${i(item['container-title'] || '')}. ${pub}${pp}`;
      bodyText = strip(body);
    } else if (t === 'book' || t === 'thesis' || t === 'report') {
      const ed = item.edition ? `${esc(item.edition)}. ed. ` : '';
      const place = item['publisher-place'] ? `${esc(item['publisher-place'])}: ` : '';
      const pub = item.publisher ? `${place}${esc(item.publisher)}, ${esc(yr)}.` : `${esc(yr)}.`;
      body = `${i(capFirst(item.title))}. ${ed}${pub}`;
      bodyText = strip(body);
    } else { // webpage / dataset / default
      const link = doiUrl(item);
      const site = item['container-title'] ? `${esc(item['container-title'])}, ` : '';
      const disp = link ? ` Disponível em: ${esc(link)}.` : '';
      body = `${esc(capFirst(item.title))}. ${site}${esc(yr)}.${disp}`;
      bodyText = strip(body);
    }

    const aStr = A ? A.replace(/\.$/, '') + '. ' : '';   // evita "et al.." final
    const html = `${aStr ? esc(A.replace(/\.$/, '')) + '. ' : ''}${body}`.replace(/\s+\./g, '.').trim();
    const text = `${aStr}${bodyText}`.replace(/\s+/g, ' ').trim();
    return { html, text };
  }

  /* --------------------------------------------------------- strip helper */
  function strip(html) { return decodeEntities(String(html).replace(/<[^>]+>/g, '')); }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(s) {
    if (typeof s !== 'string' || s.indexOf('&') === -1) return s;
    return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = (code[1] === 'x' || code[1] === 'X')
          ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return isNaN(n) ? m : String.fromCodePoint(n);
      }
      return Object.prototype.hasOwnProperty.call(ENT, code.toLowerCase()) ? ENT[code.toLowerCase()] : m;
    });
  }

  /* =======================================================================
     Registry + public API
     ======================================================================= */
  const STYLES = {
    apa7: { label: 'APA 7', fn: apa7, lang: 'es' },
    mla9: { label: 'MLA 9', fn: mla9, lang: 'en' },
    chicago: { label: 'Chicago 17', fn: chicago, lang: 'en' },
    ieee: { label: 'IEEE', fn: ieee, lang: 'en' },
    vancouver: { label: 'Vancouver', fn: vancouver, lang: 'es' },
    abnt: { label: 'ABNT', fn: abnt, lang: 'pt' },
  };

  // Limpieza de artefactos por campos faltantes (comas/puntos colgantes).
  function tidyText(s) {
    return s
      .replace(/,\s*,/g, ',')
      .replace(/\s+,/g, ',')
      .replace(/,\s*\./g, '.')
      .replace(/\s+\.(?=\s|$)/g, '.')
      .replace(/\.{2,}/g, '.')
      .replace(/,\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  // Versión segura para HTML: sólo colapsa artefactos que no pueden estar en etiquetas.
  function tidyHtml(s) {
    return s
      .replace(/,\s*,/g, ',')
      .replace(/,\s*\.(?=\s|<|$)/g, '.')
      .replace(/,\s*$/g, '')
      .trim();
  }

  function format(item, styleKey, lang) {
    const s = STYLES[styleKey] || STYLES.apa7;
    // ABNT es una norma en portugués: sus términos van siempre en pt.
    const effLang = (styleKey === 'abnt') ? 'pt' : (TERMS[lang] ? lang : 'en');
    try {
      const out = s.fn(item || {}, effLang);
      return { html: tidyHtml(out.html || ''), text: tidyText(out.text || '') };
    } catch (e) {
      return { html: '<em>—</em>', text: '' };
    }
  }

  /* ------- Validación: campos faltantes por tipo (para avisos en UI) ----- */
  // Devuelve CLAVES de aviso; la UI (app.js/i18n) las traduce.
  function validate(item) {
    const warns = [];
    const t = item.type || 'webpage';
    if (!names(item, 'author').length && t !== 'webpage') warns.push('noAuthor');
    if (!nonEmpty(item.title)) warns.push('noTitle');
    if (!yearRaw(item)) warns.push('noYear');
    if (t === 'article-journal' && !nonEmpty(item['container-title'])) warns.push('noJournal');
    if ((t === 'book' || t === 'chapter') && !nonEmpty(item.publisher)) warns.push('noPublisher');
    if (t === 'article-journal' && !nonEmpty(item.DOI) && !nonEmpty(item.URL)) warns.push('apaDoi');
    if (t === 'webpage' && !nonEmpty(item.URL)) warns.push('noUrl');
    return warns;
  }

  /* -------------------------- Export: BibTeX ---------------------------- */
  const BIB_TYPE = {
    'article-journal': 'article', 'article': 'article', 'book': 'book',
    'chapter': 'incollection', 'paper-conference': 'inproceedings',
    'thesis': 'phdthesis', 'report': 'techreport', 'dataset': 'misc',
    'webpage': 'online',
  };
  function bibKey(item) {
    const a = names(item, 'author')[0];
    const fam = (a && a.family ? a.family : 'ref').replace(/[^A-Za-z]/g, '');
    return `${fam.toLowerCase()}${yearRaw(item) || ''}`;
  }
  function bibtex(item) {
    const type = BIB_TYPE[item.type] || 'misc';
    const key = bibKey(item);
    const F = [];
    const people = names(item, 'author').map((p) => p.literal || `${p.family || ''}, ${p.given || ''}`.replace(/, $/, '')).join(' and ');
    const eds = names(item, 'editor').map((p) => p.literal || `${p.family || ''}, ${p.given || ''}`.replace(/, $/, '')).join(' and ');
    if (people) F.push(['author', people]);
    if (eds) F.push(['editor', eds]);
    if (item.title) F.push([type === 'incollection' || type === 'inproceedings' ? 'title' : 'title', item.title]);
    if (item['container-title']) {
      if (type === 'article') F.push(['journal', item['container-title']]);
      else if (type === 'incollection') F.push(['booktitle', item['container-title']]);
      else if (type === 'inproceedings') F.push(['booktitle', item['container-title']]);
    }
    if (yearRaw(item)) F.push(['year', yearRaw(item)]);
    if (item.volume) F.push(['volume', item.volume]);
    if (item.issue) F.push(['number', item.issue]);
    if (item.page) F.push(['pages', pagesRangeBib(pagesRange(item.page))]);
    if (item.publisher) F.push(['publisher', item.publisher]);
    if (item['publisher-place']) F.push(['address', item['publisher-place']]);
    if (item.edition) F.push(['edition', item.edition]);
    if (item.DOI) F.push(['doi', String(item.DOI).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')]);
    if (item.URL) F.push(['url', item.URL]);
    if (item.ISBN) F.push(['isbn', item.ISBN]);
    if (item.ISSN) F.push(['issn', item.ISSN]);
    const lines = F.map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
    return `@${type}{${key},\n${lines}\n}`;
  }

  /* --------------------------- Export: RIS ------------------------------ */
  const RIS_TYPE = {
    'article-journal': 'JOUR', 'article': 'JOUR', 'book': 'BOOK',
    'chapter': 'CHAP', 'paper-conference': 'CONF', 'thesis': 'THES',
    'report': 'RPRT', 'dataset': 'DATA', 'webpage': 'ELEC',
  };
  function ris(item) {
    const L = [];
    L.push(['TY', RIS_TYPE[item.type] || 'GEN']);
    names(item, 'author').forEach((p) => L.push(['AU', p.literal || `${p.family || ''}, ${p.given || ''}`.replace(/, $/, '')]));
    names(item, 'editor').forEach((p) => L.push(['ED', p.literal || `${p.family || ''}, ${p.given || ''}`.replace(/, $/, '')]));
    if (item.title) L.push(['TI', item.title]);
    if (item['container-title']) L.push([item.type === 'article-journal' ? 'JO' : 'T2', item['container-title']]);
    const yr = yearRaw(item); if (yr) L.push(['PY', yr]);
    if (item.volume) L.push(['VL', item.volume]);
    if (item.issue) L.push(['IS', item.issue]);
    if (item.page) {
      const parts = String(item.page).split(/[-–]/);
      if (parts[0]) L.push(['SP', parts[0].trim()]);
      if (parts[1]) L.push(['EP', parts[1].trim()]);
    }
    if (item.publisher) L.push(['PB', item.publisher]);
    if (item.DOI) L.push(['DO', String(item.DOI).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')]);
    if (item.URL) L.push(['UR', item.URL]);
    if (item.ISBN) L.push(['SN', item.ISBN]);
    else if (item.ISSN) L.push(['SN', item.ISSN]);
    L.push(['ER', '']);
    return L.map(([k, v]) => `${k}  - ${v}`).join('\n');
  }

  global.CiteEngine = {
    STYLES, format, validate, bibtex, ris,
    helpers: { titleCase, sentenceCase, year: yearRaw, names, decodeEntities },
  };
})(window);
