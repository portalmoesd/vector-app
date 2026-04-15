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
// Parses GNTA international visitor data XLSX from two sources:
// - Historical file (ID 10068): annual data 2011-2025 (stable ID)
// - Latest quarterly file: auto-discovered by scanning recent media IDs
// Merged result contains both annual + current period (e.g. 2026 Q1).

const path = require('path');
const fs = require('fs');

const TOURISM_HISTORICAL_URL = 'https://api.gnta.ge/api/v1/web/media/download/10068';
const TOURISM_HISTORICAL_LOCAL = path.join(__dirname, '../data/gnta-visitors-historical.xlsx');
const TOURISM_QUARTERLY_LOCAL = path.join(__dirname, '../data/gnta-visitors-quarterly.xlsx');
const TOURISM_QUARTERLY_ID_FILE = path.join(__dirname, '../data/gnta-quarterly-id.txt');
const TOURISM_MEDIA_BASE = 'https://api.gnta.ge/api/v1/web/media/download';

// Starting baseline for scanning when no cached ID exists
const TOURISM_QUARTERLY_BASE_ID = 10290;
const TOURISM_QUARTERLY_SCAN_RANGE = 200;

let tourismCache = { data: null, ts: 0 };
const TOURISM_CACHE_TTL = 24 * 60 * 60 * 1000;

// Parse the historical file — country names in col A, years 2011-YYYY in cols B+
function parseHistoricalWorkbook(wb) {
  // Find the summary sheet (name matches year-range pattern)
  let ws = null;
  for (const name of wb.SheetNames) {
    if (/\d{4}.*-.*\d{4}/.test(name)) {
      ws = wb.Sheets[name];
      break;
    }
  }
  if (!ws) throw new Error('Historical summary sheet not found');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const headerRow = rows[0];
  if (!headerRow) throw new Error('Historical header row not found');

  const years = [];
  for (let c = 1; c < headerRow.length; c++) {
    const raw = String(headerRow[c] || '').replace('*', '').trim();
    const yr = parseInt(raw, 10);
    if (yr >= 2000 && yr <= 2100) years.push({ col: c, year: yr });
  }

  const countries = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const name = String(row[0] || '').trim();
    if (!name) continue;
    if (name.startsWith('მათ შორის') || name.startsWith('საერთაშორისო') ||
        name.startsWith('სხვა ვიზიტ') || name.startsWith('წყარო')) continue;

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
    if (hasAnyValue) countries[name] = values;
  }

  return { years: years.map(y => y.year), countries };
}

// Check if a workbook matches the quarterly file fingerprint.
// Returns { compareLabel, currentLabel, countries } or null if not a match.
function parseQuarterlyWorkbook(wb) {
  // Quarterly files: first sheet with country in col B, period headers in cols C/D
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length < 10) continue;
    const header = rows[0] || [];

    // Fingerprint check: col B = "ქვეყანა", col C & D = year or quarter labels
    const colB = String(header[1] || '').trim();
    const colC = String(header[2] || '').trim();
    const colD = String(header[3] || '').trim();
    if (colB !== 'ქვეყანა') continue;

    const isPeriodLabel = s => /^\d{4}(\s+[IVX]+\s+კვ)?$/.test(s);
    if (!isPeriodLabel(colC) || !isPeriodLabel(colD)) continue;

    // Matched! Extract data.
    const countries = {};
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const name = String(row[1] || '').trim();
      if (!name) continue;
      if (name.startsWith('მათ შორის') || name.startsWith('საერთაშორისო') ||
          name.startsWith('სხვა ვიზიტ') || name.startsWith('წყარო')) continue;

      const parseVal = (v) => {
        if (v === null || v === undefined || v === '-' || v === '') return 0;
        const n = parseFloat(String(v).replace(/,/g, ''));
        return isNaN(n) ? 0 : Math.round(n);
      };
      const compare = parseVal(row[2]);
      const current = parseVal(row[3]);
      if (compare > 0 || current > 0) {
        countries[name] = { compare, current };
      }
    }

    return { compareLabel: colC, currentLabel: colD, countries };
  }
  return null;
}

// Scan media IDs to find the latest quarterly XLSX.
// Returns { id, wb, parsed } for the highest-ID matching file, or null.
async function findLatestQuarterlyFile(lastKnownId) {
  const startId = lastKnownId || TOURISM_QUARTERLY_BASE_ID;
  const endId = startId + TOURISM_QUARTERLY_SCAN_RANGE;
  let bestMatch = null;

  // Scan high-to-low so we can short-circuit once we find the newest
  for (let id = endId; id >= startId; id--) {
    try {
      // HEAD to check content-type first (cheap)
      const headRes = await fetch(`${TOURISM_MEDIA_BASE}/${id}`, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!headRes.ok) continue;
      const ct = headRes.headers.get('content-type') || '';
      if (!ct.includes('spreadsheet')) continue;

      // Download and try to parse
      const getRes = await fetch(`${TOURISM_MEDIA_BASE}/${id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!getRes.ok) continue;
      const buffer = Buffer.from(await getRes.arrayBuffer());
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const parsed = parseQuarterlyWorkbook(wb);
      if (parsed && Object.keys(parsed.countries).length > 50) {
        bestMatch = { id, buffer, parsed };
        break; // highest-ID match found
      }
    } catch (_) { /* skip */ }
  }
  return bestMatch;
}

function readCachedQuarterlyId() {
  try {
    const txt = fs.readFileSync(TOURISM_QUARTERLY_ID_FILE, 'utf8').trim();
    const id = parseInt(txt, 10);
    return isNaN(id) ? null : id;
  } catch (_) { return null; }
}

function writeCachedQuarterlyId(id) {
  try { fs.writeFileSync(TOURISM_QUARTERLY_ID_FILE, String(id)); } catch (_) {}
}

router.get('/tourism', async (req, res) => {
  try {
    if (tourismCache.data && Date.now() - tourismCache.ts < TOURISM_CACHE_TTL) {
      return res.json(tourismCache.data);
    }

    // ── 1. Fetch historical file (stable ID) ──
    let histWb;
    try {
      const r = await fetch(TOURISM_HISTORICAL_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      histWb = XLSX.read(buf, { type: 'buffer' });
      fs.writeFileSync(TOURISM_HISTORICAL_LOCAL, buf);
    } catch (err) {
      console.log('Historical tourism download failed, using local:', err.message);
      histWb = XLSX.readFile(TOURISM_HISTORICAL_LOCAL);
    }
    const historical = parseHistoricalWorkbook(histWb);

    // ── 2. Discover + fetch latest quarterly file ──
    let quarterly = null;
    let quarterlyId = readCachedQuarterlyId();

    try {
      // Scan from last-known ID upwards for anything newer
      const scanStart = quarterlyId || TOURISM_QUARTERLY_BASE_ID;
      const match = await findLatestQuarterlyFile(scanStart);
      if (match) {
        quarterly = match.parsed;
        quarterlyId = match.id;
        fs.writeFileSync(TOURISM_QUARTERLY_LOCAL, match.buffer);
        writeCachedQuarterlyId(match.id);
        console.log(`Tourism quarterly file discovered: ID ${match.id} (${match.parsed.currentLabel})`);
      } else if (quarterlyId) {
        // No new file found, but we had one cached. Use the local copy.
        const localWb = XLSX.readFile(TOURISM_QUARTERLY_LOCAL);
        quarterly = parseQuarterlyWorkbook(localWb);
      }
    } catch (err) {
      console.log('Quarterly discovery failed, trying local:', err.message);
      try {
        const localWb = XLSX.readFile(TOURISM_QUARTERLY_LOCAL);
        quarterly = parseQuarterlyWorkbook(localWb);
      } catch (_) { /* no local either */ }
    }

    // ── 3. Merge ──
    // Build unified countries map: { name: { annual: {year:N}, current: N|null, compare: N|null } }
    const countries = {};
    for (const [name, years] of Object.entries(historical.countries)) {
      countries[name] = { annual: years, current: null, compare: null };
    }
    let currentPeriod = null;
    if (quarterly) {
      currentPeriod = {
        label: quarterly.currentLabel,
        compareLabel: quarterly.compareLabel,
      };
      // Only include currentPeriod if the label indicates a quarterly period
      // (i.e. contains "კვ"). Plain year labels mean this file just duplicates annual data.
      if (!/კვ/.test(quarterly.currentLabel)) {
        currentPeriod = null;
      }

      if (currentPeriod) {
        for (const [name, vals] of Object.entries(quarterly.countries)) {
          if (!countries[name]) {
            countries[name] = { annual: {}, current: null, compare: null };
          }
          countries[name].current = vals.current;
          countries[name].compare = vals.compare;
        }
      }
    }

    const result = {
      success: true,
      years: historical.years,
      currentPeriod,
      countries,
    };

    tourismCache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('Tourism data error:', err.message);
    res.status(502).json({ error: 'Failed to load tourism data' });
  }
});

module.exports = router;
