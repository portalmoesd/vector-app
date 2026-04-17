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

// ── POST /api/statistics/country-ranking ────────────────────────────────────
// Returns the selected country's rank + share of Georgia totals for the
// given (year, months) across three trade flows. Caches the computed
// all-countries rankings for 1 hour so subsequent PDF exports hit the cache.

const RANKING_TTL = 60 * 60 * 1000; // 1 hour
const RANKING_CACHE_MAX = 32;
const rankingCache = new Map(); // key -> { data, ts }

function rankingCacheGet(key) {
  const entry = rankingCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > RANKING_TTL) { rankingCache.delete(key); return null; }
  return entry.data;
}

function rankingCacheSet(key, data) {
  if (rankingCache.size >= RANKING_CACHE_MAX) {
    // Evict oldest (Map preserves insertion order)
    const oldestKey = rankingCache.keys().next().value;
    if (oldestKey !== undefined) rankingCache.delete(oldestKey);
  }
  rankingCache.set(key, { data, ts: Date.now() });
}

// Geostat row helpers
function extractRowValue(row) {
  for (const key of Object.keys(row)) {
    if (key.startsWith('usd1000_')) {
      const v = parseFloat(row[key]);
      if (!isNaN(v)) return v;
    }
  }
  return 0;
}

function extractRowCountryId(row) {
  // Geostat may use any of these field names for the country identifier.
  return row.country ?? row.country_id ?? row.countryId ?? row.country_code ?? null;
}

async function fetchFlowRanking(tradeFlowCode, year, lastMonth, allCountryIds) {
  // Single Geostat call: pass ALL country IDs + sum=true + months=[lastMonth].
  // sum=true makes months=[N] return the cumulative Jan..N total.
  // Response: one row per country, each with a usd1000_* value field.

  let rawResponse = null;
  const perCountry = {}; // String(countryId) -> valueThd

  try {
    const json = await geostatFetch('/get_data', {
      method: 'POST',
      body: JSON.stringify({
        tradeFlow: tradeFlowCode,
        measurementUnits: [1],
        years: [year],
        months: [lastMonth],
        countries: allCountryIds,
        sum: true,
        locale: 'en',
        page: 1,
        pageSize: 500,
      }),
    });
    rawResponse = {
      success: json.success,
      total: json.total,
      rowCount: Array.isArray(json.data) ? json.data.length : 0,
    };

    if (json && Array.isArray(json.data)) {
      for (const row of json.data) {
        if (row.isGroupSummary) continue;
        const val = extractRowValue(row);
        if (val <= 0) continue;
        // Try every plausible field name for the country identifier.
        let cid = null;
        for (const f of ['country', 'country_id', 'countryId', 'country_code', 'countries']) {
          if (row[f] != null && row[f] !== '') { cid = row[f]; break; }
        }
        if (cid == null) {
          if (!rawResponse.sampleRowKeys) {
            rawResponse.sampleRowKeys = Object.keys(row);
            rawResponse.sampleRow = row;
          }
          continue;
        }
        const key = String(cid);
        perCountry[key] = (perCountry[key] || 0) + val;
      }
    }
  } catch (err) {
    rawResponse = { error: err.message };
  }

  const countryCount = Object.keys(perCountry).length;
  const entries = Object.entries(perCountry)
    .map(([cid, thd]) => ({ cid, valueMln: thd / 1000 }))
    .filter((e) => e.valueMln > 0)
    .sort((a, b) => b.valueMln - a.valueMln);

  const total = entries.reduce((s, e) => s + e.valueMln, 0);
  const map = {};
  entries.forEach((e, idx) => {
    map[e.cid] = {
      valueMln: e.valueMln,
      rank: idx + 1,
      sharePct: total > 0 ? (100 * e.valueMln / total) : 0,
    };
  });

  const stats = { withTrade: countryCount, totalMln: total, rawResponse };
  console.log(`country-ranking [flow=${tradeFlowCode} ${year}/m${lastMonth}]: ${countryCount} countries, total $${total.toFixed(1)}M`);
  return { total, perCountry: map, stats };
}

async function getAllCountryIds() {
  // Reuse the classificatory cache so we don't hit Geostat again.
  if (classCache.en && Date.now() - classCache.ts < CACHE_TTL) {
    return (classCache.en.data?.countries || []).map((c) => c.value).filter((v) => v != null);
  }
  const data = await geostatFetch('/classificatory?lang=en');
  classCache.en = data;
  classCache.ts = Date.now();
  return (data.data?.countries || []).map((c) => c.value).filter((v) => v != null);
}

router.post('/country-ranking', async (req, res) => {
  const debug = {
    cacheKey: null,
    cacheHit: false,
    classificatoryCountries: 0,
    computedMs: 0,
    flowStats: null,
    countryIdRequested: null,
    countryIdType: null,
    countryFoundInFlows: null,
  };
  try {
    const { year, months, countryId } = req.body || {};
    // Validation
    if (!Number.isInteger(year) || year < 1990 || year > 2100) {
      return res.status(400).json({ error: 'Invalid year', _debug: debug });
    }
    if (!Array.isArray(months) || months.length === 0 || months.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) {
      return res.status(400).json({ error: 'Invalid months', _debug: debug });
    }
    if (countryId == null || countryId === '') {
      return res.status(400).json({ error: 'Invalid countryId', _debug: debug });
    }

    const sortedMonths = [...months].sort((a, b) => a - b);
    const cacheKey = `${year}:${sortedMonths.join(',')}`;
    debug.cacheKey = cacheKey;
    debug.countryIdRequested = String(countryId);
    debug.countryIdType = typeof countryId;

    let cached = rankingCacheGet(cacheKey);
    debug.cacheHit = !!cached;

    if (!cached) {
      const t0 = Date.now();
      const lastMonth = Math.max(...sortedMonths);
      const allCountryIds = await getAllCountryIds();
      debug.classificatoryCountries = allCountryIds.length;
      console.log(`country-ranking: computing for ${year}/m${lastMonth}, ${allCountryIds.length} countries`);

      // 2 parallel Geostat calls: export (tradeFlow=10) + import (tradeFlow=20).
      // Each passes ALL country IDs + sum=true + months=[lastMonth].
      // sum=true makes months=[N] return the cumulative Jan..N total.
      // Turnover = export + import, computed per country after fetching.
      const [exp, imp] = await Promise.all([
        fetchFlowRanking(10, year, lastMonth, allCountryIds),
        fetchFlowRanking(20, year, lastMonth, allCountryIds),
      ]);

      // Compute turnover per country = export + import
      const turnoverMap = {};
      const allCids = new Set([...Object.keys(exp.perCountry), ...Object.keys(imp.perCountry)]);
      let turnoverTotal = 0;
      for (const cid of allCids) {
        const val = (exp.perCountry[cid]?.valueMln || 0) + (imp.perCountry[cid]?.valueMln || 0);
        if (val > 0) turnoverMap[cid] = val;
      }
      // Sort and assign ranks for turnover
      const turnoverEntries = Object.entries(turnoverMap)
        .sort(([, a], [, b]) => b - a);
      turnoverTotal = turnoverEntries.reduce((s, [, v]) => s + v, 0);
      const turnoverRanked = {};
      turnoverEntries.forEach(([cid, valueMln], idx) => {
        turnoverRanked[cid] = {
          valueMln,
          rank: idx + 1,
          sharePct: turnoverTotal > 0 ? (100 * valueMln / turnoverTotal) : 0,
        };
      });

      cached = {
        totals: { turnover: turnoverTotal, export: exp.total, import: imp.total },
        flows: { turnover: turnoverRanked, export: exp.perCountry, import: imp.perCountry },
        flowStats: { export: exp.stats, import: imp.stats },
      };
      // Only cache if we got meaningful data; never cache failures.
      const hasData = exp.stats.withTrade > 0 || imp.stats.withTrade > 0;
      if (hasData) rankingCacheSet(cacheKey, cached);
      debug.computedMs = Date.now() - t0;
      debug.cached = hasData;
      console.log(`country-ranking: completed in ${(debug.computedMs / 1000).toFixed(1)}s — exp:${exp.stats.withTrade} imp:${imp.stats.withTrade} countries`);
    }

    debug.flowStats = cached.flowStats || null;

    const idKey = String(countryId);
    const country = {
      turnover: cached.flows.turnover[idKey] || null,
      export: cached.flows.export[idKey] || null,
      import: cached.flows.import[idKey] || null,
    };
    debug.countryFoundInFlows = {
      turnover: !!country.turnover,
      export: !!country.export,
      import: !!country.import,
    };

    res.json({ success: true, totals: cached.totals, country, _debug: debug });
  } catch (err) {
    console.error('Statistics country-ranking error:', err.message);
    res.status(502).json({ error: 'Failed to fetch country ranking', reason: err.message, _debug: debug });
  }
});

// ── POST /api/statistics/country-ranking/debug ──────────────────────────
// Returns the RAW Geostat response for exactly one country/flow/period so
// we can inspect the row shape (isGroupSummary presence, usd1000_* field
// naming, any country-identifier field) straight from the browser console.
router.post('/country-ranking/debug', async (req, res) => {
  try {
    const { tradeFlow, year, months, countryId } = req.body || {};
    if (!['turnover', 'export', 'import'].includes(tradeFlow)) {
      return res.status(400).json({ error: 'tradeFlow must be turnover|export|import' });
    }
    if (!Number.isInteger(year)) return res.status(400).json({ error: 'Invalid year' });
    if (!Array.isArray(months) || months.length === 0) return res.status(400).json({ error: 'Invalid months' });
    if (countryId == null) return res.status(400).json({ error: 'Invalid countryId' });

    const filters = {
      tradeFlow,
      measurementUnits: [1],
      years: [year],
      months,
      countries: [countryId],
      locale: 'en',
      sum: true,
      page: 1,
      pageSize: 10,
    };
    const raw = await geostatFetch('/get_data', {
      method: 'POST',
      body: JSON.stringify(filters),
    });

    // Also show what fetchFlowRanking would have extracted.
    let extracted = 0;
    let extractionPath = null;
    if (raw && Array.isArray(raw.data)) {
      const summary = raw.data.find((r) => r.isGroupSummary);
      if (summary) { extracted = extractRowValue(summary); extractionPath = 'isGroupSummary'; }
      else { extracted = raw.data.reduce((s, r) => s + extractRowValue(r), 0); extractionPath = 'sum-all-rows'; }
    }

    res.json({
      success: true,
      filtersSent: filters,
      rawResponse: raw,
      extracted: { valueThd: extracted, valueMln: extracted / 1000, path: extractionPath },
    });
  } catch (err) {
    console.error('country-ranking/debug error:', err.message);
    res.status(502).json({ error: err.message });
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
