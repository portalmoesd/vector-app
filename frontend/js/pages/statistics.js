/**
 * Statistics Page
 * Generates "Main Export Products" report for a selected country
 * using data from ex-trade-api.geostat.ge (proxied via /api/statistics).
 */
(async function () {
  await App.init();

  const user = Api.getUser();
  if (!user) return;

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
  let selectedCountry = null;

  // ── Load classificatory data ─────────────────────────────────────────────
  const lang = I18n.getLocale() || 'en';

  try {
    const result = await fetch(`${API_BASE}/api/statistics/classificatory?lang=${lang}`);
    const json = await result.json();
    if (json.success && json.data) {
      countries = json.data.countries || [];
    }
  } catch (err) {
    console.error('Failed to load classificatory data:', err);
  }

  // ── Country search dropdown ──────────────────────────────────────────────

  function renderDropdown(filter) {
    const q = (filter || '').toLowerCase();
    const filtered = q
      ? countries.filter(c => c.label.toLowerCase().includes(q))
      : countries;
    const shown = filtered.slice(0, 50);

    if (shown.length === 0) {
      dropdown.innerHTML = '<div class="stat-dropdown__empty">No results</div>';
    } else {
      dropdown.innerHTML = shown.map(c =>
        `<div class="stat-dropdown__item${selectedCountry && selectedCountry.value === c.value ? ' selected' : ''}" data-value="${c.value}">${escapeHtml(c.label)}</div>`
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
      searchInput.value = selectedCountry.label;
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
  // The API classificatory data contains years and months.
  // We detect the latest year+month combo from the data response metadata.

  function detectLatestPeriod(classData) {
    const years = (classData.year || []).map(y => y.value).sort((a, b) => b - a);
    const months = (classData.month || []).map(m => m.value).sort((a, b) => b - a);
    // Latest year is first, latest month is first
    // We need to figure out the actual latest available month.
    // The classData also has 'selected' with year and month.
    if (classData.selected) {
      return { year: classData.selected.year, month: classData.selected.month };
    }
    return { year: years[0], month: months[0] };
  }

  // ── Generate report ──────────────────────────────────────────────────────

  generateBtn.addEventListener('click', generateReport);

  async function generateReport() {
    if (!selectedCountry) return;

    reportArea.classList.remove('hidden');
    reportLoading.classList.remove('hidden');
    reportTable.innerHTML = '';

    try {
      // Re-fetch classificatory to get latest period info
      const classRes = await fetch(`${API_BASE}/api/statistics/classificatory?lang=${lang}`);
      const classJson = await classRes.json();
      if (!classJson.success) throw new Error('Failed to load metadata');

      const { year: latestYear, month: latestMonth } = detectLatestPeriod(classJson.data);

      // Build month list: 1..latestMonth (YTD)
      const monthsYTD = [];
      for (let m = 1; m <= latestMonth; m++) monthsYTD.push(m);

      const monthNames = (classJson.data.month || []);
      const firstMonthName = monthNames.find(m => m.value === 1)?.label || 'Jan';
      const lastMonthName = monthNames.find(m => m.value === latestMonth)?.label || `Month ${latestMonth}`;
      const periodLabel = monthsYTD.length === 1
        ? lastMonthName
        : `${firstMonthName}-${lastMonthName}`;

      const countryId = selectedCountry.value;

      // Fetch export data (tradeFlow=10) for current year and previous year
      // Also fetch re-export data (tradeFlow=13) for same periods
      const [exportCurrent, exportPrev, reexportCurrent] = await Promise.all([
        fetchAllTradeData(10, [latestYear], monthsYTD, countryId),
        fetchAllTradeData(10, [latestYear - 1], monthsYTD, countryId),
        fetchAllTradeData(13, [latestYear], monthsYTD, countryId),
      ]);

      // Build product map from export data
      const products = buildProductTable(
        exportCurrent, exportPrev, reexportCurrent,
        latestYear, periodLabel
      );

      // Render
      renderReportHeader(periodLabel, latestYear);
      renderTable(products, periodLabel, latestYear);

    } catch (err) {
      console.error('Report generation error:', err);
      reportTable.innerHTML = `<div class="msg msg-error">Failed to generate report: ${escapeHtml(err.message)}</div>`;
    } finally {
      reportLoading.classList.add('hidden');
    }
  }

  // ── Fetch all trade data (all pages) ─────────────────────────────────────

  async function fetchAllTradeData(tradeFlow, years, months, countryId) {
    const filters = {
      tradeFlow,
      measurementUnits: [1], // Thsd. USD
      years,
      months,
      countries: [countryId],
      hs4: ['all'],
      locale: lang,
      sum: true, // sum across selected months for YTD
    };

    const res = await fetch(`${API_BASE}/api/statistics/export-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters),
    });
    const json = await res.json();
    if (!json.success) throw new Error('Trade data fetch failed');
    return json.data || [];
  }

  // ── Build product table data ─────────────────────────────────────────────

  function buildProductTable(exportCurrent, exportPrev, reexportCurrent, year, periodLabel) {
    // Parse export current year: HS4 → value in Thsd. USD
    const currentMap = {};
    for (const row of exportCurrent) {
      if (row.isGroupSummary) continue;
      if (!row.hs4) continue;
      const key = row.hs4;
      // Find the value field — it's named like usd1000_{year}_{month} or could be a sum field
      const val = extractValue(row);
      if (val > 0) {
        currentMap[key] = {
          hs4: row.hs4,
          name: cleanHs4Name(row.hs4_name || `HS ${row.hs4}`),
          valueThdUsd: (currentMap[key]?.valueThdUsd || 0) + val,
        };
      }
    }

    // Parse export previous year
    const prevMap = {};
    for (const row of exportPrev) {
      if (row.isGroupSummary) continue;
      if (!row.hs4) continue;
      const val = extractValue(row);
      if (val > 0) {
        prevMap[row.hs4] = (prevMap[row.hs4] || 0) + val;
      }
    }

    // Parse re-export current year
    const reexportMap = {};
    for (const row of reexportCurrent) {
      if (row.isGroupSummary) continue;
      if (!row.hs4) continue;
      const val = extractValue(row);
      if (val > 0) {
        reexportMap[row.hs4] = (reexportMap[row.hs4] || 0) + val;
      }
    }

    // Build sorted product list (by value descending)
    let products = Object.values(currentMap).sort((a, b) => b.valueThdUsd - a.valueThdUsd);

    // Convert to millions
    products = products.map(p => ({
      ...p,
      valueMln: p.valueThdUsd / 1000,
      prevValueMln: (prevMap[p.hs4] || 0) / 1000,
      reexportMln: (reexportMap[p.hs4] || 0) / 1000,
    }));

    // Filter: display max 15, exclude those < 0.01 mln USD (unless fewer than 5)
    const significant = products.filter(p => p.valueMln >= 0.01);
    let result;
    if (significant.length >= 5) {
      result = significant.slice(0, 15);
    } else {
      // Show at least the top 5 even if below 0.01
      result = products.slice(0, Math.max(5, significant.length));
    }

    // Calculate change % and re-export share %
    result = result.map((p, i) => ({
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

    return result;
  }

  // ── Extract numeric value from a data row ────────────────────────────────
  // The API returns values in fields like "usd1000_2026_1", "usd1000_2025_2" etc.

  function extractValue(row) {
    for (const key of Object.keys(row)) {
      if (key.startsWith('usd1000_')) {
        const v = parseFloat(row[key]);
        if (!isNaN(v)) return v;
      }
    }
    return 0;
  }

  // ── Clean HS4 name (remove code prefix like "8703 ") ─────────────────────

  function cleanHs4Name(name) {
    // The name comes as "8703 Light vehicles..." — remove the leading code
    return name.replace(/^\d{2,6}\s+/, '');
  }

  // ── Render report header ─────────────────────────────────────────────────

  function renderReportHeader(periodLabel, year) {
    const t = I18n.getLocale() === 'ka'
      ? `${selectedCountry.label} - ძირითადი საექსპორტო პროდუქცია, ${periodLabel} ${year}`
      : `${selectedCountry.label} - Main Export Products, ${periodLabel} ${year}`;
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

    // Calculate total for all displayed products
    const totalValue = products.reduce((s, p) => s + p.valueMln, 0);

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

    // Total row
    html += `
        <tr class="stat-total-row">
          <td></td>
          <td class="stat-col-product"><strong>${isKa ? 'სულ (ნაჩვენები პროდუქცია)' : 'Total (displayed products)'}</strong></td>
          <td class="stat-col-value"><strong>${formatMln(totalValue)}</strong></td>
          <td></td>
          <td></td>
        </tr>`;

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
