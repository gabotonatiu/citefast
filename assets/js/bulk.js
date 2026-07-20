/* =========================================================================
   CiteFast — Extracción de texto LOCAL para el generador por lotes.
   PDF (PDF.js autoalojado) y DOCX (descompresión nativa del navegador).
   El archivo se procesa 100% en el navegador: NUNCA se sube a un servidor.
   ========================================================================= */
(function (global) {
  'use strict';

  const PDFJS_PATH = '/assets/vendor/pdfjs/pdf.min.mjs';
  const PDFJS_WORKER = '/assets/vendor/pdfjs/pdf.worker.min.mjs';
  let pdfjsLib = null;

  async function loadPdfjs() {
    if (pdfjsLib) return pdfjsLib;
    pdfjsLib = await import(PDFJS_PATH);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return pdfjsLib;
  }

  /* --------------------------------------------------------------- PDF ---*/
  async function extractPdf(arrayBuffer, onProgress) {
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it) => (it.str || '')).join(' ') + '\n';
      if (onProgress) onProgress(p, pdf.numPages);
    }
    return text;
  }

  /* -------------------------------------------------------------- DOCX ---*/
  // DOCX es un ZIP. Leemos el directorio central, localizamos
  // word/document.xml y lo inflamos con DecompressionStream (nativo).
  async function extractDocx(arrayBuffer) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('nodecompress');
    }
    const buf = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);

    // Buscar End Of Central Directory (firma 0x06054b50) desde el final.
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('badzip');
    const cdOffset = dv.getUint32(eocd + 16, true);
    const cdCount = dv.getUint16(eocd + 10, true);

    // Recorrer directorio central buscando word/document.xml
    let p = cdOffset;
    let target = null;
    const dec = new TextDecoder();
    for (let n = 0; n < cdCount; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      if (name === 'word/document.xml') { target = { method, compSize, localOff }; break; }
      p += 46 + nameLen + extraLen + commLen;
    }
    if (!target) throw new Error('nodoc');

    // Ir a la cabecera local para saltar nombre + extra y llegar a los datos.
    const lo = target.localOff;
    if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('badlocal');
    const lNameLen = dv.getUint16(lo + 26, true);
    const lExtraLen = dv.getUint16(lo + 28, true);
    const dataStart = lo + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + target.compSize);

    let xmlBytes;
    if (target.method === 0) xmlBytes = data;             // almacenado
    else if (target.method === 8) xmlBytes = await inflateRaw(data); // deflate
    else throw new Error('badmethod');

    const xml = new TextDecoder('utf-8').decode(xmlBytes);
    return xmlToText(xml);
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const out = await new Response(stream).arrayBuffer();
    return new Uint8Array(out);
  }

  function xmlToText(xml) {
    return xml
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }

  /* ------------------------------------------------------ despacho ------*/
  async function extractText(file, onProgress) {
    const name = (file.name || '').toLowerCase();
    const buf = await file.arrayBuffer();
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      return extractPdf(buf, onProgress);
    }
    if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return extractDocx(buf);
    }
    // txt, md, bib, ris, csv y cualquier texto plano
    return new TextDecoder('utf-8').decode(new Uint8Array(buf));
  }

  global.CiteBulk = { extractText, extractPdf, extractDocx };
})(window);
