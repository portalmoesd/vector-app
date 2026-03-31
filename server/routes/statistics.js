/**
 * Statistics proxy — relays requests to ex-trade-api.geostat.ge
 * and provides parsed FDI data from geostat.ge XLSX files.
 */
const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();

const GEOSTAT_BASE = 'https://ex-trade-api.geostat.ge/api/trade';

// ── Helper: proxy fetch with timeout ────────────────────────────────────────

async function geostatFetch(path, options = {}) {
  const url = `${GEOSTAT_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'VectorPortal/1.0',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Geostat API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── GET /api/statistics/classificatory ──────────────────────────────────────
// Returns countries, trade types, years, months, HS codes, etc.

let classCache = { en: null, ka: null, ts: 0 };
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

router.get('/classificatory', async (req, res) => {
  try {
    const lang = req.query.lang === 'ka' ? 'ka' : 'en';

    if (classCache[lang] && Date.now() - classCache.ts < CACHE_TTL) {
      return res.json(classCache[lang]);
    }

    const data = await geostatFetch(`/classificatory?lang=${lang}`);
    classCache[lang] = data;
    classCache.ts = Date.now();
    res.json(data);
  } catch (err) {
    console.error('Statistics classificatory error:', err.message);
    res.status(502).json({ error: 'Failed to fetch classificatory data from Geostat' });
  }
});

// ── POST /api/statistics/trade-data ─────────────────────────────────────────
// Proxies to /get_data with pagination

router.post('/trade-data', async (req, res) => {
  try {
    const data = await geostatFetch('/get_data', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (err) {
    console.error('Statistics trade-data error:', err.message);
    res.status(502).json({ error: 'Failed to fetch trade data from Geostat' });
  }
});

// ── POST /api/statistics/export-report ──────────────────────────────────────
// Fetches ALL pages of data for a given filter set (for report generation).
// Returns the complete dataset without pagination.

router.post('/export-report', async (req, res) => {
  try {
    const filters = { ...req.body };
    const allData = [];
    let page = 1;
    const pageSize = 200;
    let total = Infinity;

    while (allData.length < total && page < 100) {
      const result = await geostatFetch('/get_data', {
        method: 'POST',
        body: JSON.stringify({ ...filters, page, pageSize }),
      });

      if (!result.success) {
        throw new Error('Geostat API returned success=false');
      }

      total = result.total || 0;
      if (Array.isArray(result.data)) {
        allData.push(...result.data);
      }

      // Store metadata from first page
      if (page === 1) {
        res._meta = {
          units: result.units,
          type: result.type,
          headers: result.headers,
          missing: result.missing,
        };
      }

      if (!result.data || result.data.length === 0) break;
      page++;
    }

    res.json({
      success: true,
      data: allData,
      total: allData.length,
      ...(res._meta || {}),
    });
  } catch (err) {
    console.error('Statistics export-report error:', err.message);
    res.status(502).json({ error: 'Failed to fetch full report from Geostat' });
  }
});

// ── GET /api/statistics/fdi ──────────────────────────────────────────────
// Parses FDI by countries XLSX. Tries to download fresh from geostat.ge,
// falls back to local bundled copy. Cached for 24 hours (updates quarterly).

const FDI_URL = 'https://www.geostat.ge/media/77508/FDI_Geo_countries.xlsx';
const FDI_LOCAL = require('path').join(__dirname, '../data/FDI_Geo_countries.xlsx');
let fdiCache = { data: null, ts: 0 };
const FDI_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function parseFdiWorkbook(wb) {
  const ws = wb.Sheets['FDI (annual)'];
  if (!ws) throw new Error('Sheet "FDI (annual)" not found');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const headerRow = rows[3];
  if (!headerRow) throw new Error('Header row not found');

  const years = [];
  for (let c = 2; c < headerRow.length; c++) {
    const raw = String(headerRow[c] || '').replace('*', '').trim();
    const yr = parseInt(raw, 10);
    if (yr >= 1996 && yr <= 2100) {
      years.push({ col: c, year: yr });
    }
  }

  const countries = {};
  for (let r = 4; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const code = parseInt(row[0], 10);
    if (!code || isNaN(code)) continue;

    const values = {};
    for (const { col, year } of years) {
      const val = row[col];
      if (val === null || val === undefined || val === '-' || val === '') {
        values[year] = 0;
      } else {
        const num = parseFloat(val);
        values[year] = isNaN(num) ? 0 : num; // in Thsd. USD
      }
    }
    countries[code] = values;
  }

  return { success: true, years: years.map(y => y.year), countries };
}

router.get('/fdi', async (req, res) => {
  try {
    if (fdiCache.data && Date.now() - fdiCache.ts < FDI_CACHE_TTL) {
      return res.json(fdiCache.data);
    }

    let wb;
    try {
      // Try downloading fresh copy
      const xlsxRes = await fetch(FDI_URL, {
        headers: { 'User-Agent': 'VectorPortal/1.0' },
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      });
      if (!xlsxRes.ok) throw new Error(`HTTP ${xlsxRes.status}`);
      const buffer = Buffer.from(await xlsxRes.arrayBuffer());
      wb = XLSX.read(buffer, { type: 'buffer' });

      // Save fresh copy locally for future fallback
      require('fs').writeFileSync(FDI_LOCAL, buffer);
      console.log('FDI data refreshed from geostat.ge');
    } catch (dlErr) {
      // Fall back to local file
      console.log('FDI download failed, using local copy:', dlErr.message);
      wb = XLSX.readFile(FDI_LOCAL);
    }

    const result = parseFdiWorkbook(wb);
    fdiCache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('FDI data error:', err.message);
    res.status(502).json({ error: 'Failed to load FDI data' });
  }
});

// ── GET /api/statistics/tourism ─────────────────────────────────────────
// Parses GNTA international visitor data XLSX.
// Dynamically discovers year columns from the summary sheet.
// Cached 24h, falls back to local copy.

const TOURISM_URL = 'https://api.gnta.ge/api/v1/web/media/download/10068';
const TOURISM_LOCAL = require('path').join(__dirname, '../data/gnta-visitors-historical.xlsx');
let tourismCache = { data: null, ts: 0 };
const TOURISM_CACHE_TTL = 24 * 60 * 60 * 1000;

function parseTourismWorkbook(wb) {
  // Find the summary sheet — name contains a year range like "2011-2025"
  let ws = null;
  for (const name of wb.SheetNames) {
    if (/\d{4}.*-.*\d{4}/.test(name)) {
      ws = wb.Sheets[name];
      break;
    }
  }
  if (!ws) throw new Error('Summary sheet not found');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Row 0 is the header: country name column + year columns
  const headerRow = rows[0];
  if (!headerRow) throw new Error('Header row not found');

  // Discover year columns dynamically
  const years = [];
  for (let c = 1; c < headerRow.length; c++) {
    const raw = String(headerRow[c] || '').replace('*', '').trim();
    const yr = parseInt(raw, 10);
    if (yr >= 2000 && yr <= 2100) {
      years.push({ col: c, year: yr });
    }
  }

  // Parse country rows (skip row 0 header, rows 1-4 are totals/summaries)
  const countries = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const name = String(row[0] || '').trim();
    if (!name) continue;
    // Skip summary/separator rows
    if (name.startsWith('მათ შორის') || name.startsWith('საერთაშორისო') ||
        name.startsWith('სხვა ვიზიტ') || name.startsWith('წყარო')) continue;
    // Skip region headers (they have no year data or contain sub-totals)
    // We include them — the frontend will match by country name

    const values = {};
    let hasAnyValue = false;
    for (const { col, year } of years) {
      const val = row[col];
      if (val === null || val === undefined || val === '-' || val === '') {
        values[year] = 0;
      } else {
        const num = parseFloat(String(val).replace(/,/g, ''));
        values[year] = isNaN(num) ? 0 : Math.round(num);
        if (values[year] > 0) hasAnyValue = true;
      }
    }
    if (hasAnyValue) {
      countries[name] = values;
    }
  }

  return { success: true, years: years.map(y => y.year), countries };
}

router.get('/tourism', async (req, res) => {
  try {
    if (tourismCache.data && Date.now() - tourismCache.ts < TOURISM_CACHE_TTL) {
      return res.json(tourismCache.data);
    }

    let wb;
    try {
      const xlsxRes = await fetch(TOURISM_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!xlsxRes.ok) throw new Error(`HTTP ${xlsxRes.status}`);
      const buffer = Buffer.from(await xlsxRes.arrayBuffer());
      wb = XLSX.read(buffer, { type: 'buffer' });
      require('fs').writeFileSync(TOURISM_LOCAL, buffer);
      console.log('Tourism data refreshed from GNTA');
    } catch (dlErr) {
      console.log('Tourism download failed, using local copy:', dlErr.message);
      wb = XLSX.readFile(TOURISM_LOCAL);
    }

    const result = parseTourismWorkbook(wb);
    tourismCache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('Tourism data error:', err.message);
    res.status(502).json({ error: 'Failed to load tourism data' });
  }
});

module.exports = router;
