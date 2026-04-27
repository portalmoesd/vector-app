/**
 * Statistics Word (.docx) export — sibling of statistics-pdf.js.
 *
 * Produces a docx whose content, fonts, page geometry, and table styling
 * mirror the existing PDF output. The runtime loads the `docx` library
 * lazily on first export click — `statistics.js` injects the CDN script
 * and awaits it before invoking `StatisticsWord.build`. So `window.docx`
 * is guaranteed to exist by the time we reach this file's runtime code.
 *
 * Public API:
 *   await StatisticsWord.build(state, { lang, country, countryNameEn, charts });
 */
(function () {
  'use strict';

  // ── Labels ──────────────────────────────────────────────────────────────
  // Mirrored from statistics-pdf.js T table verbatim so the two builders
  // stay diff-able. Any new label added there must be added here too.
  const T = {
    en: {
      tradeOverview: 'Trade Overview',
      turnover: 'Trade Turnover',
      export: 'Export',
      import: 'Import',
      balance: 'Balance',
      dynamics: 'Export-Import Dynamics',
      mainExport: 'Main Export Products',
      mainImport: 'Main Import Products',
      exportIncrease: 'Most Increased Export Products',
      exportDrop: 'Most Decreased Export Products',
      importIncrease: 'Most Increased Import Products',
      importDrop: 'Most Decreased Import Products',
      internationalVisitors: 'International Visitors',
      fdi: 'Foreign Direct Investment',
      fdiShort: 'FDI, mln $',
      hsProduct: 'Product (HS 4-digit)',
      volumeHeader: 'Volume, mln $',
      changeHeader: 'Change %',
      reexportShareShort: 'Re-exp. share %',
      differenceHeader: 'Difference, mln $',
      year: 'Year',
      period: 'Period',
      visitors: 'Visitors',
      mln: 'mln $',
      noTrade: 'No trade conducted',
      noExports: 'No exports conducted',
      noImports: 'No imports conducted',
      positive: 'positive',
      negative: 'negative',
      increase: 'increase',
      decrease: 'decrease',
      generated: 'Generated',
      noData: 'No data available',
      page: 'page',
      of: 'of',
      tradeSection: 'Foreign Trade',
      tourismSection: 'Tourism',
      investmentsSection: 'Investments',
      appendixSection: 'Appendix',
      appTurnoverGrp: 'Turnover',
      appExportGrp: 'Export',
      appImportGrp: 'Import',
      appBalanceGrp: 'Balance',
      appChange: 'Change %',
      appShare: 'Share %',
    },
    ka: {
      tradeOverview: 'სავაჭრო მიმოხილვა',
      turnover: 'სავაჭრო ბრუნვა',
      export: 'ექსპორტი',
      import: 'იმპორტი',
      balance: 'ბალანსი',
      dynamics: 'ექსპორტ-იმპორტის დინამიკა',
      mainExport: 'ძირითადი საექსპორტო პროდუქცია',
      mainImport: 'ძირითადი საიმპორტო პროდუქცია',
      exportIncrease: 'ექსპორტში ყველაზე მეტად გაზრდილი პროდუქცია',
      exportDrop: 'ექსპორტში ყველაზე მეტად შემცირებული პროდუქცია',
      importIncrease: 'იმპორტში ყველაზე მეტად გაზრდილი პროდუქცია',
      importDrop: 'იმპორტში ყველაზე მეტად შემცირებული პროდუქცია',
      internationalVisitors: 'საერთაშორისო ვიზიტორები',
      fdi: 'პირდაპირი უცხოური ინვესტიციები',
      fdiShort: 'პირდაპირი უცხოური ინვესტიციები, მლნ. $',
      hsProduct: 'პროდუქცია (HS 4-ნიშნა)',
      volumeHeader: 'მოცულობა მლნ.$',
      changeHeader: 'ცვლილება %',
      reexportShareShort: 'რეექს. წილი %',
      differenceHeader: 'სხვაობა მლნ.$',
      year: 'წელი',
      period: 'პერიოდი',
      visitors: 'ვიზიტორები',
      mln: 'მლნ. $',
      noTrade: 'ვაჭრობა არ განხორციელდა',
      noExports: 'ექსპორტი არ განხორციელდა',
      noImports: 'იმპორტი არ განხორციელდა',
      positive: 'პოზიტიური',
      negative: 'ნეგატიური',
      increase: 'ზრდა',
      decrease: 'კლება',
      generated: 'თარიღი',
      noData: 'მონაცემები ვერ მოიძებნა',
      page: 'გვ.',
      of: '/',
      tradeSection: 'საგარეო ვაჭრობა',
      tourismSection: 'ტურიზმი',
      investmentsSection: 'ინვესტიციები',
      appendixSection: 'დანართი',
      appTurnoverGrp: 'ბრუნვა',
      appExportGrp: 'ექსპორტი',
      appImportGrp: 'იმპორტი',
      appBalanceGrp: 'სალდო',
      appChange: 'ცვლილება %',
      appShare: 'წილი %',
    },
  };

  // ── Georgian month declensions + English month abbreviations ───────────
  const KA_MONTHS = {
    1:  { stem: 'იანვარ',     gen: 'იანვრის',     loc: 'იანვარში'    },
    2:  { stem: 'თებერვალ',   gen: 'თებერვლის',   loc: 'თებერვალში'  },
    3:  { stem: 'მარტ',       gen: 'მარტის',      loc: 'მარტში'      },
    4:  { stem: 'აპრილ',      gen: 'აპრილის',     loc: 'აპრილში'     },
    5:  { stem: 'მაის',       gen: 'მაისის',      loc: 'მაისში'      },
    6:  { stem: 'ივნის',      gen: 'ივნისის',     loc: 'ივნისში'     },
    7:  { stem: 'ივლის',      gen: 'ივლისის',     loc: 'ივლისში'     },
    8:  { stem: 'აგვისტო',    gen: 'აგვისტოს',    loc: 'აგვისტოში'   },
    9:  { stem: 'სექტემბერ',  gen: 'სექტემბრის',  loc: 'სექტემბერში' },
    10: { stem: 'ოქტომბერ',   gen: 'ოქტომბრის',   loc: 'ოქტომბერში'  },
    11: { stem: 'ნოემბერ',    gen: 'ნოემბრის',    loc: 'ნოემბერში'   },
    12: { stem: 'დეკემბერ',   gen: 'დეკემბრის',   loc: 'დეკემბერში'  },
  };

  const EN_MONTHS = { 1:'Jan', 2:'Feb', 3:'Mar', 4:'Apr', 5:'May', 6:'Jun', 7:'Jul', 8:'Aug', 9:'Sep', 10:'Oct', 11:'Nov', 12:'Dec' };
  const KA_MONTHS_SHORT = { 1:'იან', 2:'თებ', 3:'მარ', 4:'აპრ', 5:'მაი', 6:'ივნ', 7:'ივლ', 8:'აგვ', 9:'სექ', 10:'ოქტ', 11:'ნოე', 12:'დეკ' };

  // ── Period formatters (locale-aware, copied from statistics-pdf.js) ────
  function gePeriodGen(year, latestMonth) {
    if (latestMonth === 12) return `${year} წლის`;
    if (latestMonth === 1)  return `${year} წლის ${KA_MONTHS[1].gen}`;
    return `${year} წლის ${KA_MONTHS[1].stem}‑${KA_MONTHS[latestMonth].gen}`;
  }
  function gePeriodLoc(year, latestMonth) {
    if (latestMonth === 12) return `${year} წელს`;
    if (latestMonth === 1)  return `${year} წლის ${KA_MONTHS[1].loc}`;
    return `${year} წლის ${KA_MONTHS[1].stem}‑${KA_MONTHS[latestMonth].loc}`;
  }
  function periodShortLabel(latestMonth, lang) {
    const months = lang === 'ka' ? KA_MONTHS_SHORT : EN_MONTHS;
    if (latestMonth === 12) return '';
    if (latestMonth === 1) return months[1];
    return `${months[1]}-${months[latestMonth]}`;
  }
  function enPeriod(year, latestMonth) {
    if (latestMonth === 12) return String(year);
    if (latestMonth === 1) return `${EN_MONTHS[1]} ${year}`;
    return `${EN_MONTHS[1]}-${EN_MONTHS[latestMonth]} ${year}`;
  }
  function gePeriodGenRange(startYear, endYear, latestMonth) {
    const years = `${startYear}-${endYear}`;
    if (latestMonth === 12) return `${years} წლების`;
    if (latestMonth === 1)  return `${years} წლის ${KA_MONTHS[1].gen}`;
    return `${years} წლის ${KA_MONTHS[1].stem}‑${KA_MONTHS[latestMonth].gen}`;
  }
  function enPeriodRange(startYear, endYear, latestMonth) {
    const years = `${startYear}-${endYear}`;
    if (latestMonth === 12) return years;
    if (latestMonth === 1) return `${EN_MONTHS[1]} ${years}`;
    return `${EN_MONTHS[1]}-${EN_MONTHS[latestMonth]} ${years}`;
  }
  function gePlace(rank) {
    if (rank === 1) return 'პირველ';
    if (rank >= 2 && rank <= 20) return `მე-${rank}`;
    if (rank % 10 === 0) return `მე-${rank}`;
    if (rank % 100 === 0) return `მე-${rank}`;
    return `${rank}-ე`;
  }
  function enOrdinal(rank) {
    const n = Math.abs(rank);
    const m100 = n % 100;
    if (m100 >= 11 && m100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  }

  // ── Numeric formatters (copied from statistics-pdf.js) ─────────────────
  function formatMln(val) {
    let str;
    const abs = Math.abs(val);
    if (abs >= 100) str = val.toFixed(1);
    else if (abs >= 10) str = val.toFixed(2);
    else if (abs >= 0.01) str = val.toFixed(2);
    else if (abs > 0) str = val.toFixed(3);
    else str = '0.00';
    return str.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function formatMln2(val) {
    return val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function formatPct(pct) {
    const rounded = Math.round(pct);
    if (rounded === 0 && pct !== 0) return pct.toFixed(1) + '%';
    return rounded + '%';
  }
  function calcChange(current, previous) {
    if (!previous || previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
  }
  function formatDate() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }

  // ── docx unit helpers ──────────────────────────────────────────────────
  // docx uses two odd unit conventions:
  //   - Page geometry / table widths: TWIPS (1 pt = 20 twips, 1 inch = 1440)
  //   - Font sizes: HALF-POINTS (10pt = 20)
  // These wrappers keep the rest of the file in plain points.
  function pt(n) { return Math.round(n * 20); }     // pt → twips
  function hp(n) { return Math.round(n * 2); }      // pt → half-points
  function px(n) { return Math.round(n * 96 / 72); } // pt → CSS pixels (chart sizes)

  // ── Color palette (matches PDF) ────────────────────────────────────────
  const COLOR = {
    text:       '1F2937',
    textMuted:  '6B7280',
    headerText: '475569',
    headerFill: 'F8FAFC',
    border:     'E5E7EB',
    borderTop:  '94A3B8',
    groupFill:  'F1F5F9',
    positive:   '16A34A',
    negative:   'DC2626',
    titleDark:  '0F172A',
  };

  // ── docx paragraph + run helpers ──────────────────────────────────────
  // Each helper returns a `Paragraph` so section builders can list
  // children and concat them. The `docx` namespace is captured at build()
  // time and passed in via the closure parameter `D`.
  function paragraph(D, runs, opts = {}) {
    return new D.Paragraph({
      children: Array.isArray(runs) ? runs : [runs],
      ...opts,
    });
  }
  function run(D, text, opts = {}) {
    return new D.TextRun({
      text: String(text),
      font: 'FiraGO',
      size: hp(9.5),
      color: COLOR.text,
      ...opts,
    });
  }
  function boldRun(D, text, opts = {}) {
    return run(D, text, { ...opts, bold: true });
  }
  function italicRun(D, text, opts = {}) {
    return run(D, text, { ...opts, italics: true });
  }

  function sectionTitleP(D, text, opts = {}) {
    return new D.Paragraph({
      spacing: { before: pt(10), after: pt(6) },
      children: [new D.TextRun({
        text, bold: true, font: 'FiraGO',
        size: hp(13), color: COLOR.titleDark,
      })],
      ...opts,
    });
  }
  function subTitleP(D, text, opts = {}) {
    return new D.Paragraph({
      spacing: { before: pt(8), after: pt(4) },
      children: [new D.TextRun({
        text, bold: true, font: 'FiraGO',
        size: hp(10.5), color: COLOR.text,
      })],
      ...opts,
    });
  }
  function captionP(D, text) {
    return new D.Paragraph({
      spacing: { after: pt(4) },
      children: [new D.TextRun({
        text, bold: true, font: 'FiraGO',
        size: hp(9.5), color: COLOR.text,
      })],
    });
  }

  // ── Image helpers (Base64 data URL → ImageRun) ────────────────────────
  function dataUrlToBytes(dataUrl) {
    if (!dataUrl) return null;
    const comma = dataUrl.indexOf(',');
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function chartImageP(D, dataUrl, widthPt = 500, heightPt = 153) {
    const bytes = dataUrlToBytes(dataUrl);
    if (!bytes) return null;
    return new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      spacing: { before: pt(2), after: pt(8) },
      children: [new D.ImageRun({
        data: bytes,
        transformation: { width: px(widthPt), height: px(heightPt) },
      })],
    });
  }

  // ── docx table cell helpers ───────────────────────────────────────────
  // pdfmake's tableLayout collapses to "1pt under header, 0.5pt between
  // rows, no verticals". docx requires per-cell border specs, so these
  // helpers produce the equivalent. The cell at position (row, col)
  // receives:
  //   top:    1pt #94a3b8 if row === 1 (under header)
  //           0.5pt #e5e7eb otherwise
  //           none if row === 0 (no top border on the first row)
  //   left/right: none
  //   bottom: 0.5pt #e5e7eb (for the last data row, the next row's top
  //           supplies the line; on the very last row it's also nothing).
  function cellBorders(rowIdx, isLastRow) {
    const NONE = { style: 'none', size: 0, color: 'auto' };
    const headerLine = { style: 'single', size: 8 /* eighths-of-a-point: 8 = 1pt */, color: COLOR.borderTop };
    const rowLine    = { style: 'single', size: 4 /* 0.5pt */,                       color: COLOR.border };
    const top = rowIdx === 0 ? NONE : (rowIdx === 1 ? headerLine : rowLine);
    const bottom = isLastRow ? NONE : NONE; // bottoms left to next-row tops
    return { top, bottom, left: NONE, right: NONE };
  }
  function cellMargins() {
    return { top: pt(4), bottom: pt(4), left: pt(6), right: pt(6) };
  }
  function makeCell(D, opts) {
    const { children, rowIdx, isLastRow, shading, columnSpan, width } = opts;
    return new D.TableCell({
      children,
      verticalAlign: D.VerticalAlign.CENTER,
      borders: cellBorders(rowIdx, !!isLastRow),
      margins: cellMargins(),
      shading: shading ? { type: 'clear', color: 'auto', fill: shading } : undefined,
      columnSpan,
      width,
    });
  }
  function headerCell(D, text, opts = {}) {
    return makeCell(D, {
      children: [new D.Paragraph({
        alignment: opts.align === 'right' ? D.AlignmentType.RIGHT
                 : opts.align === 'center' ? D.AlignmentType.CENTER
                 : D.AlignmentType.LEFT,
        children: [new D.TextRun({
          text, bold: true, font: 'FiraGO',
          size: hp(8), color: COLOR.headerText,
        })],
      })],
      rowIdx: 0,
      shading: COLOR.headerFill,
      columnSpan: opts.columnSpan,
      width: opts.width,
    });
  }
  function dataCell(D, text, opts = {}) {
    const align = opts.align || 'left';
    const color = opts.color || COLOR.text;
    return makeCell(D, {
      children: [new D.Paragraph({
        alignment: align === 'right' ? D.AlignmentType.RIGHT
                 : align === 'center' ? D.AlignmentType.CENTER
                 : D.AlignmentType.LEFT,
        children: [new D.TextRun({
          text: String(text), font: 'FiraGO',
          size: hp(9), color, bold: !!opts.bold,
        })],
      })],
      rowIdx: opts.rowIdx,
      isLastRow: opts.isLastRow,
      shading: opts.shading,
      columnSpan: opts.columnSpan,
      width: opts.width,
    });
  }

  // ── Document factory ──────────────────────────────────────────────────
  // Builds the docx Document with A4 portrait, the same margins as the
  // PDF (32 / 46 / 32 / 40 pt → twips), default font FiraGO at 9.5pt,
  // and a single section with country-name + generated-date header and
  // a "page X / N" footer. Per-section content is supplied as the
  // `children` array.
  function buildDocxDocument(D, children, opts) {
    const lang = opts.lang || 'en';
    const t = T[lang] || T.en;
    const country = lang === 'en' && opts.countryNameEn ? opts.countryNameEn : (opts.country || '');
    const dateStr = formatDate();

    const headerP = new D.Paragraph({
      tabStops: [{ type: D.TabStopType.RIGHT, position: pt(531) }],
      children: [
        new D.TextRun({ text: country, font: 'FiraGO', size: hp(8.5), color: COLOR.textMuted }),
        new D.TextRun({ text: '\t', font: 'FiraGO', size: hp(8.5) }),
        new D.TextRun({ text: `${t.generated}: ${dateStr}`, font: 'FiraGO', size: hp(8.5), color: COLOR.textMuted }),
      ],
    });

    const footerP = new D.Paragraph({
      alignment: D.AlignmentType.CENTER,
      children: [
        new D.TextRun({ text: `${t.page} `, font: 'FiraGO', size: hp(8), color: COLOR.textMuted }),
        new D.TextRun({ children: [D.PageNumber.CURRENT], font: 'FiraGO', size: hp(8), color: COLOR.textMuted }),
        new D.TextRun({ text: ` ${t.of} `, font: 'FiraGO', size: hp(8), color: COLOR.textMuted }),
        new D.TextRun({ children: [D.PageNumber.TOTAL_PAGES], font: 'FiraGO', size: hp(8), color: COLOR.textMuted }),
      ],
    });

    return new D.Document({
      creator: 'Vector Portal',
      title: `${country} statistics`,
      styles: {
        default: {
          document: {
            run: { font: 'FiraGO', size: hp(9.5), color: COLOR.text },
            paragraph: { spacing: { line: 300, lineRule: 'auto' } },
          },
        },
      },
      sections: [{
        properties: {
          page: {
            size: { width: pt(595), height: pt(842), orientation: D.PageOrientation.PORTRAIT }, // A4
            margin: { top: pt(46), bottom: pt(40), left: pt(32), right: pt(32),
                      header: pt(18), footer: pt(14) },
          },
        },
        headers: { default: new D.Header({ children: [headerP] }) },
        footers: { default: new D.Footer({ children: [footerP] }) },
        children,
      }],
    });
  }

  // ── Section builder placeholders (filled in by subsequent commits) ────
  // Keeps the document structurally valid while the per-section
  // content gets translated from the PDF builders.
  function placeholderSection(D, t, key) {
    return [
      sectionTitleP(D, t[key], { pageBreakBefore: key !== 'tradeSection' }),
      paragraph(D, italicRun(D, t.noData, { color: COLOR.textMuted })),
    ];
  }

  // ── Multi-run data cell ────────────────────────────────────────────────
  // Some trade-overview cells need two coloured runs in the same cell,
  // e.g. "1,234.56 mln $, increase 12%" where the value is black and the
  // change is green or red. dataCell takes a single string; this variant
  // takes an array of `{ text, color, bold }` descriptors.
  function dataCellRuns(D, runDescs, opts = {}) {
    const align = opts.align || 'left';
    const runs = runDescs.map(r => new D.TextRun({
      text: String(r.text || ''),
      font: 'FiraGO',
      size: hp(r.size || 9),
      color: r.color || COLOR.text,
      bold: !!r.bold,
      italics: !!r.italics,
    }));
    return makeCell(D, {
      children: [new D.Paragraph({
        alignment: align === 'right' ? D.AlignmentType.RIGHT
                 : align === 'center' ? D.AlignmentType.CENTER
                 : D.AlignmentType.LEFT,
        children: runs,
      })],
      rowIdx: opts.rowIdx,
      isLastRow: opts.isLastRow,
      shading: opts.shading,
      width: opts.width,
    });
  }

  // ── Trade overview table ──────────────────────────────────────────────
  // Mirrors statistics-pdf.js buildOverviewTable: 5 rows × 3 columns.
  // Header: blank, colFull (prevYear), colMonth ("Jan-Feb 2026").
  // Each subsequent row: bold label, fullYear cell, latestPeriod cell.
  // Cells encode either the standard "value, increase X%" two-run format,
  // a "positive/negative balance" line, or a centred grey "no trade"
  // sentinel.
  function buildOverviewTable(D, trade, t, periodLabel, lang) {
    const data = trade.overview;
    const colFull  = String(trade.prevYear);
    const colMonth = `${periodLabel} ${trade.latestYear}`;

    const rows = [
      { key: 'turnover', label: t.turnover },
      { key: 'export',   label: t.export   },
      { key: 'import',   label: t.import   },
      { key: 'balance',  label: t.balance  },
    ];
    const zeroMsg = { turnover: t.noTrade, export: t.noExports, import: t.noImports };

    function buildCell(value, prev, isBalance, key, periodData, rowIdx, isLastRow) {
      // "-" when balance shown for a no-trade period.
      if (isBalance && periodData.turnover === 0) {
        return dataCellRuns(D, [{ text: '-' }], { align: 'center', rowIdx, isLastRow });
      }
      // Centered grey sentinel for zero export/import/turnover.
      if (value === 0 && !isBalance && zeroMsg[key]) {
        return dataCellRuns(D, [{ text: zeroMsg[key], color: '94A3B8', size: 8.5 }], { align: 'center', rowIdx, isLastRow });
      }
      if (isBalance) {
        const sign  = value < 0 ? t.negative : t.positive;
        const color = value < 0 ? COLOR.negative : COLOR.positive;
        return dataCellRuns(D, [{
          text: `${sign} ${formatMln2(Math.abs(value))} ${t.mln}`, color,
        }], { align: 'center', rowIdx, isLastRow });
      }
      const pct = calcChange(value, prev);
      const dir = pct >= 0 ? t.increase : t.decrease;
      const changeColor = pct >= 0 ? COLOR.positive : COLOR.negative;
      return dataCellRuns(D, [
        { text: `${formatMln2(value)} ${t.mln}`, color: COLOR.titleDark },
        { text: `, ${dir} ${formatPct(pct)}`, color: changeColor },
      ], { align: 'center', rowIdx, isLastRow });
    }

    const totalRows = rows.length + 1; // header + data
    const headerRow = new D.TableRow({
      children: [
        headerCell(D, ''),
        headerCell(D, colFull,  { align: 'center' }),
        headerCell(D, colMonth, { align: 'center' }),
      ],
    });
    const bodyRows = rows.map((r, idx) => {
      const isBalance = r.key === 'balance';
      const fullVal = data.fullYear[r.key];
      const fullPrev = data.fullYear[r.key + 'Prev'];
      const monthVal = data.latestPeriod[r.key];
      const monthPrev = data.latestPeriod[r.key + 'Prev'];
      const rowIdx = idx + 1; // +1 for header
      const isLast = rowIdx === totalRows - 1;
      return new D.TableRow({
        cantSplit: true,
        children: [
          dataCell(D, r.label, { bold: true, rowIdx, isLastRow: isLast }),
          buildCell(fullVal,  fullPrev,  isBalance, r.key, data.fullYear,     rowIdx, isLast),
          buildCell(monthVal, monthPrev, isBalance, r.key, data.latestPeriod, rowIdx, isLast),
        ],
      });
    });

    return new D.Table({
      width: { size: 100, type: D.WidthType.PERCENTAGE },
      rows: [headerRow, ...bodyRows],
    });
  }

  // ── Trade section ──────────────────────────────────────────────────────
  // Mirrors statistics-pdf.js buildTradeSection but emits docx blocks.
  // Step 3a only: section title + summary placeholder + overview table +
  // the two chart images. Product/change tables and the prose summary
  // land in subsequent commits.
  function buildTradeSection(D, trade, charts, t, country, lang) {
    if (!trade) return [];
    const periodLabel = periodShortLabel(trade.latestMonth, lang) || trade.periodLabel;
    const title = `${country} - ${t.tradeOverview}, ${periodLabel} ${trade.latestYear}`;

    const blocks = [];
    blocks.push(sectionTitleP(D, title));
    // Summary placeholder — replaced in step 3b.
    blocks.push(paragraph(D, italicRun(D, '[summary paragraphs will be inserted here]', { color: COLOR.textMuted })));
    blocks.push(buildOverviewTable(D, trade, t, periodLabel, lang));

    // Chart caption + image pair, mirroring the PDF.
    if (charts && charts.turnover) {
      blocks.push(captionP(D, t.turnover));
      const img = chartImageP(D, charts.turnover);
      if (img) blocks.push(img);
    }
    if (charts && charts.dynamics) {
      blocks.push(captionP(D, t.dynamics));
      // Tiny inline legend mirroring the PDF (green = export, red = import).
      blocks.push(new D.Paragraph({
        alignment: D.AlignmentType.CENTER,
        spacing: { after: pt(2) },
        children: [
          new D.TextRun({ text: '■ ', font: 'FiraGO', size: hp(8), color: COLOR.positive }),
          new D.TextRun({ text: `${t.export}    `, font: 'FiraGO', size: hp(8), color: COLOR.text }),
          new D.TextRun({ text: '■ ', font: 'FiraGO', size: hp(8), color: COLOR.negative }),
          new D.TextRun({ text: t.import, font: 'FiraGO', size: hp(8), color: COLOR.text }),
        ],
      }));
      const img = chartImageP(D, charts.dynamics);
      if (img) blocks.push(img);
    }
    return blocks;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  function filenameFor(country, lang) {
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function build(state, opts) {
    if (typeof window.docx === 'undefined') {
      throw new Error('docx library not loaded');
    }
    const D = window.docx;
    const lang = (opts && opts.lang) || 'en';
    const t = T[lang] || T.en;
    const country = lang === 'en' && opts && opts.countryNameEn ? opts.countryNameEn : (opts && opts.country) || 'Country';

    // Section content — Trade is fully wired (overview + chart embeds);
    // the rest are placeholders until subsequent commits.
    const tradeCharts = (opts && opts.charts) || {};
    const children = [
      ...buildTradeSection(D, state && state.trade, tradeCharts, t, country, lang),
      ...placeholderSection(D, t, 'tourismSection'),
      ...placeholderSection(D, t, 'investmentsSection'),
      ...placeholderSection(D, t, 'appendixSection'),
    ];

    const doc = buildDocxDocument(D, children, {
      lang,
      country,
      countryNameEn: opts && opts.countryNameEn,
    });

    const blob = await D.Packer.toBlob(doc);
    triggerDownload(blob, filenameFor(country, lang));
  }

  // Expose helpers internally too, so future per-section code added by
  // subsequent commits can reuse them without re-declaring.
  window.StatisticsWord = {
    build,
    // private helpers exposed for the builder modules added later
    _internals: {
      T, KA_MONTHS, EN_MONTHS, KA_MONTHS_SHORT, COLOR,
      pt, hp, px,
      gePeriodGen, gePeriodLoc, periodShortLabel, enPeriod,
      gePeriodGenRange, enPeriodRange, gePlace, enOrdinal,
      formatMln, formatMln2, formatPct, calcChange, formatDate,
      paragraph, run, boldRun, italicRun,
      sectionTitleP, subTitleP, captionP,
      chartImageP, dataUrlToBytes,
      headerCell, dataCell, makeCell, cellBorders, cellMargins,
      buildDocxDocument,
    },
  };
})();
