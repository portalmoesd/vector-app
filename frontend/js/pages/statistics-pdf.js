/**
 * Statistics PDF Export (pdfmake-based)
 * Produces a multi-section vector PDF covering Trade, Tourism and Investments
 * in one document. Tables flow natively across pages without cutting rows.
 *
 * Usage:
 *   await StatisticsPdf.build(state, { lang: 'en'|'ka', country });
 */
(function () {
  'use strict';

  // ── Font loading ────────────────────────────────────────────────────────
  let fontsPromise = null;

  function abToB64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function ensureFonts() {
    if (fontsPromise) return fontsPromise;
    fontsPromise = (async () => {
      const [reg, bold] = await Promise.all([
        fetch('/fonts/FiraGO-Regular.ttf').then(r => r.arrayBuffer()),
        fetch('/fonts/FiraGO-Bold.ttf').then(r => r.arrayBuffer()),
      ]);
      pdfMake.vfs = Object.assign({}, pdfMake.vfs || {}, {
        'FiraGO-Regular.ttf': abToB64(reg),
        'FiraGO-Bold.ttf': abToB64(bold),
      });
      pdfMake.fonts = {
        FiraGO: {
          normal: 'FiraGO-Regular.ttf',
          bold: 'FiraGO-Bold.ttf',
          italics: 'FiraGO-Regular.ttf',
          bolditalics: 'FiraGO-Bold.ttf',
        },
      };
    })();
    return fontsPromise;
  }

  // ── Labels ──────────────────────────────────────────────────────────────
  const T = {
    en: {
      tradeOverview: 'Trade Overview',
      turnover: 'Trade Turnover',
      export: 'Export',
      import: 'Import',
      balance: 'Balance',
      dynamics: 'Export–Import Dynamics',
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
      fdiShort: 'პუი, მლნ. $',
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
    },
  };

  // ── Formatting helpers ─────────────────────────────────────────────────
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

  function formatDate(locale) {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }

  // ── Section title row ──────────────────────────────────────────────────
  // sectionTitle / subTitle use named styles so the pageBreakBefore callback
  // (see buildDocDefinition) can identify them and push them to the next
  // page when their following content would otherwise be orphaned.
  function sectionTitle(text) {
    return { text: text, style: 'sectionTitle', headlineLevel: 1 };
  }

  function subTitle(text) {
    return { text: text, style: 'subTitle', headlineLevel: 2 };
  }

  // Shared pdfmake table layout
  const tableLayout = {
    hLineWidth: (i) => (i === 0 ? 0 : i === 1 ? 1 : 0.5),
    vLineWidth: () => 0,
    hLineColor: (i) => (i === 1 ? '#94a3b8' : '#e5e7eb'),
    paddingTop: () => 4,
    paddingBottom: () => 4,
    paddingLeft: () => 6,
    paddingRight: () => 6,
  };

  function th(text) {
    return { text: text, bold: true, fontSize: 8, color: '#475569', fillColor: '#f8fafc' };
  }

  function thRight(text) {
    return { text: text, bold: true, fontSize: 8, color: '#475569', fillColor: '#f8fafc', alignment: 'right' };
  }

  function tdNum(text, opts = {}) {
    return { text: text, alignment: 'right', fontSize: 9, ...opts };
  }
  function tdText(text, opts = {}) {
    return { text: text, fontSize: 9, ...opts };
  }

  function colorCell(value, isPositive) {
    // wrap tdNum with colour
    if (value > 0) return { color: '#16a34a' };
    if (value < 0) return { color: '#dc2626' };
    return {};
  }

  // ── Trade: overview table ──────────────────────────────────────────────
  function buildOverviewTable(data, periodMeta, t, latestMonth, monthNames) {
    const prevYear = periodMeta.prevYear;
    const latestYear = periodMeta.latestYear;
    const colFull = String(prevYear);
    const monthLbl = monthNames.find(m => m.value === latestMonth)?.label || '';
    const colMonth = `${periodMeta.periodLabel} ${latestYear}`;

    const rows = [
      { key: 'turnover', label: t.turnover },
      { key: 'export', label: t.export },
      { key: 'import', label: t.import },
      { key: 'balance', label: t.balance },
    ];

    const zeroMsg = {
      turnover: t.noTrade,
      export: t.noExports,
      import: t.noImports,
    };

    function cell(value, prev, isBalance, key, periodData) {
      if (isBalance && periodData.turnover === 0) return { text: '—', alignment: 'center' };
      if (value === 0 && !isBalance && zeroMsg[key]) return { text: zeroMsg[key], alignment: 'center', color: '#94a3b8', fontSize: 8.5 };
      if (isBalance) {
        const sign = value < 0 ? t.negative : t.positive;
        const color = value < 0 ? '#dc2626' : '#16a34a';
        return { text: `${sign} ${formatMln2(Math.abs(value))} ${t.mln}`, alignment: 'center', color };
      }
      const pct = calcChange(value, prev);
      const dir = pct >= 0 ? t.increase : t.decrease;
      const color = pct >= 0 ? '#16a34a' : '#dc2626';
      return {
        text: [
          { text: `${formatMln2(value)} ${t.mln}`, color: '#0f172a' },
          { text: `, ${dir} ${formatPct(pct)}`, color },
        ],
        alignment: 'center',
      };
    }

    const body = [
      [th(''), thRight(colFull), thRight(colMonth)],
    ];

    for (const r of rows) {
      const isBalance = r.key === 'balance';
      const fullVal = data.fullYear[r.key];
      const fullPrev = data.fullYear[r.key + 'Prev'];
      const monthVal = data.latestPeriod[r.key];
      const monthPrev = data.latestPeriod[r.key + 'Prev'];
      body.push([
        { text: r.label, bold: true, fontSize: 9 },
        cell(fullVal, fullPrev, isBalance, r.key, data.fullYear),
        cell(monthVal, monthPrev, isBalance, r.key, data.latestPeriod),
      ]);
    }

    return {
      table: {
        dontBreakRows: true,
        widths: ['auto', '*', '*'],
        body,
      },
      layout: tableLayout,
      margin: [0, 0, 0, 8],
    };
  }

  // ── Trade: products table (export/import) ─────────────────────────────
  function buildProductsTable(products, t, periodLabel, year, showReexport) {
    if (!products || products.length === 0) {
      return { text: t.noData, italics: true, color: '#94a3b8', fontSize: 9, margin: [0, 4, 0, 8] };
    }
    const header = [
      th(t.hsProduct),
      thRight(t.volumeHeader),
      thRight(t.changeHeader),
    ];
    if (showReexport) header.push(thRight(t.reexportShareShort));

    const body = [header];
    for (const p of products) {
      const change = p.change;
      const changeColor = change > 0 ? '#16a34a' : (change < 0 ? '#dc2626' : '#475569');
      const changeSign = change > 0 ? '+' : '';
      const row = [
        tdText(p.name),
        tdNum(formatMln(p.valueMln)),
        tdNum(`${changeSign}${formatPct(change)}`, { color: changeColor }),
      ];
      if (showReexport) {
        row.push(tdNum(p.reexportShare === 0 ? '—' : formatPct(p.reexportShare)));
      }
      body.push(row);
    }

    const widths = showReexport ? ['*', 70, 62, 80] : ['*', 75, 70];
    return {
      table: {
        dontBreakRows: true,
        widths,
        body,
      },
      layout: tableLayout,
      margin: [0, 0, 0, 6],
    };
  }

  // ── Trade: change table (increase/drop) ────────────────────────────────
  function buildChangeTable(products, t, periodLabel, year) {
    if (!products || products.length === 0) {
      return { text: t.noData, italics: true, color: '#94a3b8', fontSize: 9, margin: [0, 4, 0, 8] };
    }
    const body = [
      [
        th(t.hsProduct),
        thRight(t.volumeHeader),
        thRight(t.changeHeader),
        thRight(t.differenceHeader),
      ],
    ];
    for (const p of products) {
      const changeColor = p.changePct > 0 ? '#16a34a' : '#dc2626';
      const diffColor = p.diffMln > 0 ? '#16a34a' : '#dc2626';
      const changeSign = p.changePct > 0 ? '+' : '';
      const diffSign = p.diffMln > 0 ? '+' : '';
      body.push([
        tdText(p.name),
        tdNum(formatMln(p.valueMln)),
        tdNum(`${changeSign}${formatPct(p.changePct)}`, { color: changeColor }),
        tdNum(`${diffSign}${formatMln(Math.abs(p.diffMln))}`, { color: diffColor }),
      ]);
    }
    return {
      table: {
        dontBreakRows: true,
        widths: ['*', 70, 62, 80],
        body,
      },
      layout: tableLayout,
      margin: [0, 0, 0, 6],
    };
  }

  // ── Trade section ──────────────────────────────────────────────────────
  function buildTradeSection(trade, charts, t, country) {
    if (!trade) return [];

    const blocks = [];
    const title = `${country} — ${t.tradeOverview}, ${trade.periodLabel} ${trade.latestYear}`;
    blocks.push(sectionTitle(title));
    blocks.push(buildOverviewTable(
      trade.overview,
      { prevYear: trade.prevYear, latestYear: trade.latestYear, periodLabel: trade.periodLabel },
      t, trade.latestMonth, trade.monthNames,
    ));

    // Charts — turnover + dynamics, stacked full-width so every chart in the
    // document has identical width (500pt) and uniform height (≈150pt).
    if (charts.turnover) {
      blocks.push({
        unbreakable: true,
        stack: [
          { text: t.turnover, style: 'chartCaption' },
          { image: charts.turnover, width: 500, alignment: 'center' },
        ],
        margin: [0, 4, 0, 6],
      });
    }
    if (charts.dynamics) {
      blocks.push({
        unbreakable: true,
        stack: [
          { text: t.dynamics, style: 'chartCaption' },
          {
            columns: [
              { width: 'auto', canvas: [{ type: 'rect', x: 0, y: 3, w: 8, h: 8, color: '#16a34a' }] },
              { width: 'auto', text: t.export, fontSize: 8, margin: [4, 0, 10, 0] },
              { width: 'auto', canvas: [{ type: 'rect', x: 0, y: 3, w: 8, h: 8, color: '#dc2626' }] },
              { width: 'auto', text: t.import, fontSize: 8, margin: [4, 0, 0, 0] },
            ],
            alignment: 'center',
            margin: [0, 0, 0, 2],
          },
          { image: charts.dynamics, width: 500, alignment: 'center' },
        ],
        margin: [0, 0, 0, 8],
      });
    }

    // Export products + changes
    if (trade.hasExport) {
      blocks.push(subTitle(`${t.mainExport}, ${trade.periodLabel} ${trade.latestYear}`));
      blocks.push(buildProductsTable(trade.exportProducts, t, trade.periodLabel, trade.latestYear, true));

      const incLabel = trade.exportGrowing ? t.exportIncrease : t.exportDrop;
      const dropLabel = trade.exportGrowing ? t.exportDrop : t.exportIncrease;
      const incProds = trade.exportGrowing ? trade.exportChange.increase : trade.exportChange.drop;
      const dropProds = trade.exportGrowing ? trade.exportChange.drop : trade.exportChange.increase;

      if (incProds && incProds.length) {
        blocks.push(subTitle(`${incLabel}, ${trade.periodLabel} ${trade.latestYear}`));
        blocks.push(buildChangeTable(incProds, t, trade.periodLabel, trade.latestYear));
      }
      if (dropProds && dropProds.length) {
        blocks.push(subTitle(`${dropLabel}, ${trade.periodLabel} ${trade.latestYear}`));
        blocks.push(buildChangeTable(dropProds, t, trade.periodLabel, trade.latestYear));
      }
    }

    // Import products + changes
    if (trade.hasImport) {
      blocks.push(subTitle(`${t.mainImport}, ${trade.periodLabel} ${trade.latestYear}`));
      blocks.push(buildProductsTable(trade.importProducts, t, trade.periodLabel, trade.latestYear, false));

      const incLabel = trade.importGrowing ? t.importIncrease : t.importDrop;
      const dropLabel = trade.importGrowing ? t.importDrop : t.importIncrease;
      const incProds = trade.importGrowing ? trade.importChange.increase : trade.importChange.drop;
      const dropProds = trade.importGrowing ? trade.importChange.drop : trade.importChange.increase;

      if (incProds && incProds.length) {
        blocks.push(subTitle(`${incLabel}, ${trade.periodLabel} ${trade.latestYear}`));
        blocks.push(buildChangeTable(incProds, t, trade.periodLabel, trade.latestYear));
      }
      if (dropProds && dropProds.length) {
        blocks.push(subTitle(`${dropLabel}, ${trade.periodLabel} ${trade.latestYear}`));
        blocks.push(buildChangeTable(dropProds, t, trade.periodLabel, trade.latestYear));
      }
    }

    return blocks;
  }

  // ── Tourism section ────────────────────────────────────────────────────
  function buildTourismSection(tourism, charts, t, country) {
    if (!tourism) return [];
    const blocks = [];
    blocks.push(sectionTitle(`${country} — ${t.internationalVisitors}`));

    if (!tourism.hasData) {
      blocks.push({ text: t.noData, italics: true, color: '#94a3b8', fontSize: 9, margin: [0, 4, 0, 8] });
      return blocks;
    }

    const rows = [...(tourism.quarterlyRows || []), ...[...(tourism.annualRows || [])].reverse()];
    const body = [
      [th(t.period), thRight(t.visitors), thRight(t.changeHeader)],
    ];
    for (const r of rows) {
      let changeCell;
      if (r.changePct === null || r.changePct === undefined) {
        changeCell = tdNum('—');
      } else {
        const color = r.changePct > 0 ? '#16a34a' : (r.changePct < 0 ? '#dc2626' : '#475569');
        const sign = r.changePct > 0 ? '+' : '';
        changeCell = tdNum(`${sign}${formatPct(r.changePct)}`, { color });
      }
      body.push([
        tdText(r.label, r.isCurrent ? { bold: true } : {}),
        tdNum(r.visitors.toLocaleString()),
        changeCell,
      ]);
    }

    const tableBlock = {
      table: {
        dontBreakRows: true,
        widths: ['*', '*', 'auto'],
        body,
      },
      layout: tableLayout,
      margin: [0, 0, 0, 6],
    };

    if (charts.tourism) {
      blocks.push({
        unbreakable: true,
        stack: [
          tableBlock,
          { text: t.internationalVisitors, style: 'chartCaption', margin: [0, 6, 0, 2] },
          { image: charts.tourism, width: 500, alignment: 'center', margin: [0, 0, 0, 8] },
        ],
      });
    } else {
      blocks.push(tableBlock);
    }

    return blocks;
  }

  // ── Investments section ────────────────────────────────────────────────
  function buildInvestmentsSection(inv, charts, t, country) {
    if (!inv) return [];
    const blocks = [];
    blocks.push(sectionTitle(`${country} — ${t.fdi}`));

    if (!inv.hasData) {
      blocks.push({ text: t.noData, italics: true, color: '#94a3b8', fontSize: 9, margin: [0, 4, 0, 8] });
      return blocks;
    }

    const data = [...inv.tableData].reverse();
    const body = [
      [th(t.year), thRight(t.volumeHeader), thRight(t.changeHeader)],
    ];
    for (const r of data) {
      const pct = r.prevMln > 0
        ? ((r.valueMln - r.prevMln) / Math.abs(r.prevMln) * 100)
        : (r.valueMln > 0 ? 100 : 0);
      const color = pct > 0 ? '#16a34a' : (pct < 0 ? '#dc2626' : '#475569');
      const sign = pct > 0 ? '+' : '';
      body.push([
        tdText(String(r.year)),
        tdNum(formatMln(Math.abs(r.valueMln))),
        tdNum(`${sign}${formatPct(pct)}`, { color }),
      ]);
    }

    const tableBlock = {
      table: {
        dontBreakRows: true,
        widths: ['auto', '*', 'auto'],
        body,
      },
      layout: tableLayout,
      margin: [0, 0, 0, 6],
    };

    if (charts.fdi) {
      blocks.push({
        unbreakable: true,
        stack: [
          tableBlock,
          { text: t.fdiShort, style: 'chartCaption', margin: [0, 6, 0, 2] },
          { image: charts.fdi, width: 500, alignment: 'center', margin: [0, 0, 0, 8] },
        ],
      });
    } else {
      blocks.push(tableBlock);
    }

    return blocks;
  }

  // ── Document definition ────────────────────────────────────────────────
  function buildDocDefinition(state, opts) {
    const lang = opts.lang || 'en';
    const t = T[lang] || T.en;
    const country = opts.country || '';
    const dateStr = formatDate(lang);
    const charts = opts.charts || {};

    const content = [];
    content.push(...buildTradeSection(state.trade, charts, t, country));
    content.push(...buildTourismSection(state.tourism, charts, t, country));
    content.push(...buildInvestmentsSection(state.investments, charts, t, country));

    if (content.length === 0) {
      content.push({ text: t.noData, italics: true, color: '#94a3b8', margin: [0, 40, 0, 0], alignment: 'center' });
    }

    return {
      pageSize: 'A4',
      pageOrientation: 'portrait',
      pageMargins: [32, 46, 32, 40],
      defaultStyle: {
        font: 'FiraGO',
        fontSize: 9.5,
        lineHeight: 1.25,
        color: '#1f2937',
      },
      styles: {
        sectionTitle: { fontSize: 13, bold: true, color: '#0f172a', margin: [0, 10, 0, 6] },
        subTitle: { fontSize: 10.5, bold: true, color: '#1f2937', margin: [0, 8, 0, 4] },
        chartCaption: { fontSize: 9.5, bold: true, alignment: 'left', color: '#1f2937', margin: [0, 0, 0, 4] },
      },
      // Prevent orphaned titles. If a sectionTitle / subTitle would render
      // with no non-title content after it on the same page (because the
      // following table/chart got pushed to the next page), force the title
      // forward too. Chart captions are inside `unbreakable: true` stacks so
      // they already stay with their charts and don't need this hook.
      pageBreakBefore: function (currentNode, followingNodesOnPage) {
        const TITLE_STYLES = { sectionTitle: true, subTitle: true };
        const styleOf = (node) => {
          const s = node && node.style;
          return Array.isArray(s) ? s[0] : s;
        };
        if (!TITLE_STYLES[styleOf(currentNode)]) return false;
        return !followingNodesOnPage.some((n) => !TITLE_STYLES[styleOf(n)]);
      },
      header: function (currentPage) {
        return {
          columns: [
            { text: country, fontSize: 8.5, color: '#94a3b8', margin: [32, 18, 0, 0] },
            { text: `${t.generated}: ${dateStr}`, fontSize: 8.5, color: '#94a3b8', alignment: 'right', margin: [0, 18, 32, 0] },
          ],
        };
      },
      footer: function (currentPage, pageCount) {
        return {
          text: `${t.page} ${currentPage} ${t.of} ${pageCount}`,
          alignment: 'center',
          fontSize: 8,
          color: '#94a3b8',
          margin: [0, 14, 0, 0],
        };
      },
      content,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────
  async function build(state, opts) {
    if (typeof pdfMake === 'undefined') {
      throw new Error('pdfmake library not loaded');
    }
    await ensureFonts();
    const docDef = buildDocDefinition(state, opts);
    const safeCountry = (opts.country || 'report').replace(/[^a-zA-Z0-9\u10A0-\u10FF]/g, '_');
    const filename = `${safeCountry}_statistics_${opts.lang}.pdf`;
    pdfMake.createPdf(docDef).download(filename);
  }

  window.StatisticsPdf = { build };
})();
