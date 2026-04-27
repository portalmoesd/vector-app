/**
 * Statistics Word (.docx) export — sibling of statistics-pdf.js.
 *
 * This file is intentionally minimal at the moment: it declares the
 * public API surface that `statistics.js` calls (`StatisticsWord.build`)
 * and produces a "Hello, <country>" stub document so the lazy-load,
 * download, and button wiring can be exercised end-to-end before the
 * full PDF-equivalent layout is built out section by section.
 *
 * The runtime loads the `docx` library lazily on first export click —
 * `statistics.js` injects the CDN <script> and awaits it before invoking
 * `build()`. So `window.docx` is guaranteed to exist by the time we
 * reach this file's code.
 */
(function () {
  function filenameFor(country, lang) {
    // Match the PDF builder's sanitiser exactly so both downloads land
    // with the same name save the extension.
    const safeCountry = (country || 'report').replace(/[^a-zA-Z0-9Ⴀ-ჿ]/g, '_');
    return `${safeCountry}_statistics_${lang || 'en'}.docx`;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Free the blob URL — a microtask is enough; the browser has
    // already started the download by the time .click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function build(state, opts) {
    if (typeof window.docx === 'undefined') {
      throw new Error('docx library not loaded');
    }
    const { Document, Paragraph, TextRun, Packer, HeadingLevel } = window.docx;

    const country = (opts && opts.country) || 'Country';
    const lang = (opts && opts.lang) || 'en';

    // Stub document — single section, two paragraphs. Real layout
    // (sections, tables, charts, fonts, headers/footers) lands in
    // subsequent commits.
    const doc = new Document({
      creator: 'Vector Portal',
      title: `${country} statistics`,
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: `${country} — Statistics report`, bold: true })],
          }),
          new Paragraph({
            children: [new TextRun({
              text: `(Word export stub — locale: ${lang}. Section content will be populated in the next commits.)`,
              italics: true,
            })],
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    triggerDownload(blob, filenameFor(country, lang));
  }

  window.StatisticsWord = { build };
})();
