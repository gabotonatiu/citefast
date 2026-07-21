# CiteFast

**Free, fast, privacy-first academic citation generator.** Paste a **DOI, ISBN, URL or title** and get a fully formatted citation in **APA 7, MLA 9, Chicago, IEEE, Vancouver or ABNT** — instantly. Export to BibTeX, RIS, CSL-JSON or copy with formatting.

🔗 **Live:** [citefast.app](https://citefast.app) · 🌍 **5 languages** (EN · ES · PT · FR · DE) · 🔒 **No account, nothing uploaded**

Built by [Gabriel Tonatiu Andrade](https://web.gabotonatiu.com). Licensed under [MIT](LICENSE).

---

## Why it's different

Most citation generators make you fill in 10–15 fields by hand and drown you in ads. CiteFast **inverts the flow**: you paste a single piece of data and the app retrieves and formats the rest, using free public bibliographic APIs — all in the browser.

- **Live autocomplete** from `doi.org` (content negotiation → CSL-JSON), Crossref, OpenAlex, Google Books, OpenLibrary and PubMed.
- **Bulk mode** — paste a bibliography or upload a **PDF / Word / text** file. The file is parsed **entirely in your browser** (PDF.js + native decompression); it's never uploaded. Only verifiable identifiers (DOI, arXiv, PMID, ISBN) are resolved — **references without an identifier are never guessed**, they're flagged for manual entry.
- **Hand-written formatting engine** in vanilla JS — no citeproc/CSL download, so it's tiny, instant, and works offline once loaded.
- **Language-aware citations**, not just a translated UI: German uses `Hrsg.`, `Aufl.`, `S.`; French uses `dir.`, `s.d.`; “no date” becomes `n.d.` / `s. f.` / `s.d.` / `o.J.`; ABNT always stays in Portuguese, as its standard requires.
- **Your library lives in your browser** (localStorage). No server, no accounts, no tracking of your references.
- **Built-in FAQ + “which style should I use?” guide** for beginners.

## Tech stack

100% static: **HTML + CSS + vanilla JS**, no build step, no framework, no backend. Designed for **Cloudflare Pages** and Core Web Vitals.

```
index.html                 Structure + reserved ad slots + modals
privacidad.html            Privacy policy (5 languages, AdSense-ready)
assets/css/styles.css      Premium design (light/dark, responsive)
assets/js/i18n.js          UI strings + FAQ + style guide (5 languages)
assets/js/engine.js        Formatters + localized terms + BibTeX/RIS (pure)
assets/js/api.js           Input classifier + API adapters + bulk resolver
assets/js/bulk.js          Local PDF/DOCX text extraction (no upload)
assets/js/app.js           UI logic, i18n, library, bulk & modals
assets/vendor/pdfjs/       Self-hosted PDF.js (Apache-2.0)
```

## Run locally

`fetch` needs an `http://` origin (not `file://`), so serve the folder:

```bash
python -m http.server 3000
# open http://127.0.0.1:3000
```

> Set `MAILTO` in `assets/js/api.js` to your real email to join Crossref/OpenAlex's *polite pool* (better rate limits).

## Supported styles & languages

| | |
|---|---|
| **Styles** | APA 7 · MLA 9 · Chicago (author-date) · IEEE · Vancouver · ABNT |
| **UI + citation terms** | English · Español · Português · Français · Deutsch |
| **Export** | Copy with formatting · BibTeX · RIS · CSL-JSON · full list (.txt/.html) |

## Contributing

Issues and pull requests are welcome — new styles (each is a function in `engine.js`), languages (`i18n.js` + term table in `engine.js`), or source types. Please keep it dependency-free and static.

## Privacy

No personal data is collected. Your reference library stays in your browser's local storage. The only third-party requests are the bibliographic APIs used for autocomplete (and Google Ads, if enabled).

## License

[MIT](LICENSE) © 2026 Gabriel Tonatiu Andrade
