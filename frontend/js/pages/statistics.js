/**
 * Statistics Page
 * Generates "Main Export Products" report for a selected country
 * using data from ex-trade-api.geostat.ge.
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
  const reportHeader = document.getElementById('reportHeader');
  const reportLoading = document.getElementById('reportLoading');
  const reportTable = document.getElementById('reportTable');

  // ── State ────────────────────────────────────────────────────────────────
  let countries = [];
  let classData = null;
  let selectedCountry = null;
  let useProxy = false; // will flip to true if direct calls fail

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
        // Strip leading numeric code from label (e.g. "792 თურქეთი" → "თურქეთი")
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
    reportTable.innerHTML = '';
    reportHeader.innerHTML = '';

    try {
      const { year: latestYear, month: latestMonth } = detectLatestPeriod(classData);

      // Build month list: 1..latestMonth (YTD)
      const monthsYTD = [];
      for (let m = 1; m <= latestMonth; m++) monthsYTD.push(m);

      const monthNames = classData.month || [];
      const firstMonthName = monthNames.find(m => m.value === 1)?.label || 'Jan';
      const lastMonthName = monthNames.find(m => m.value === latestMonth)?.label || `Month ${latestMonth}`;
      const periodLabel = monthsYTD.length === 1
        ? lastMonthName
        : `${firstMonthName}-${lastMonthName}`;

      const countryId = selectedCountry.value;

      // Fetch export (10), previous year export (10), and re-export (13) in parallel
      const [exportCurrent, exportPrev, reexportCurrent] = await Promise.all([
        fetchAllTradeData(10, [latestYear], monthsYTD, countryId),
        fetchAllTradeData(10, [latestYear - 1], monthsYTD, countryId),
        fetchAllTradeData(13, [latestYear], monthsYTD, countryId),
      ]);

      const products = buildProductTable(exportCurrent, exportPrev, reexportCurrent);

      renderReportHeader(periodLabel, latestYear);
      renderTable(products, periodLabel, latestYear);

    } catch (err) {
      console.error('Report generation error:', err);
      reportTable.innerHTML = `<div class="msg msg-error">Failed to generate report: ${escapeHtml(err.message)}</div>`;
    } finally {
      reportLoading.classList.add('hidden');
    }
  }

  // ── Fetch all trade data (paginate through all pages) ────────────────────

  async function fetchAllTradeData(tradeFlow, years, months, countryId) {
    const allData = [];
    let page = 1;
    let total = Infinity;
    const pageSize = 200;

    while (allData.length < total && page < 100) {
      const filters = {
        tradeFlow,
        measurementUnits: [1], // Thsd. USD
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

  // ── Build product table data ─────────────────────────────────────────────

  function buildProductTable(exportCurrent, exportPrev, reexportCurrent) {
    // Current year export: HS4 → value in Thsd. USD
    const currentMap = {};
    for (const row of exportCurrent) {
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

    // Previous year export
    const prevMap = {};
    for (const row of exportPrev) {
      if (row.isGroupSummary || !row.hs4) continue;
      const val = extractValue(row);
      if (val > 0) prevMap[row.hs4] = (prevMap[row.hs4] || 0) + val;
    }

    // Re-export current year
    const reexportMap = {};
    for (const row of reexportCurrent) {
      if (row.isGroupSummary || !row.hs4) continue;
      const val = extractValue(row);
      if (val > 0) reexportMap[row.hs4] = (reexportMap[row.hs4] || 0) + val;
    }

    // Sort by value descending, convert to millions
    let products = Object.values(currentMap)
      .sort((a, b) => b.valueThdUsd - a.valueThdUsd)
      .map(p => ({
        ...p,
        valueMln: p.valueThdUsd / 1000,
        prevValueMln: (prevMap[p.hs4] || 0) / 1000,
        reexportMln: (reexportMap[p.hs4] || 0) / 1000,
      }));

    // Filter: max 15, exclude < 0.01 mln (unless fewer than 5 total)
    const significant = products.filter(p => p.valueMln >= 0.01);
    let result;
    if (significant.length >= 5) {
      result = significant.slice(0, 15);
    } else {
      result = products.slice(0, Math.max(5, significant.length));
    }

    // Calculate change % and re-export share %
    return result.map((p, i) => ({
      rank: i + 1,
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

  // ── Clean HS4 name (remove leading code like "8703 ") ────────────────────

  function cleanHs4Name(name) {
    return name.replace(/^\d{2,6}\s+/, '');
  }

  // ── Render report header ─────────────────────────────────────────────────

  function renderReportHeader(periodLabel, year) {
    const t = I18n.getLocale() === 'ka'
      ? `${selectedCountry.displayLabel} - ძირითადი საექსპორტო პროდუქცია, ${periodLabel} ${year}`
      : `${selectedCountry.displayLabel} - Main Export Products, ${periodLabel} ${year}`;
    reportHeader.innerHTML = `<h3 class="stat-report__title">${escapeHtml(t)}</h3>`;
  }

  // ── Render the table ─────────────────────────────────────────────────────

  function renderTable(products, periodLabel, year) {
    if (products.length === 0) {
      reportTable.innerHTML = `<div class="empty-state"><p>${I18n.getLocale() === 'ka' ? 'მონაცემები ვერ მოიძებნა' : 'No data found'}</p></div>`;
      return;
    }

    const isKa = I18n.getLocale() === 'ka';
    const headers = {
      rank: '#',
      product: isKa ? 'პროდუქცია (HS 4-ნიშნა)' : 'Product (HS 4-digit)',
      value: isKa ? `${periodLabel} ${year}, მლნ. $` : `${periodLabel} ${year}, mln $`,
      change: isKa ? 'ცვლილება, %' : 'Change, %',
      reexport: isKa ? 'რეექსპორტის წილი, %' : 'Re-export share, %',
    };

    let html = `<table class="stat-table">
      <thead>
        <tr>
          <th class="stat-col-rank">${headers.rank}</th>
          <th class="stat-col-product">${headers.product}</th>
          <th class="stat-col-value">${headers.value}</th>
          <th class="stat-col-change">${headers.change}</th>
          <th class="stat-col-reexport">${headers.reexport}</th>
        </tr>
      </thead>
      <tbody>`;

    for (const p of products) {
      const changeClass = p.change > 0 ? 'stat-positive' : (p.change < 0 ? 'stat-negative' : '');
      const changeSign = p.change > 0 ? '+' : '';
      html += `
        <tr>
          <td class="stat-col-rank">${p.rank}</td>
          <td class="stat-col-product">${escapeHtml(p.name)}</td>
          <td class="stat-col-value">${formatMln(p.valueMln)}</td>
          <td class="stat-col-change ${changeClass}">${changeSign}${p.change.toFixed(1)}%</td>
          <td class="stat-col-reexport">${p.reexportShare.toFixed(1)}%</td>
        </tr>`;
    }

    html += '</tbody></table>';
    reportTable.innerHTML = html;
  }

  // ── Format millions ──────────────────────────────────────────────────────

  function formatMln(val) {
    if (val >= 100) return val.toFixed(1);
    if (val >= 10) return val.toFixed(2);
    if (val >= 0.01) return val.toFixed(2);
    if (val > 0) return val.toFixed(3);
    return '0.00';
  }
})();
