/**
 * Statistics Page
 * Generates trade overview, export products, and import products reports
 * for a selected country using data from ex-trade-api.geostat.ge.
 *
 * Calls the Geostat API directly from the browser.
 * Falls back to our backend proxy (/api/statistics/) if direct calls fail.
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

  // ── Constants ──────────────────────────────────────────────────────────
  const GEOSTAT_API = 'https://ex-trade-api.geostat.ge/api/trade';
  const PROXY_API = `${API_BASE}/api/statistics`;

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const searchInput = document.getElementById('countrySearch');
  const dropdown = document.getElementById('countryDropdown');
  const countryValue = document.getElementById('countryValue');
  const generateBtn = document.getElementById('generateBtn');
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  const reportArea = document.getElementById('reportArea');
  const reportLoading = document.getElementById('reportLoading');
  const overviewHeader = document.getElementById('overviewHeader');
  const overviewTable = document.getElementById('overviewTable');
  const exportHeader = document.getElementById('exportHeader');
  const exportTable = document.getElementById('exportTable');
  const exportIncreaseHeader = document.getElementById('exportIncreaseHeader');
  const exportIncreaseTable = document.getElementById('exportIncreaseTable');
  const exportDropHeader = document.getElementById('exportDropHeader');
  const exportDropTable = document.getElementById('exportDropTable');
  const importHeader = document.getElementById('importHeader');
  const importTable = document.getElementById('importTable');
  const importIncreaseHeader = document.getElementById('importIncreaseHeader');
  const importIncreaseTable = document.getElementById('importIncreaseTable');
  const importDropHeader = document.getElementById('importDropHeader');
  const importDropTable = document.getElementById('importDropTable');
  const turnoverChartHeader = document.getElementById('turnoverChartHeader');
  const turnoverChartCanvas = document.getElementById('turnoverChart');
  const dynamicsChartHeader = document.getElementById('dynamicsChartHeader');
  const dynamicsChartCanvas = document.getElementById('dynamicsChart');
  // Investments tab
  const investmentsArea = document.getElementById('investmentsArea');
  const investmentsLoading = document.getElementById('investmentsLoading');
  const fdiHeader = document.getElementById('fdiHeader');
  const fdiTable = document.getElementById('fdiTable');
  const fdiChartHeader = document.getElementById('fdiChartHeader');
  const fdiChartCanvas = document.getElementById('fdiChart');
  // Tourism tab
  const tourismArea = document.getElementById('tourismArea');
  const tourismLoading = document.getElementById('tourismLoading');
  const tourismHeader = document.getElementById('tourismHeader');
  const tourismTableEl = document.getElementById('tourismTable');
  const tourismChartHeader = document.getElementById('tourismChartHeader');
  const tourismChartCanvas = document.getElementById('tourismChart');

  // ── State ────────────────────────────────────────────────────────────────
  let countries = [];
  let classData = null;
  let selectedCountry = null;
  let useProxy = false;
  let turnoverChartInstance = null;
  let dynamicsChartInstance = null;
  let fdiChartInstance = null;
  let tourismChartInstance = null;
  let countryNameMap = {}; // variant → canonical GNTA name
  let activeTab = 'trade';

  // ── PDF state ────────────────────────────────────────────────────────────
  // Captured alongside each tab's render so the PDF builder doesn't scrape
  // the DOM. Each sub-object is set to null before the tab re-renders, and
  // populated on successful completion.
  const pdfState = {
    country: null,
    trade: null,      // { overview, prevYear, prevPrevYear, latestYear, latestMonth, periodLabel, monthNames, hasExport, hasImport, exportGrowing, importGrowing, exportProducts, importProducts, exportChange, importChange }
    tourism: null,    // { hasData, quarterlyRows, annualRows }
    investments: null, // { hasData, tableData }
  };

  // ── Geostat API helpers (direct + proxy fallback) ────────────────────────

  async function geostatGet(path) {
    if (!useProxy) {
      try {
        const res = await fetch(`${GEOSTAT_API}${path}`);
        if (res.ok) return res.json();
      } catch (_) { /* fall through to proxy */ }
      useProxy = true;
    }
    const res = await fetch(`${PROXY_API}${path}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  }

  async function geostatPost(path, body) {
    if (!useProxy) {
      try {
        const res = await fetch(`${GEOSTAT_API}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) return res.json();
      } catch (_) { /* fall through to proxy */ }
      useProxy = true;
    }
    const res = await fetch(`${PROXY_API}${path.replace('/get_data', '/trade-data')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  }

  // ── Load classificatory data ─────────────────────────────────────────────
  const lang = I18n.getLocale() || 'en';

  try {
    const json = await geostatGet(`/classificatory?lang=${lang}`);
    if (json.success && json.data) {
      classData = json.data;
      countries = (json.data.countries || []).map(c => ({
        ...c,
        displayLabel: c.label.replace(/^\d+\s+/, ''),
      }));
    }
  } catch (err) {
    console.error('Failed to load classificatory data:', err);
  }

  // ── Load HS4 short name mapping ──────────────────────────────────────────
  const hs4NameMap = {};
  try {
    const csvRes = await fetch('/data/hs4-names-ka.csv');
    const csvText = await csvRes.text();
    for (const line of csvText.split('\n').slice(1)) {
      const comma = line.indexOf(',');
      if (comma < 0) continue;
      const code = parseInt(line.slice(0, comma).trim(), 10);
      const name = line.slice(comma + 1).trim().replace(/^"|"$/g, '');
      if (code && name) hs4NameMap[code] = name;
    }
  } catch (err) {
    console.error('Failed to load HS4 name mapping:', err);
  }

  // ── Load country name mapping (for tourism tab) ────────────────────────
  try {
    const csvRes = await fetch('/data/country-name-mapping.csv');
    const csvText = await csvRes.text();
    for (const line of csvText.split('\n').slice(1)) {
      // CSV format: "variant","canonical"
      const match = line.match(/"([^"]*)","([^"]*)"/);
      if (match) countryNameMap[match[1].trim()] = match[2].trim();
    }
  } catch (err) {
    console.error('Failed to load country name mapping:', err);
  }

  // ── Country search dropdown ──────────────────────────────────────────────

  function renderDropdown(filter) {
    const q = (filter || '').toLowerCase();
    const filtered = q
      ? countries.filter(c => c.displayLabel.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
      : countries;
    const shown = filtered.slice(0, 50);

    if (shown.length === 0) {
      dropdown.innerHTML = '<div class="stat-dropdown__empty">No results</div>';
    } else {
      dropdown.innerHTML = shown.map(c =>
        `<div class="stat-dropdown__item${selectedCountry && selectedCountry.value === c.value ? ' selected' : ''}" data-value="${c.value}">${escapeHtml(c.displayLabel)}</div>`
      ).join('');
    }
    dropdown.classList.remove('hidden');
  }

  searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
  searchInput.addEventListener('input', () => renderDropdown(searchInput.value));

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.stat-dropdown__item');
    if (!item) return;
    const val = Number(item.dataset.value);
    selectedCountry = countries.find(c => c.value === val) || null;
    if (selectedCountry) {
      searchInput.value = selectedCountry.displayLabel;
      countryValue.value = selectedCountry.value;
      generateBtn.disabled = false;
    }
    dropdown.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.stat-search-wrap')) {
      dropdown.classList.add('hidden');
    }
  });

  // ── Tab switching ─────────────────────────────────────────────────────────

  function showActiveTab() {
    reportArea.classList.add('hidden');
    investmentsArea.classList.add('hidden');
    tourismArea.classList.add('hidden');

    if (activeTab === 'trade') reportArea.classList.remove('hidden');
    else if (activeTab === 'tourism') tourismArea.classList.remove('hidden');
    else if (activeTab === 'investments') investmentsArea.classList.remove('hidden');
  }

  document.querySelectorAll('.stat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.stat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      showActiveTab();
    });
  });

  // ── Determine latest available period ────────────────────────────────────

  function detectLatestPeriod(cd) {
    if (cd.selected) {
      return { year: cd.selected.year, month: cd.selected.month };
    }
    const years = (cd.year || []).map(y => y.value).sort((a, b) => b - a);
    const months = (cd.month || []).map(m => m.value).sort((a, b) => b - a);
    return { year: years[0], month: months[0] };
  }

  // ── Generate report ──────────────────────────────────────────────────────

  generateBtn.addEventListener('click', async () => {
    if (!selectedCountry) return;
    // Reset PDF state for new country/run
    pdfState.country = selectedCountry;
    pdfState.trade = null;
    pdfState.tourism = null;
    pdfState.investments = null;
    // Generate trade first (user sees it immediately)
    await generateReport();
    // Fire tourism and investments in background (no await)
    generateTourism();
    generateInvestments();
  });

  async function generateReport() {
    if (!selectedCountry || !classData) return;

    showActiveTab();
    reportLoading.classList.remove('hidden');

    // Clear all sections and hide product cards
    const allHeaders = [
      overviewHeader, exportHeader, exportIncreaseHeader, exportDropHeader,
      importHeader, importIncreaseHeader, importDropHeader,
      turnoverChartHeader, dynamicsChartHeader,
    ];
    const allTables = [
      overviewTable, exportTable, exportIncreaseTable, exportDropTable,
      importTable, importIncreaseTable, importDropTable,
    ];
    for (const el of allHeaders) el.innerHTML = '';
    for (const el of allTables) el.innerHTML = '';

    // Hide all product/change cards (they get shown when they have data)
    const hiddenCards = [
      exportHeader, exportIncreaseHeader, exportDropHeader,
      importHeader, importIncreaseHeader, importDropHeader,
    ];
    for (const el of hiddenCards) hideCard(el);

    if (turnoverChartInstance) { turnoverChartInstance.destroy(); turnoverChartInstance = null; }
    if (dynamicsChartInstance) { dynamicsChartInstance.destroy(); dynamicsChartInstance = null; }
    // Also clear any orphaned chart instances on the canvases
    const existingTurnover = Chart.getChart(turnoverChartCanvas);
    if (existingTurnover) existingTurnover.destroy();
    const existingDynamics = Chart.getChart(dynamicsChartCanvas);
    if (existingDynamics) existingDynamics.destroy();

    try {
      const { year: latestYear, month: latestMonth } = detectLatestPeriod(classData);

      const monthsYTD = [];
      for (let m = 1; m <= latestMonth; m++) monthsYTD.push(m);

      const monthNames = classData.month || [];
      const firstMonthName = monthNames.find(m => m.value === 1)?.label || 'Jan';
      const lastMonthName = monthNames.find(m => m.value === latestMonth)?.label || `Month ${latestMonth}`;
      const periodLabel = monthsYTD.length === 1
        ? firstMonthName.slice(0, 3)
        : `${firstMonthName.slice(0, 3)}-${lastMonthName.slice(0, 3)}`;

      const prevYear = latestYear - 1;
      const prevPrevYear = latestYear - 2;
      const allMonths = [1,2,3,4,5,6,7,8,9,10,11,12];
      const countryId = selectedCountry.value;

      // Chart years: 5 previous full years
      const chartYears = [];
      for (let y = prevYear - 4; y <= prevYear; y++) chartYears.push(y);

      // Build all fetch promises
      const fetchPromises = [
        // Overview totals
        fetchTradeTotal(10, [prevYear], allMonths, countryId),
        fetchTradeTotal(10, [prevPrevYear], allMonths, countryId),
        fetchTradeTotal(10, [latestYear], monthsYTD, countryId),
        fetchTradeTotal(10, [prevYear], monthsYTD, countryId),
        fetchTradeTotal(11, [prevYear], allMonths, countryId),
        fetchTradeTotal(11, [prevPrevYear], allMonths, countryId),
        fetchTradeTotal(11, [latestYear], monthsYTD, countryId),
        fetchTradeTotal(11, [prevYear], monthsYTD, countryId),
        // Product tables
        fetchAllTradeData(10, [latestYear], monthsYTD, countryId),
        fetchAllTradeData(10, [prevYear], monthsYTD, countryId),
        fetchAllTradeData(13, [latestYear], monthsYTD, countryId),
        fetchAllTradeData(11, [latestYear], monthsYTD, countryId),
        fetchAllTradeData(11, [prevYear], monthsYTD, countryId),
      ];

      // Chart data: export & import for each of 5 years (full year)
      for (const y of chartYears) {
        fetchPromises.push(fetchTradeTotal(10, [y], allMonths, countryId)); // export
        fetchPromises.push(fetchTradeTotal(11, [y], allMonths, countryId)); // import
      }
      // Chart data: export & import for each month of current year
      for (const m of monthsYTD) {
        fetchPromises.push(fetchTradeTotal(10, [latestYear], [m], countryId));
        fetchPromises.push(fetchTradeTotal(11, [latestYear], [m], countryId));
      }

      const results = await Promise.all(fetchPromises);

      // Unpack overview & product table results (first 13)
      const [
        expFullCurr, expFullPrev, expMonthCurr, expMonthPrev,
        impFullCurr, impFullPrev, impMonthCurr, impMonthPrev,
        expHsCurrent, expHsPrev, reexHsCurrent,
        impHsCurrent, impHsPrev,
      ] = results;

      // Unpack chart year results (next chartYears.length * 2)
      let idx = 13;
      const chartYearExports = [];
      const chartYearImports = [];
      for (let i = 0; i < chartYears.length; i++) {
        chartYearExports.push(results[idx++] / 1000); // Thsd → Mln
        chartYearImports.push(results[idx++] / 1000);
      }

      // Unpack chart month results (next monthsYTD.length * 2)
      const chartMonthExports = [];
      const chartMonthImports = [];
      for (let i = 0; i < monthsYTD.length; i++) {
        chartMonthExports.push(results[idx++] / 1000);
        chartMonthImports.push(results[idx++] / 1000);
      }

      // ── 1. Trade overview table ──────────────────────────────────────
      const overview = buildOverviewData(
        { expFull: expFullCurr, expFullPrev: expFullPrev, impFull: impFullCurr, impFullPrev: impFullPrev },
        { expMonth: expMonthCurr, expMonthPrev: expMonthPrev, impMonth: impMonthCurr, impMonthPrev: impMonthPrev },
      );
      renderOverview(overview, prevYear, prevPrevYear, latestYear, latestMonth, periodLabel, monthNames);

      // ── 2. Charts ──────────────────────────────────────────────────────
      renderCharts(
        chartYears, chartYearExports, chartYearImports,
        monthsYTD, chartMonthExports, chartMonthImports,
        latestYear, monthNames,
      );

      // Check if there was any export/import in the latest period
      const hasExport = overview.latestPeriod.export > 0;
      const hasImport = overview.latestPeriod.import > 0;

      // Determine if export/import is increasing or declining in YTD
      const exportGrowing = overview.latestPeriod.export >= overview.latestPeriod.exportPrev;
      const importGrowing = overview.latestPeriod.import >= overview.latestPeriod.importPrev;

      // ── 3. Export products tables (only if export > 0) ─────────────
      if (hasExport) {
        const exportProducts = buildProductList(expHsCurrent, expHsPrev, reexHsCurrent);
        renderSectionHeader(exportHeader, 'export', periodLabel, latestYear);
        renderProductTable(exportTable, exportProducts, periodLabel, latestYear, true);
        showCard(exportHeader);

        const { increase, drop } = buildChangeLists(expHsCurrent, expHsPrev);
        if (exportGrowing) {
          if (increase.length > 0) {
            renderSectionHeader(exportIncreaseHeader, 'exportIncrease', periodLabel, latestYear);
            renderChangeTable(exportIncreaseTable, increase, periodLabel, latestYear);
            showCard(exportIncreaseHeader);
          }
          if (drop.length > 0) {
            renderSectionHeader(exportDropHeader, 'exportDrop', periodLabel, latestYear);
            renderChangeTable(exportDropTable, drop, periodLabel, latestYear);
            showCard(exportDropHeader);
          }
        } else {
          if (drop.length > 0) {
            renderSectionHeader(exportIncreaseHeader, 'exportDrop', periodLabel, latestYear);
            renderChangeTable(exportIncreaseTable, drop, periodLabel, latestYear);
            showCard(exportIncreaseHeader);
          }
          if (increase.length > 0) {
            renderSectionHeader(exportDropHeader, 'exportIncrease', periodLabel, latestYear);
            renderChangeTable(exportDropTable, increase, periodLabel, latestYear);
            showCard(exportDropHeader);
          }
        }
      }

      // ── 4. Import products tables (only if import > 0) ─────────────
      if (hasImport) {
        const importProducts = buildProductList(impHsCurrent, impHsPrev, null);
        renderSectionHeader(importHeader, 'import', periodLabel, latestYear);
        renderProductTable(importTable, importProducts, periodLabel, latestYear, false);
        showCard(importHeader);

        const { increase: impIncrease, drop: impDrop } = buildChangeLists(impHsCurrent, impHsPrev);
        if (importGrowing) {
          if (impIncrease.length > 0) {
            renderSectionHeader(importIncreaseHeader, 'importIncrease', periodLabel, latestYear);
            renderChangeTable(importIncreaseTable, impIncrease, periodLabel, latestYear);
            showCard(importIncreaseHeader);
          }
          if (impDrop.length > 0) {
            renderSectionHeader(importDropHeader, 'importDrop', periodLabel, latestYear);
            renderChangeTable(importDropTable, impDrop, periodLabel, latestYear);
            showCard(importDropHeader);
          }
        } else {
          if (impDrop.length > 0) {
            renderSectionHeader(importIncreaseHeader, 'importDrop', periodLabel, latestYear);
            renderChangeTable(importIncreaseTable, impDrop, periodLabel, latestYear);
            showCard(importIncreaseHeader);
          }
          if (impIncrease.length > 0) {
            renderSectionHeader(importDropHeader, 'importIncrease', periodLabel, latestYear);
            renderChangeTable(importDropTable, impIncrease, periodLabel, latestYear);
            showCard(importDropHeader);
          }
        }
      }

      // ── Capture PDF state ────────────────────────────────────────────
      pdfState.country = selectedCountry;
      pdfState.trade = {
        overview,
        prevYear, prevPrevYear, latestYear, latestMonth,
        periodLabel, monthNames,
        hasExport, hasImport, exportGrowing, importGrowing,
        exportProducts: hasExport ? buildProductList(expHsCurrent, expHsPrev, reexHsCurrent) : null,
        importProducts: hasImport ? buildProductList(impHsCurrent, impHsPrev, null) : null,
        exportChange: hasExport ? buildChangeLists(expHsCurrent, expHsPrev) : null,
        importChange: hasImport ? buildChangeLists(impHsCurrent, impHsPrev) : null,
      };

    } catch (err) {
      console.error('Report generation error:', err);
      overviewTable.innerHTML = `<div class="msg msg-error">Failed to generate report: ${escapeHtml(err.message)}</div>`;
    } finally {
      reportLoading.classList.add('hidden');
      exportPdfBtn.disabled = false;
    }
  }

  // ── Fetch trade total (single value, no HS breakdown) ──────────────────

  async function fetchTradeTotal(tradeFlow, years, months, countryId) {
    const filters = {
      tradeFlow,
      measurementUnits: [1],
      years,
      months,
      countries: [countryId],
      locale: lang,
      sum: true,
      page: 1,
      pageSize: 10,
    };

    const json = await geostatPost('/get_data', filters);
    if (!json.success) return 0;

    // Use the isGroupSummary row (it's already the total), skip individual rows
    if (Array.isArray(json.data)) {
      for (const row of json.data) {
        if (row.isGroupSummary) return extractValue(row);
      }
      // If no summary row, use first row only
      if (json.data.length > 0) return extractValue(json.data[0]);
    }
    return 0;
  }

  // ── Fetch all trade data with HS breakdown (paginated) ─────────────────

  async function fetchAllTradeData(tradeFlow, years, months, countryId) {
    const allData = [];
    let page = 1;
    let total = Infinity;
    const pageSize = 200;

    while (allData.length < total && page < 100) {
      const filters = {
        tradeFlow,
        measurementUnits: [1],
        years,
        months,
        countries: [countryId],
        hs4: ['all'],
        locale: lang,
        sum: true,
        page,
        pageSize,
      };

      const json = await geostatPost('/get_data', filters);
      if (!json.success) throw new Error('Trade data fetch failed');

      total = json.total || 0;
      if (Array.isArray(json.data)) {
        allData.push(...json.data);
      }
      if (!json.data || json.data.length === 0) break;
      page++;
    }

    return allData;
  }

  // ── Build overview data ────────────────────────────────────────────────

  function buildOverviewData(full, month) {
    const expFullMln = full.expFull / 1000;
    const expFullPrevMln = full.expFullPrev / 1000;
    const impFullMln = full.impFull / 1000;
    const impFullPrevMln = full.impFullPrev / 1000;

    const expMonthMln = month.expMonth / 1000;
    const expMonthPrevMln = month.expMonthPrev / 1000;
    const impMonthMln = month.impMonth / 1000;
    const impMonthPrevMln = month.impMonthPrev / 1000;

    return {
      fullYear: {
        turnover: expFullMln + impFullMln,
        turnoverPrev: expFullPrevMln + impFullPrevMln,
        export: expFullMln,
        exportPrev: expFullPrevMln,
        import: impFullMln,
        importPrev: impFullPrevMln,
        balance: expFullMln - impFullMln,
      },
      latestPeriod: {
        turnover: expMonthMln + impMonthMln,
        turnoverPrev: expMonthPrevMln + impMonthPrevMln,
        export: expMonthMln,
        exportPrev: expMonthPrevMln,
        import: impMonthMln,
        importPrev: impMonthPrevMln,
        balance: expMonthMln - impMonthMln,
      },
    };
  }

  // ── Render trade overview ──────────────────────────────────────────────

  function renderOverview(data, prevYear, prevPrevYear, latestYear, latestMonth, periodLabel, monthNames) {
    const isKa = I18n.getLocale() === 'ka';

    const monthLabel = monthNames.find(m => m.value === latestMonth)?.label || `${latestMonth}`;
    const colFull = `${prevYear}`;
    const colMonth = `${latestYear} .${String(latestMonth).padStart(2, '0')}`;

    overviewHeader.innerHTML = `<h3 class="stat-report__title">${escapeHtml(selectedCountry.displayLabel)} - ${isKa ? 'სავაჭრო მიმოხილვა' : 'Trade Overview'}</h3>`;

    const rows = [
      { key: 'turnover', label: isKa ? 'ბრუნვა' : 'Trade Turnover' },
      { key: 'export', label: isKa ? 'ექსპორტი' : 'Export' },
      { key: 'import', label: isKa ? 'იმპორტი' : 'Import' },
      { key: 'balance', label: isKa ? 'ბალანსი' : 'Balance' },
    ];

    const mln = isKa ? 'მლნ. აშშ დოლარი' : 'mln USD';
    const increaseWord = isKa ? 'ზრდა' : 'increase';
    const decreaseWord = isKa ? 'კლება' : 'decrease';
    const negativeWord = isKa ? 'ნეგატიური' : 'negative';
    const positiveWord = isKa ? 'პოზიტიური' : 'positive';
    const zeroMessages = {
      turnover: isKa ? 'ვაჭრობა არ განხორციელდა' : 'No trade conducted',
      export: isKa ? 'ექსპორტი არ განხორციელდა' : 'No exports conducted',
      import: isKa ? 'იმპორტი არ განხორციელდა' : 'No imports conducted',
    };

    function formatCell(value, prevValue, isBalance, key, periodData) {
      // If turnover is 0, balance shows "-"
      if (isBalance && periodData.turnover === 0) return '-';
      // Zero value messages
      if (value === 0 && !isBalance && zeroMessages[key]) return zeroMessages[key];
      if (isBalance) {
        const sign = value < 0 ? negativeWord : positiveWord;
        return `${sign} ${formatMln2(value)} ${mln}`;
      }
      const pct = calcChange(value, prevValue);
      const dir = pct >= 0 ? increaseWord : decreaseWord;
      return `${formatMln2(Math.abs(value))} ${mln}, ${dir} ${formatChangePct(pct)}`;
    }

    let html = `<table class="stat-table stat-overview-table">
      <thead>
        <tr>
          <th></th>
          <th class="stat-col-overview">${colFull}</th>
          <th class="stat-col-overview">${colMonth}</th>
        </tr>
      </thead>
      <tbody>`;

    for (const r of rows) {
      const isBalance = r.key === 'balance';
      const fullVal = data.fullYear[r.key];
      const fullPrev = data.fullYear[r.key + 'Prev'];
      const monthVal = data.latestPeriod[r.key];
      const monthPrev = data.latestPeriod[r.key + 'Prev'];

      html += `
        <tr>
          <td class="stat-overview-label">${escapeHtml(r.label)}</td>
          <td class="stat-col-overview">${formatCell(fullVal, fullPrev, isBalance, r.key, data.fullYear)}</td>
          <td class="stat-col-overview">${formatCell(monthVal, monthPrev, isBalance, r.key, data.latestPeriod)}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    overviewTable.innerHTML = html;
  }

  // ── Change % calculation ───────────────────────────────────────────────

  function calcChange(current, previous) {
    if (!previous || previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
  }

  // ── Format change % — full integers, decimals only between -1 and +1 ──

  function formatChangePct(pct) {
    const rounded = Math.round(pct);
    // If it rounds to 0 but isn't actually 0, use one decimal
    if (rounded === 0 && pct !== 0) {
      return pct.toFixed(1) + '%';
    }
    return rounded + '%';
  }

  // ── Format millions (for overview: 2 decimal places with comma thousands)

  function formatMln2(val) {
    return val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ── Build product list ─────────────────────────────────────────────────

  // ── Render charts ─────────────────────────────────────────────────────────

  function renderCharts(
    chartYears, yearExports, yearImports,
    monthsYTD, monthExports, monthImports,
    latestYear, monthNames,
  ) {
    const isKa = I18n.getLocale() === 'ka';

    // Build labels: "2021", "2022", ... "2025", "Jan-Feb'26"
    const labels = chartYears.map(String);
    const shortYear = String(latestYear).slice(2);

    // Sum months into a single YTD bar
    const ytdExport = monthExports.reduce((s, v) => s + v, 0);
    const ytdImport = monthImports.reduce((s, v) => s + v, 0);

    if (monthsYTD.length === 1) {
      const mName = monthNames.find(mn => mn.value === monthsYTD[0])?.label || `M${monthsYTD[0]}`;
      labels.push(`${mName.slice(0, 3)}'${shortYear}`);
    } else {
      const first = monthNames.find(mn => mn.value === monthsYTD[0])?.label || '';
      const last = monthNames.find(mn => mn.value === monthsYTD[monthsYTD.length - 1])?.label || '';
      labels.push(`${first.slice(0, 3)}-${last.slice(0, 3)}'${shortYear}`);
    }

    // Turnover data = export + import
    const turnoverData = [
      ...yearExports.map((e, i) => e + yearImports[i]),
      ytdExport + ytdImport,
    ];

    // Common chart options
    const commonOptions = {
      responsive: true,
      maintainAspectRatio: true,
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
        datalabels: {
          anchor: 'end',
          align: 'end',
          font: { size: 11, weight: '600' },
          formatter: (v) => chartLabel(v),
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 11 } },
        },
        y: {
          display: false,
          grid: { display: false },
          beginAtZero: true,
        },
      },
    };

    // ── Turnover chart ─────────────────────────────────────────────
    turnoverChartHeader.innerHTML = `<h3 class="stat-report__title">${isKa ? 'სავაჭრო ბრუნვა' : 'Trade Turnover'}</h3>`;

    turnoverChartInstance = new Chart(turnoverChartCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: turnoverData,
          backgroundColor: turnoverData.map((_, i) => i < chartYears.length ? '#3b82f6' : '#60a5fa'),
          borderRadius: 3,
        }],
      },
      options: {
        ...commonOptions,
        plugins: {
          ...commonOptions.plugins,
          datalabels: {
            ...commonOptions.plugins.datalabels,
            color: '#374151',
          },
        },
      },
      plugins: [ChartDataLabels],
    });

    // ── Export–Import dynamics chart ────────────────────────────────
    const expLabel = isKa ? 'ექსპორტი' : 'Export';
    const impLabel = isKa ? 'იმპორტი' : 'Import';
    dynamicsChartHeader.innerHTML = `
      <div class="stat-chart-title-row">
        <h3 class="stat-report__title">${isKa ? 'ექსპორტ-იმპორტის დინამიკა' : 'Export–Import Dynamics'}</h3>
        <div class="stat-chart-legend">
          <div class="stat-chart-legend__item"><span class="stat-chart-legend__color" style="background:#16a34a"></span>${escapeHtml(expLabel)}</div>
          <div class="stat-chart-legend__item"><span class="stat-chart-legend__color" style="background:#dc2626"></span>${escapeHtml(impLabel)}</div>
        </div>
      </div>`;

    const expData = [...yearExports, ytdExport];
    const impData = [...yearImports, ytdImport];

    dynamicsChartInstance = new Chart(dynamicsChartCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: isKa ? 'ექსპორტი' : 'Export',
            data: expData,
            backgroundColor: expData.map((_, i) => i < chartYears.length ? '#16a34a' : '#4ade80'),
            borderRadius: 3,
          },
          {
            label: isKa ? 'იმპორტი' : 'Import',
            data: impData,
            backgroundColor: impData.map((_, i) => i < chartYears.length ? '#dc2626' : '#f87171'),
            borderRadius: 3,
          },
        ],
      },
      options: {
        ...commonOptions,
        plugins: {
          ...commonOptions.plugins,
          legend: { display: false },
          datalabels: {
            ...commonOptions.plugins.datalabels,
            color: '#374151',
            font: { size: 10, weight: '600' },
          },
        },
      },
      plugins: [ChartDataLabels],
    });
  }

  // ── Chart data label formatter ───────────────────────────────────────────

  function chartLabel(val) {
    return val.toFixed(2);
  }

  // ── Build product list ─────────────────────────────────────────────────

  // ── Build export increase / drop lists ──────────────────────────────────
  // Sorted by absolute USD difference (not percentage)

  function buildChangeLists(currentData, prevData) {
    // Build current map: hs4 → { name, valueThdUsd }
    const currentMap = {};
    for (const row of currentData) {
      if (row.isGroupSummary || !row.hs4) continue;
      const val = extractValue(row);
      if (!currentMap[row.hs4]) {
        currentMap[row.hs4] = { hs4: row.hs4, name: cleanHs4Name(row.hs4_name || `HS ${row.hs4}`, row.hs4), valueThdUsd: 0 };
      }
      currentMap[row.hs4].valueThdUsd += val;
    }

    // Build prev map: hs4 → { valueThdUsd, name }
    const prevMap = {};
    for (const row of prevData) {
      if (row.isGroupSummary || !row.hs4) continue;
      const val = extractValue(row);
      if (!prevMap[row.hs4]) {
        prevMap[row.hs4] = { valueThdUsd: 0, name: cleanHs4Name(row.hs4_name || `HS ${row.hs4}`, row.hs4) };
      }
      prevMap[row.hs4].valueThdUsd += val;
    }

    // Merge all HS4 codes from both periods
    const allHs4 = new Set([...Object.keys(currentMap), ...Object.keys(prevMap)]);
    const products = [];
    for (const hs4 of allHs4) {
      const curr = currentMap[hs4]?.valueThdUsd || 0;
      const prev = prevMap[hs4]?.valueThdUsd || 0;
      const diffThd = curr - prev;
      const diffMln = diffThd / 1000;
      const currMln = curr / 1000;
      const prevMln = prev / 1000;
      const name = currentMap[hs4]?.name || prevMap[hs4]?.name || `HS ${hs4}`;
      const changePct = prevMln > 0
        ? ((currMln - prevMln) / prevMln * 100)
        : (currMln > 0 ? 100 : 0);
      products.push({ name, valueMln: currMln, changePct, diffMln });
    }

    // Increase: positive diff, sorted by diff descending, max 15, min 0.01 mln diff
    const increased = products
      .filter(p => p.diffMln > 0)
      .sort((a, b) => b.diffMln - a.diffMln)
      .filter(p => p.diffMln >= 0.01)
      .slice(0, 10);

    // Drop: negative diff, sorted by diff ascending (most negative first), max 10
    const dropped = products
      .filter(p => p.diffMln < 0)
      .sort((a, b) => a.diffMln - b.diffMln)
      .filter(p => p.diffMln <= -0.01)
      .slice(0, 10);

    return { increase: increased, drop: dropped };
  }

  // ── Render change table (increase / drop) ────────────────────────────────

  function renderChangeTable(el, products, periodLabel, year) {
    if (products.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>${I18n.getLocale() === 'ka' ? 'მონაცემები ვერ მოიძებნა' : 'No data found'}</p></div>`;
      return;
    }

    const isKa = I18n.getLocale() === 'ka';
    const hProduct = isKa ? 'პროდუქცია (HS 4-ნიშნა)' : 'Product (HS 4-digit)';
    const hValue = isKa ? `${periodLabel} ${year}<br>მლნ. $` : `${periodLabel} ${year}<br>mln $`;
    const hChange = isKa ? 'ცვლილება<br>%' : 'Change<br>%';
    const hDiff = isKa ? 'სხვაობა<br>მლნ. $' : 'Difference<br>mln $';

    let html = `<table class="stat-table">
      <thead>
        <tr>
          <th class="stat-col-product">${hProduct}</th>
          <th class="stat-col-value">${hValue}</th>
          <th class="stat-col-change">${hChange}</th>
          <th class="stat-col-diff">${hDiff}</th>
        </tr>
      </thead>
      <tbody>`;

    for (const p of products) {
      const changeClass = p.changePct > 0 ? 'stat-positive' : (p.changePct < 0 ? 'stat-negative' : '');
      const changeSign = p.changePct > 0 ? '+' : '';
      const diffSign = p.diffMln > 0 ? '+' : '';
      const diffClass = p.diffMln > 0 ? 'stat-positive' : 'stat-negative';
      html += `
        <tr>
          <td class="stat-col-product">${escapeHtml(p.name)}</td>
          <td class="stat-col-value">${formatMln(p.valueMln)}</td>
          <td class="stat-col-change ${changeClass}">${changeSign}${formatChangePct(p.changePct)}</td>
          <td class="stat-col-diff ${diffClass}">${diffSign}${formatMln(Math.abs(p.diffMln))}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // ── Build product list ─────────────────────────────────────────────────

  function buildProductList(currentData, prevData, reexportData) {
    const currentMap = {};
    for (const row of currentData) {
      if (row.isGroupSummary || !row.hs4) continue;
      const val = extractValue(row);
      if (val > 0) {
        if (!currentMap[row.hs4]) {
          currentMap[row.hs4] = {
            hs4: row.hs4,
            name: cleanHs4Name(row.hs4_name || `HS ${row.hs4}`, row.hs4),
            valueThdUsd: 0,
          };
        }
        currentMap[row.hs4].valueThdUsd += val;
      }
    }

    const prevMap = {};
    for (const row of prevData) {
      if (row.isGroupSummary || !row.hs4) continue;
      const val = extractValue(row);
      if (val > 0) prevMap[row.hs4] = (prevMap[row.hs4] || 0) + val;
    }

    const reexportMap = {};
    if (reexportData) {
      for (const row of reexportData) {
        if (row.isGroupSummary || !row.hs4) continue;
        const val = extractValue(row);
        if (val > 0) reexportMap[row.hs4] = (reexportMap[row.hs4] || 0) + val;
      }
    }

    let products = Object.values(currentMap)
      .sort((a, b) => b.valueThdUsd - a.valueThdUsd)
      .map(p => ({
        ...p,
        valueMln: p.valueThdUsd / 1000,
        prevValueMln: (prevMap[p.hs4] || 0) / 1000,
        reexportMln: (reexportMap[p.hs4] || 0) / 1000,
      }));

    const significant = products.filter(p => p.valueMln >= 0.01);
    let result;
    if (significant.length >= 5) {
      result = significant.slice(0, 15);
    } else {
      result = products.slice(0, Math.max(5, significant.length));
    }

    return result.map(p => ({
      name: p.name,
      valueMln: p.valueMln,
      change: p.prevValueMln > 0
        ? ((p.valueMln - p.prevValueMln) / p.prevValueMln * 100)
        : (p.valueMln > 0 ? 100 : 0),
      reexportShare: p.valueMln > 0
        ? (p.reexportMln / p.valueMln * 100)
        : 0,
    }));
  }

  // ── Extract numeric value from a data row ────────────────────────────────

  function extractValue(row) {
    for (const key of Object.keys(row)) {
      if (key.startsWith('usd1000_')) {
        const v = parseFloat(row[key]);
        if (!isNaN(v)) return v;
      }
    }
    return 0;
  }

  // ── Clean HS4 name ───────────────────────────────────────────────────────

  // ── Show / hide parent card ───────────────────────────────────────────────

  function showCard(el) {
    const card = el.closest('.card');
    if (card) card.style.display = '';
  }

  function hideCard(el) {
    const card = el.closest('.card');
    if (card) card.style.display = 'none';
  }

  function cleanHs4Name(name, hs4Code) {
    // Use short name from mapping if available
    if (hs4Code && hs4NameMap[hs4Code]) return hs4NameMap[hs4Code];
    return name.replace(/^\d{2,6}\s+/, '');
  }

  // ── Render section header ────────────────────────────────────────────────

  function renderSectionHeader(el, type, periodLabel, year) {
    const isKa = I18n.getLocale() === 'ka';
    const labels = {
      export: isKa ? 'ძირითადი საექსპორტო პროდუქცია' : 'Main Export Products',
      import: isKa ? 'ძირითადი საიმპორტო პროდუქცია' : 'Main Import Products',
      exportIncrease: isKa ? 'ექსპორტში ყველაზე მეტად გაზრდილი პროდუქცია' : 'Most Increased Export Products',
      exportDrop: isKa ? 'ექსპორტში ყველაზე მეტად შემცირებული პროდუქცია' : 'Most Decreased Export Products',
      importIncrease: isKa ? 'იმპორტში ყველაზე მეტად გაზრდილი პროდუქცია' : 'Most Increased Import Products',
      importDrop: isKa ? 'იმპორტში ყველაზე მეტად შემცირებული პროდუქცია' : 'Most Decreased Import Products',
    };
    const t = `${selectedCountry.displayLabel} - ${labels[type]}, ${periodLabel} ${year}`;
    el.innerHTML = `<h3 class="stat-report__title">${escapeHtml(t)}</h3>`;
  }

  // ── Render product table ─────────────────────────────────────────────────

  function renderProductTable(el, products, periodLabel, year, showReexport) {
    if (products.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>${I18n.getLocale() === 'ka' ? 'მონაცემები ვერ მოიძებნა' : 'No data found'}</p></div>`;
      return;
    }

    const isKa = I18n.getLocale() === 'ka';
    const hProduct = isKa ? 'პროდუქცია (HS 4-ნიშნა)' : 'Product (HS 4-digit)';
    const hValue = isKa ? `${periodLabel} ${year}<br>მლნ. $` : `${periodLabel} ${year}<br>mln $`;
    const hChange = isKa ? 'ცვლილება<br>%' : 'Change<br>%';
    const hReexport = isKa ? 'რეექსპორტის წილი<br>%' : 'Re-export share<br>%';

    const INITIAL_COUNT = 10;
    const hasMore = products.length > INITIAL_COUNT;

    let html = `<table class="stat-table">
      <thead>
        <tr>
          <th class="stat-col-product">${hProduct}</th>
          <th class="stat-col-value">${hValue}</th>
          <th class="stat-col-change">${hChange}</th>
          ${showReexport ? `<th class="stat-col-reexport">${hReexport}</th>` : ''}
        </tr>
      </thead>
      <tbody>`;

    products.forEach((p, i) => {
      const changeClass = p.change > 0 ? 'stat-positive' : (p.change < 0 ? 'stat-negative' : '');
      const changeSign = p.change > 0 ? '+' : '';
      const hiddenStyle = (hasMore && i >= INITIAL_COUNT) ? ' style="display:none" data-expandable' : '';
      html += `
        <tr${hiddenStyle}>
          <td class="stat-col-product">${escapeHtml(p.name)}</td>
          <td class="stat-col-value">${formatMln(p.valueMln)}</td>
          <td class="stat-col-change ${changeClass}">${changeSign}${formatChangePct(p.change)}</td>
          ${showReexport ? `<td class="stat-col-reexport">${p.reexportShare === 0 ? '-' : formatChangePct(p.reexportShare)}</td>` : ''}
        </tr>`;
    });

    html += '</tbody></table>';

    if (hasMore) {
      const showMoreText = isKa ? 'მეტის ჩვენება' : 'Show more';
      const showLessText = isKa ? 'ნაკლების ჩვენება' : 'Show less';
      html += `<button class="stat-expand-btn" data-more="${showMoreText}" data-less="${showLessText}">${showMoreText}</button>`;
    }

    el.innerHTML = html;

    // Wire up expand/collapse
    const btn = el.querySelector('.stat-expand-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        const rows = el.querySelectorAll('tr[data-expandable]');
        const expanded = rows[0]?.style.display !== 'none';
        rows.forEach(r => r.style.display = expanded ? 'none' : '');
        btn.textContent = expanded ? btn.dataset.more : btn.dataset.less;
      });
    }
  }

  // ── Format millions (for product tables) ─────────────────────────────────

  function formatMln(val) {
    let str;
    if (val >= 100) str = val.toFixed(1);
    else if (val >= 10) str = val.toFixed(2);
    else if (val >= 0.01) str = val.toFixed(2);
    else if (val > 0) str = val.toFixed(3);
    else str = '0.00';
    return str.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── TOURISM TAB ────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════

  // Resolve a country displayLabel to GNTA country name
  function resolveGntaName(displayLabel, gntaCountries) {
    // Direct match
    if (gntaCountries[displayLabel]) return displayLabel;
    // Try via mapping
    const canonical = countryNameMap[displayLabel];
    if (canonical && gntaCountries[canonical]) return canonical;
    // Try reverse: the mapping canonical might differ from GNTA name
    // Check all mapping entries where variant matches displayLabel
    for (const [variant, canon] of Object.entries(countryNameMap)) {
      if (variant === displayLabel) {
        // Try finding a GNTA country that starts with the canonical name or vice versa
        for (const gntaName of Object.keys(gntaCountries)) {
          if (gntaName === canon || gntaName.includes(canon) || canon.includes(gntaName)) {
            return gntaName;
          }
        }
      }
    }
    return null;
  }

  async function generateTourism() {
    if (!selectedCountry) return;

    tourismLoading.classList.remove('hidden');
    tourismTableEl.innerHTML = '';
    tourismHeader.innerHTML = '';
    tourismChartHeader.innerHTML = '';
    if (tourismChartInstance) { tourismChartInstance.destroy(); tourismChartInstance = null; }
    const existingChart = Chart.getChart(tourismChartCanvas);
    if (existingChart) existingChart.destroy();

    try {
      const res = await fetch(`${API_BASE}/api/statistics/tourism`);
      const json = await res.json();
      if (!json.success) throw new Error('Tourism data fetch failed');

      const gntaName = resolveGntaName(selectedCountry.displayLabel, json.countries);
      const countryData = gntaName ? json.countries[gntaName] : null;

      if (!countryData) {
        tourismTableEl.innerHTML = `<div class="empty-state"><p>${I18n.getLocale() === 'ka' ? 'მონაცემები ვერ მოიძებნა' : 'No data found'}</p></div>`;
        pdfState.tourism = { hasData: false };
        tourismLoading.classList.add('hidden');
        return;
      }

      // New data shape: countryData = { annual: {year: N}, current: N|null, compare: N|null }
      const annual = countryData.annual || {};
      const allYears = json.years || [];
      const latestYear = allYears[allYears.length - 1];

      // Build annual rows: last 5 years
      const annualRows = [];
      for (let y = latestYear - 4; y <= latestYear; y++) {
        if (allYears.includes(y)) {
          const val = annual[y] || 0;
          const prev = annual[y - 1] || 0;
          const pct = prev > 0
            ? ((val - prev) / prev * 100)
            : (val > 0 ? 100 : 0);
          annualRows.push({
            label: String(y),
            year: y,
            visitors: val,
            changePct: pct,
            isCurrent: false,
          });
        }
      }

      // Prepend quarterly rows if currentPeriod exists
      const quarterlyRows = [];
      if (json.currentPeriod && countryData.current !== null) {
        const cur = countryData.current || 0;
        const cmp = countryData.compare || 0;
        const pct = cmp > 0 ? ((cur - cmp) / cmp * 100) : (cur > 0 ? 100 : 0);
        quarterlyRows.push({
          label: json.currentPeriod.label,
          visitors: cur,
          changePct: pct,
          isCurrent: true,
        });
        quarterlyRows.push({
          label: json.currentPeriod.compareLabel,
          visitors: cmp,
          changePct: null, // no previous comparison available
          isCurrent: false,
        });
      }

      const isKa = I18n.getLocale() === 'ka';
      tourismHeader.innerHTML = `<h3 class="stat-report__title">${escapeHtml(selectedCountry.displayLabel)} - ${isKa ? 'საერთაშორისო ვიზიტორები' : 'International Visitors'}</h3>`;

      renderTourismTable(quarterlyRows, annualRows, isKa);
      renderTourismChart(annualRows, json.currentPeriod && countryData.current !== null ? {
        label: json.currentPeriod.label,
        visitors: countryData.current || 0,
      } : null, isKa);

      pdfState.tourism = {
        hasData: true,
        quarterlyRows,
        annualRows,
      };

    } catch (err) {
      console.error('Tourism error:', err);
      tourismTableEl.innerHTML = `<div class="msg msg-error">${escapeHtml(err.message)}</div>`;
      pdfState.tourism = { hasData: false };
    } finally {
      tourismLoading.classList.add('hidden');
      exportPdfBtn.disabled = false;
    }
  }

  function renderTourismTable(quarterlyRows, annualRows, isKa) {
    // Table order: newest first. quarterly rows on top, then annual reversed (latest year first).
    const rows = [...quarterlyRows, ...[...annualRows].reverse()];

    const hPeriod = isKa ? 'პერიოდი' : 'Period';
    const hValue = isKa ? 'ვიზიტორები' : 'Visitors';
    const hChange = isKa ? 'ცვლილება, %' : 'Change, %';

    let html = `<table class="stat-table">
      <thead>
        <tr>
          <th>${hPeriod}</th>
          <th class="stat-col-value">${hValue}</th>
          <th class="stat-col-change">${hChange}</th>
        </tr>
      </thead>
      <tbody>`;

    for (const r of rows) {
      let changeCell = '';
      if (r.changePct === null || r.changePct === undefined) {
        changeCell = '<td class="stat-col-change">—</td>';
      } else {
        const changeClass = r.changePct > 0 ? 'stat-positive' : (r.changePct < 0 ? 'stat-negative' : '');
        const sign = r.changePct > 0 ? '+' : '';
        changeCell = `<td class="stat-col-change ${changeClass}">${sign}${formatChangePct(r.changePct)}</td>`;
      }
      html += `
        <tr>
          <td>${escapeHtml(r.label)}</td>
          <td class="stat-col-value">${r.visitors.toLocaleString()}</td>
          ${changeCell}
        </tr>`;
    }

    html += '</tbody></table>';
    tourismTableEl.innerHTML = html;
  }

  function renderTourismChart(annualRows, currentPeriod, isKa) {
    tourismChartHeader.innerHTML = `<h3 class="stat-report__title">${isKa ? 'საერთაშორისო ვიზიტორები' : 'International Visitors'}</h3>`;

    // Chart order: annual years ascending, then current period as last bar.
    const labels = annualRows.map(r => r.label);
    const values = annualRows.map(r => r.visitors);
    const colors = annualRows.map(() => '#3b82f6');

    if (currentPeriod) {
      labels.push(currentPeriod.label);
      values.push(currentPeriod.visitors);
      colors.push('#60a5fa'); // lighter blue for partial period
    }

    tourismChartInstance = new Chart(tourismChartCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        layout: { padding: { top: 24 } },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
          datalabels: {
            anchor: 'end',
            align: 'end',
            font: { size: 11, weight: '600' },
            color: '#374151',
            formatter: (v) => v.toLocaleString(),
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { font: { size: 11 } },
          },
          y: {
            display: false,
            grid: { display: false },
            beginAtZero: true,
          },
        },
      },
      plugins: [ChartDataLabels],
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── INVESTMENTS TAB ──────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════

  async function generateInvestments() {
    if (!selectedCountry) return;

    investmentsLoading.classList.remove('hidden');
    fdiTable.innerHTML = '';
    fdiHeader.innerHTML = '';
    fdiChartHeader.innerHTML = '';
    if (fdiChartInstance) { fdiChartInstance.destroy(); fdiChartInstance = null; }
    const existingFdi = Chart.getChart(fdiChartCanvas);
    if (existingFdi) existingFdi.destroy();

    try {
      const res = await fetch(`${API_BASE}/api/statistics/fdi`);
      const json = await res.json();
      if (!json.success) throw new Error('FDI data fetch failed');

      const countryCode = selectedCountry.value;
      const countryData = json.countries[countryCode];
      const allYears = json.years; // e.g. [1996, 1997, ..., 2025]

      if (!countryData) {
        fdiTable.innerHTML = `<div class="empty-state"><p>${I18n.getLocale() === 'ka' ? 'მონაცემები ვერ მოიძებნა' : 'No data found'}</p></div>`;
        pdfState.investments = { hasData: false };
        investmentsLoading.classList.add('hidden');
        return;
      }

      // Find the latest year that has data
      const latestYear = allYears[allYears.length - 1];

      // Display last 5 years (or from latestYear-4 to latestYear)
      const displayYears = [];
      for (let y = latestYear - 4; y <= latestYear; y++) {
        if (allYears.includes(y)) displayYears.push(y);
      }

      // Build table data: year, value (mln USD), change %
      const tableData = displayYears.map(y => {
        const val = (countryData[y] || 0) / 1000; // Thsd → Mln
        const prev = (countryData[y - 1] || 0) / 1000;
        return { year: y, valueMln: val, prevMln: prev };
      });

      const isKa = I18n.getLocale() === 'ka';
      fdiHeader.innerHTML = `<h3 class="stat-report__title">${escapeHtml(selectedCountry.displayLabel)} - ${isKa ? 'პირდაპირი უცხოური ინვესტიციები' : 'Foreign Direct Investment'}</h3>`;

      renderFdiTable(tableData, isKa);
      renderFdiChart(tableData, isKa);

      pdfState.investments = {
        hasData: true,
        tableData,
      };

    } catch (err) {
      console.error('Investments error:', err);
      fdiTable.innerHTML = `<div class="msg msg-error">${escapeHtml(err.message)}</div>`;
      pdfState.investments = { hasData: false };
    } finally {
      investmentsLoading.classList.add('hidden');
      exportPdfBtn.disabled = false;
    }
  }

  function renderFdiTable(data, isKa) {
    data = [...data].reverse();
    const hYear = isKa ? 'წელი' : 'Year';
    const hValue = isKa ? 'მოცულობა, მლნ. $' : 'Volume, mln $';
    const hChange = isKa ? 'ცვლილება, %' : 'Change, %';

    let html = `<table class="stat-table">
      <thead>
        <tr>
          <th>${hYear}</th>
          <th class="stat-col-value">${hValue}</th>
          <th class="stat-col-change">${hChange}</th>
        </tr>
      </thead>
      <tbody>`;

    for (const r of data) {
      const pct = r.prevMln > 0
        ? ((r.valueMln - r.prevMln) / Math.abs(r.prevMln) * 100)
        : (r.valueMln > 0 ? 100 : 0);
      const changeClass = pct > 0 ? 'stat-positive' : (pct < 0 ? 'stat-negative' : '');
      const sign = pct > 0 ? '+' : '';
      html += `
        <tr>
          <td>${r.year}</td>
          <td class="stat-col-value">${formatMln(Math.abs(r.valueMln))}</td>
          <td class="stat-col-change ${changeClass}">${sign}${formatChangePct(pct)}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    fdiTable.innerHTML = html;
  }

  function renderFdiChart(data, isKa) {
    fdiChartHeader.innerHTML = `<h3 class="stat-report__title">${isKa ? 'პირდაპირი უცხოური ინვესტიციები, მლნ. $' : 'FDI, mln $'}</h3>`;

    const labels = data.map(d => String(d.year));
    const values = data.map(d => d.valueMln);

    fdiChartInstance = new Chart(fdiChartCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: '#3b82f6',
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        layout: { padding: { top: 24 } },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true },
          datalabels: {
            anchor: 'end',
            align: 'end',
            font: { size: 11, weight: '600' },
            color: '#374151',
            formatter: (v) => v.toFixed(2),
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { font: { size: 11 } },
          },
          y: {
            display: false,
            grid: { display: false },
            beginAtZero: true,
          },
        },
      },
      plugins: [ChartDataLabels],
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── PDF EXPORT ─────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════

  const exportPdfMenu = document.getElementById('exportPdfMenu');

  // Toggle the language menu when PDF button is clicked
  exportPdfBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (exportPdfBtn.disabled) return;
    exportPdfMenu.classList.toggle('hidden');
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.stat-pdf-menu-wrap')) {
      exportPdfMenu.classList.add('hidden');
    }
  });

  // Language item click → trigger export
  exportPdfMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.stat-pdf-menu__item');
    if (!item) return;
    const pdfLang = item.dataset.lang;
    exportPdfMenu.classList.add('hidden');
    exportPdf(pdfLang);
  });

  // Capture a Chart.js canvas as a PNG data URL, using a larger render size
  // so the embedded image stays sharp when scaled down by pdfmake.
  function snapshotChart(chartInstance, width = 900, height = 420) {
    if (!chartInstance || !chartInstance.canvas) return null;
    // Force a resize so the canvas reflects current container dims
    try {
      chartInstance.resize(width, height);
    } catch (_) { /* ignore — resize may fail if container is 0-size */ }
    try {
      return chartInstance.toBase64Image('image/png', 1.0);
    } catch (err) {
      console.warn('Chart snapshot failed:', err);
      return null;
    }
  }

  async function exportPdf(pdfLang) {
    if (typeof pdfMake === 'undefined' || typeof StatisticsPdf === 'undefined') {
      alert('PDF library not loaded. Please refresh the page.');
      return;
    }
    if (!pdfState.trade || !pdfState.country) {
      alert(I18n.getLocale() === 'ka' ? 'ჯერ დააგენერირეთ მონაცემები' : 'Please generate data first.');
      return;
    }

    const origBtnText = exportPdfBtn.textContent;
    exportPdfBtn.disabled = true;
    exportPdfBtn.textContent = '...';

    // Temporarily make all three tabs laid-out off-screen so Chart.js
    // resizes them to real dimensions before we snapshot.
    document.body.classList.add('stat-exporting');
    // Wait two animation frames so layout/resize settle.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      // Force all known charts to resize and snapshot to PNG.
      // Tourism and FDI now span full page width in the PDF, so render
      // their source canvases at larger dimensions for a crisper image.
      const charts = {
        turnover: snapshotChart(turnoverChartInstance),
        dynamics: snapshotChart(dynamicsChartInstance),
        tourism: snapshotChart(tourismChartInstance, 1200, 360),
        fdi: snapshotChart(fdiChartInstance, 1200, 360),
      };

      await StatisticsPdf.build(pdfState, {
        lang: pdfLang || 'en',
        country: pdfState.country.displayLabel,
        charts,
      });
    } catch (err) {
      console.error('PDF export error:', err);
      alert('Failed to export PDF: ' + (err.message || err));
    } finally {
      document.body.classList.remove('stat-exporting');
      // Restore chart sizes to fit their actual visible containers
      [turnoverChartInstance, dynamicsChartInstance, tourismChartInstance, fdiChartInstance]
        .forEach(c => { if (c) { try { c.resize(); } catch (_) {} } });
      exportPdfBtn.disabled = false;
      exportPdfBtn.textContent = origBtnText;
    }
  }
})();
