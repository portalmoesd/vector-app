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

  // ── State ────────────────────────────────────────────────────────────────
  let countries = [];
  let classData = null;
  let selectedCountry = null;
  let useProxy = false;
  let turnoverChartInstance = null;
  let dynamicsChartInstance = null;
  let fdiChartInstance = null;
  let activeTab = 'trade';

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
    // Hide all tab content areas
    reportArea.classList.add('hidden');
    investmentsArea.classList.add('hidden');

    // Show the active one
    if (activeTab === 'trade') reportArea.classList.remove('hidden');
    else if (activeTab === 'investments') investmentsArea.classList.remove('hidden');
  }

  document.querySelectorAll('.stat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.stat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      showActiveTab();

      // Auto-generate if country is selected but tab content is empty
      if (selectedCountry) {
        if (activeTab === 'trade' && !overviewTable.innerHTML) generateReport();
        else if (activeTab === 'investments' && !fdiTable.innerHTML) generateInvestments();
      }
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

  generateBtn.addEventListener('click', () => {
    if (activeTab === 'trade') generateReport();
    else if (activeTab === 'investments') generateInvestments();
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

    try {
      const { year: latestYear, month: latestMonth } = detectLatestPeriod(classData);

      const monthsYTD = [];
      for (let m = 1; m <= latestMonth; m++) monthsYTD.push(m);

      const monthNames = classData.month || [];
      const firstMonthName = monthNames.find(m => m.value === 1)?.label || 'Jan';
      const lastMonthName = monthNames.find(m => m.value === latestMonth)?.label || `Month ${latestMonth}`;
      const periodLabel = monthsYTD.length === 1
        ? lastMonthName
        : `${firstMonthName}-${lastMonthName}`;

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
    const hValue = isKa ? `${periodLabel} ${year}, მლნ. $` : `${periodLabel} ${year}, mln $`;
    const hChange = isKa ? 'ცვლილება, %' : 'Change, %';
    const hDiff = isKa ? 'სხვაობა, მლნ. $' : 'Difference, mln $';

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
          <td class="stat-col-change ${changeClass}">${changeSign}${p.changePct.toFixed(1)}%</td>
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
    const hValue = isKa ? `${periodLabel} ${year}, მლნ. $` : `${periodLabel} ${year}, mln $`;
    const hChange = isKa ? 'ცვლილება, %' : 'Change, %';
    const hReexport = isKa ? 'რეექსპორტის წილი, %' : 'Re-export share, %';

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

    for (const p of products) {
      const changeClass = p.change > 0 ? 'stat-positive' : (p.change < 0 ? 'stat-negative' : '');
      const changeSign = p.change > 0 ? '+' : '';
      html += `
        <tr>
          <td class="stat-col-product">${escapeHtml(p.name)}</td>
          <td class="stat-col-value">${formatMln(p.valueMln)}</td>
          <td class="stat-col-change ${changeClass}">${changeSign}${p.change.toFixed(1)}%</td>
          ${showReexport ? `<td class="stat-col-reexport">${p.reexportShare.toFixed(1)}%</td>` : ''}
        </tr>`;
    }

    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // ── Format millions (for product tables) ─────────────────────────────────

  function formatMln(val) {
    if (val >= 100) return val.toFixed(1);
    if (val >= 10) return val.toFixed(2);
    if (val >= 0.01) return val.toFixed(2);
    if (val > 0) return val.toFixed(3);
    return '0.00';
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── INVESTMENTS TAB ──────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════

  async function generateInvestments() {
    if (!selectedCountry) return;

    showActiveTab();
    investmentsLoading.classList.remove('hidden');
    fdiTable.innerHTML = '';
    fdiHeader.innerHTML = '';
    fdiChartHeader.innerHTML = '';
    if (fdiChartInstance) { fdiChartInstance.destroy(); fdiChartInstance = null; }

    try {
      const res = await fetch(`${API_BASE}/api/statistics/fdi`);
      const json = await res.json();
      if (!json.success) throw new Error('FDI data fetch failed');

      const countryCode = selectedCountry.value;
      const countryData = json.countries[countryCode];
      const allYears = json.years; // e.g. [1996, 1997, ..., 2025]

      if (!countryData) {
        fdiTable.innerHTML = `<div class="empty-state"><p>${I18n.getLocale() === 'ka' ? 'მონაცემები ვერ მოიძებნა' : 'No data found'}</p></div>`;
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

    } catch (err) {
      console.error('Investments error:', err);
      fdiTable.innerHTML = `<div class="msg msg-error">${escapeHtml(err.message)}</div>`;
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

  exportPdfBtn.addEventListener('click', exportPdf);

  async function exportPdf() {
    if (!selectedCountry) return;
    if (typeof html2pdf === 'undefined') {
      alert('PDF library not loaded. Please refresh the page.');
      return;
    }

    exportPdfBtn.disabled = true;
    exportPdfBtn.textContent = '...';

    try {
      const sourceArea = activeTab === 'investments' ? investmentsArea : reportArea;
      if (!sourceArea || sourceArea.classList.contains('hidden')) return;

      // Build PDF container — sized to fit A4 portrait with margins
      const container = document.createElement('div');
      container.style.cssText = 'font-family: FiraGO, Noto Sans Georgian, Arial, sans-serif; color: #1a1a1a; font-size: 11px;';

      let isFirst = true;

      // Helper: add a section with page break (except first)
      function addSection(html, opts = {}) {
        const div = document.createElement('div');
        if (!isFirst) div.style.pageBreakBefore = 'always';
        div.innerHTML = html;
        container.appendChild(div);
        isFirst = false;
        return div;
      }

      // Helper: convert canvas to img HTML
      function canvasToImgHtml(canvas, maxWidth) {
        if (!canvas) return '';
        const src = canvas.toDataURL('image/png', 1.0);
        return `<img src="${src}" style="width:${maxWidth || '100%'}; height:auto; display:block;">`;
      }

      // Collect visible cards
      const cards = sourceArea.querySelectorAll('.card');
      const processedCharts = new Set();

      for (const card of cards) {
        if (card.style.display === 'none' || card.classList.contains('hidden')) continue;

        // Charts row — two charts side by side on one page
        if (card.closest('.stat-charts-row')) {
          const chartsRow = card.closest('.stat-charts-row');
          if (processedCharts.has(chartsRow)) continue;
          processedCharts.add(chartsRow);

          let chartsHtml = '<div style="display:flex; gap:16px;">';
          chartsRow.querySelectorAll('.stat-chart-card').forEach(cc => {
            const header = cc.querySelector('.stat-report__header');
            const canvas = cc.querySelector('canvas');
            chartsHtml += `<div style="flex:1; min-width:0;">`;
            if (header) chartsHtml += header.innerHTML;
            chartsHtml += canvasToImgHtml(canvas, '100%');
            chartsHtml += '</div>';
          });
          chartsHtml += '</div>';
          addSection(chartsHtml);
          continue;
        }

        // Investments row — table + chart side by side
        const investRow = card.querySelector('.stat-investments-row');
        if (investRow) {
          let html = '<div style="display:flex; gap:20px;">';
          const tableWrap = investRow.querySelector('.stat-investments-table-wrap');
          if (tableWrap) html += `<div style="flex:1;">${tableWrap.innerHTML}</div>`;
          const chartWrap = investRow.querySelector('.stat-investments-chart-wrap');
          if (chartWrap) {
            const header = chartWrap.querySelector('.stat-report__header');
            const canvas = chartWrap.querySelector('canvas');
            html += `<div style="flex:1;">${header ? header.innerHTML : ''}${canvasToImgHtml(canvas, '100%')}</div>`;
          }
          html += '</div>';
          addSection(html);
          continue;
        }

        // Regular card — table with header. Each gets its own page.
        addSection(card.innerHTML);
      }

      // Style all elements in the PDF container
      container.querySelectorAll('h3').forEach(h => {
        h.style.cssText = 'font-size: 13px; font-weight: 700; margin: 0 0 8px 0; color: #1a1a1a;';
      });
      container.querySelectorAll('table').forEach(t => {
        t.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 10px; table-layout: auto;';
      });
      container.querySelectorAll('th').forEach(th => {
        th.style.cssText = 'padding: 4px 6px; text-align: left; font-weight: 600; font-size: 9px; border-bottom: 2px solid #ccc; color: #555; white-space: nowrap;';
      });
      container.querySelectorAll('td').forEach(td => {
        td.style.cssText = 'padding: 3px 6px; border-bottom: 1px solid #eee; font-size: 10px;';
      });
      container.querySelectorAll('.stat-col-value, .stat-col-change, .stat-col-reexport, .stat-col-diff').forEach(el => {
        el.style.textAlign = 'right';
        el.style.whiteSpace = 'nowrap';
      });
      container.querySelectorAll('.stat-col-overview').forEach(el => {
        el.style.textAlign = 'center';
      });
      container.querySelectorAll('.stat-positive').forEach(el => { el.style.color = '#16a34a'; });
      container.querySelectorAll('.stat-negative').forEach(el => { el.style.color = '#dc2626'; });

      const countryName = selectedCountry.displayLabel.replace(/[^a-zA-Z0-9\u10A0-\u10FF]/g, '_');
      const filename = `${countryName}_${activeTab}_report.pdf`;

      await html2pdf().from(container).set({
        margin: [10, 10, 10, 10],
        filename,
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { format: 'a4', orientation: 'portrait' },
        image: { type: 'jpeg', quality: 0.95 },
      }).save();

    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      exportPdfBtn.disabled = false;
      exportPdfBtn.textContent = 'PDF';
    }
  }
})();
