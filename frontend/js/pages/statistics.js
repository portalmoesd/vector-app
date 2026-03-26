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
  const reportArea = document.getElementById('reportArea');
  const reportLoading = document.getElementById('reportLoading');
  const overviewHeader = document.getElementById('overviewHeader');
  const overviewTable = document.getElementById('overviewTable');
  const exportHeader = document.getElementById('exportHeader');
  const exportTable = document.getElementById('exportTable');
  const importHeader = document.getElementById('importHeader');
  const importTable = document.getElementById('importTable');

  // ── State ────────────────────────────────────────────────────────────────
  let countries = [];
  let classData = null;
  let selectedCountry = null;
  let useProxy = false;

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

  generateBtn.addEventListener('click', generateReport);

  async function generateReport() {
    if (!selectedCountry || !classData) return;

    reportArea.classList.remove('hidden');
    reportLoading.classList.remove('hidden');
    overviewTable.innerHTML = '';
    overviewHeader.innerHTML = '';
    exportTable.innerHTML = '';
    exportHeader.innerHTML = '';
    importTable.innerHTML = '';
    importHeader.innerHTML = '';

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

      // Fetch all data in parallel
      const [
        // Overview: Export & Import totals (no HS breakdown)
        expFullCurr, expFullPrev, expMonthCurr, expMonthPrev,
        impFullCurr, impFullPrev, impMonthCurr, impMonthPrev,
        // Product tables: with HS breakdown
        expHsCurrent, expHsPrev, reexHsCurrent,
        impHsCurrent, impHsPrev,
      ] = await Promise.all([
        // Overview totals — full year current & previous, latest month current & previous
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
      ]);

      // ── 1. Trade overview table ──────────────────────────────────────
      const overview = buildOverviewData(
        { expFull: expFullCurr, expFullPrev: expFullPrev, impFull: impFullCurr, impFullPrev: impFullPrev },
        { expMonth: expMonthCurr, expMonthPrev: expMonthPrev, impMonth: impMonthCurr, impMonthPrev: impMonthPrev },
      );
      renderOverview(overview, prevYear, prevPrevYear, latestYear, latestMonth, periodLabel, monthNames);

      // ── 2. Export products table ─────────────────────────────────────
      const exportProducts = buildProductList(expHsCurrent, expHsPrev, reexHsCurrent);
      renderSectionHeader(exportHeader, 'export', periodLabel, latestYear);
      renderProductTable(exportTable, exportProducts, periodLabel, latestYear, true);

      // ── 3. Import products table ─────────────────────────────────────
      const importProducts = buildProductList(impHsCurrent, impHsPrev, null);
      renderSectionHeader(importHeader, 'import', periodLabel, latestYear);
      renderProductTable(importTable, importProducts, periodLabel, latestYear, false);

    } catch (err) {
      console.error('Report generation error:', err);
      overviewTable.innerHTML = `<div class="msg msg-error">Failed to generate report: ${escapeHtml(err.message)}</div>`;
    } finally {
      reportLoading.classList.add('hidden');
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

    function formatCell(value, prevValue, isBalance) {
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
          <td class="stat-col-overview">${formatCell(fullVal, fullPrev, isBalance)}</td>
          <td class="stat-col-overview">${formatCell(monthVal, monthPrev, isBalance)}</td>
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

  function buildProductList(currentData, prevData, reexportData) {
    const currentMap = {};
    for (const row of currentData) {
      if (row.isGroupSummary || !row.hs4) continue;
      const val = extractValue(row);
      if (val > 0) {
        if (!currentMap[row.hs4]) {
          currentMap[row.hs4] = {
            hs4: row.hs4,
            name: cleanHs4Name(row.hs4_name || `HS ${row.hs4}`),
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

  function cleanHs4Name(name) {
    return name.replace(/^\d{2,6}\s+/, '');
  }

  // ── Render section header ────────────────────────────────────────────────

  function renderSectionHeader(el, type, periodLabel, year) {
    const isKa = I18n.getLocale() === 'ka';
    const label = type === 'export'
      ? (isKa ? 'ძირითადი საექსპორტო პროდუქცია' : 'Main Export Products')
      : (isKa ? 'ძირითადი საიმპორტო პროდუქცია' : 'Main Import Products');
    const t = `${selectedCountry.displayLabel} - ${label}, ${periodLabel} ${year}`;
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
})();
