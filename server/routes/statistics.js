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

async function fetchFlowRanking(tradeFlowCode, year, months, allCountryIds) {
  // Single Geostat call: pass ALL country IDs + all months + sum=true.

  let rawResponse = null;
  const perCountry = {}; // String(countryId) -> valueThd

  try {
    const json = await geostatFetch('/get_data', {
      method: 'POST',
      body: JSON.stringify({
        tradeFlow: tradeFlowCode,
        measurementUnits: [1],
        years: [year],
        months,
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
  console.log(`country-ranking [flow=${tradeFlowCode} ${year}/m${months.join(',')}]: ${countryCount} countries, total $${total.toFixed(1)}M`);
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
      const allCountryIds = await getAllCountryIds();
      debug.classificatoryCountries = allCountryIds.length;
      console.log(`country-ranking: computing for ${year}/m${sortedMonths.join(',')}, ${allCountryIds.length} countries`);

      // 4 parallel Geostat calls: export + import + domestic export + re-export.
      // Each passes ALL country IDs + full months array + sum=true.
      const [exp, imp, domExp, reExp] = await Promise.all([
        fetchFlowRanking(10, year, sortedMonths, allCountryIds),
        fetchFlowRanking(11, year, sortedMonths, allCountryIds),
        fetchFlowRanking(12, year, sortedMonths, allCountryIds),
        fetchFlowRanking(13, year, sortedMonths, allCountryIds),
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
        totals: { turnover: turnoverTotal, export: exp.total, import: imp.total, domesticExport: domExp.total, reExport: reExp.total },
        flows: { turnover: turnoverRanked, export: exp.perCountry, import: imp.perCountry, domesticExport: domExp.perCountry, reExport: reExp.perCountry },
        flowStats: { export: exp.stats, import: imp.stats, domesticExport: domExp.stats, reExport: reExp.stats },
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
      domesticExport: cached.flows.domesticExport[idKey] || null,
      reExport: cached.flows.reExport[idKey] || null,
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
const TOURISM_DATA_FILE = path.join(__dirname, '../data/tourism-cache.json');

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

// ── Refresh tourism data: fetch, parse, merge, save to disk ──────────
// Called by the daily scheduler and on first request if no cached file.
let tourismRefreshRunning = false;

async function refreshTourismData() {
  if (tourismRefreshRunning) return;
  tourismRefreshRunning = true;
  const t0 = Date.now();
  console.log('tourism: refreshing data...');

  try {
    // 1. Fetch historical file (stable ID)
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
      console.log('tourism: historical download failed, using local:', err.message);
      histWb = XLSX.readFile(TOURISM_HISTORICAL_LOCAL);
    }
    const historical = parseHistoricalWorkbook(histWb);

    // 2. Discover + fetch latest quarterly file
    let quarterly = null;
    let quarterlyId = readCachedQuarterlyId();

    try {
      const scanStart = quarterlyId || TOURISM_QUARTERLY_BASE_ID;
      const match = await findLatestQuarterlyFile(scanStart);
      if (match) {
        quarterly = match.parsed;
        quarterlyId = match.id;
        fs.writeFileSync(TOURISM_QUARTERLY_LOCAL, match.buffer);
        writeCachedQuarterlyId(match.id);
        console.log(`tourism: quarterly file discovered: ID ${match.id} (${match.parsed.currentLabel})`);
      } else if (quarterlyId) {
        const localWb = XLSX.readFile(TOURISM_QUARTERLY_LOCAL);
        quarterly = parseQuarterlyWorkbook(localWb);
      }
    } catch (err) {
      console.log('tourism: quarterly discovery failed, trying local:', err.message);
      try {
        const localWb = XLSX.readFile(TOURISM_QUARTERLY_LOCAL);
        quarterly = parseQuarterlyWorkbook(localWb);
      } catch (_) { /* no local either */ }
    }

    // 3. Merge
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

    // Save to disk + memory cache
    fs.writeFileSync(TOURISM_DATA_FILE, JSON.stringify(result));
    tourismCache = { data: result, ts: Date.now() };
    console.log(`tourism: refresh completed in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${Object.keys(countries).length} countries`);
  } catch (err) {
    console.error('tourism: refresh failed:', err.message);
  } finally {
    tourismRefreshRunning = false;
  }
}

// Load cached data from disk on startup (instant, no network)
function loadTourismFromDisk() {
  try {
    if (fs.existsSync(TOURISM_DATA_FILE)) {
      const raw = fs.readFileSync(TOURISM_DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.success) {
        tourismCache = { data, ts: Date.now() };
        console.log('tourism: loaded from disk cache');
        return true;
      }
    }
  } catch (_) {}
  return false;
}

// Schedule daily refresh at 11:00 AM server time
function scheduleTourismRefresh() {
  const HOUR = 11;
  const now = new Date();
  const next = new Date();
  next.setHours(HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`tourism: next scheduled refresh in ${(delay / 3600000).toFixed(1)}h (${next.toISOString()})`);
  setTimeout(() => {
    refreshTourismData();
    setInterval(refreshTourismData, 24 * 60 * 60 * 1000);
  }, delay);
}

// Init: load from disk, schedule daily refresh
loadTourismFromDisk();
scheduleTourismRefresh();

router.get('/tourism', async (req, res) => {
  try {
    // Serve from memory/disk cache if available
    if (tourismCache.data) {
      return res.json(tourismCache.data);
    }
    // First request ever with no disk cache — do one blocking refresh
    await refreshTourismData();
    if (tourismCache.data) {
      return res.json(tourismCache.data);
    }
    res.status(502).json({ error: 'Tourism data not available yet' });
  } catch (err) {
    console.error('Tourism data error:', err.message);
    res.status(502).json({ error: 'Failed to load tourism data' });
  }
});

// ── POST /api/statistics/fdi-sectors(/upload) ───────────────────────────
// FDI breakdown by country × sector × year. Data comes from an admin-uploaded
// XLSX file. No initial data is bundled — the endpoint returns {empty:true}
// until the first upload.

const { upload, adminOnly, saveParsedAndRaw, loadParsedFromDisk } = require('./admin-uploads');

let fdiSectorsCache = { data: null };

// Sector name mapping: full Georgian name → { short (Georgian), en (English) }
const SECTOR_NAMES = {
  'სულ': { short: 'სულ', en: 'Total' },
  'სოფლის, სატყეო და თევზის მეურნეობა': { short: 'სოფლის მეურნეობა', en: 'Agriculture' },
  'დამამუშავებელი მრეწველობა': { short: 'დამამუშავებელი მრეწველობა', en: 'Manufacturing' },
  'ელექტროენერგიის, აირის, ორთქლის და კონდიცირებული ჰაერის მიწოდება': { short: 'ენერგეტიკა', en: 'Energy' },
  'მშენებლობა': { short: 'მშენებლობა', en: 'Construction' },
  'საბითუმო და საცალო ვაჭრობა; ავტომობილების და მოტოციკლების რემონტი': { short: 'საბითუმო და საცალო ვაჭრობა', en: 'Wholesale and Retail Trade' },
  'ტრანსპორტი და დასაწყობება': { short: 'ტრანსპორტი', en: 'Transport' },
  'განთავსების საშუალებებით უზრუნველყოფის და საკვების მიწოდების საქმიანობები': { short: 'სასტუმროები და რესტორნები', en: 'Hotels and Restaurants' },
  'ინფორმაცია და კომუნიკაცია': { short: 'ინფორმაცია და კომუნიკაცია', en: 'Information and Communication' },
  'საფინანსო და სადაზღვევო საქმიანობები': { short: 'საფინანსო და სადაზღვევო საქმიანობები', en: 'Financial and Insurance Activities' },
  'უძრავ ქონებასთან დაკავშირებული საქმიანობები': { short: 'უძრავი ქონება', en: 'Real Estate' },
  'პროფესიული, სამეცნიერო და ტექნიკური საქმიანობები': { short: 'სამეცნიერო საქმიანობები', en: 'Scientific Activities' },
  'ადმინისტრაციული და დამხმარე მომსახურების საქმიანობები': { short: 'ადმინისტრაციული საქმიანობები', en: 'Administrative Activities' },
  'განათლება': { short: 'განათლება', en: 'Education' },
  'ჯანდაცვა და სოციალური მომსახურების საქმიანობები': { short: 'ჯანდაცვა', en: 'Healthcare' },
  'სამთომოპოვებითი მრეწველობა და კარიერების დამუშავება': { short: 'სამთომოპოვებითი მრეწველობა', en: 'Mining and Quarrying' },
  'წყალმომარაგება; კანალიზაცია, ნარჩენების მართვა და დაბინძურებისაგან გასუფთავების საქმიანობები': { short: 'წყალმომარაგება', en: 'Water Supply' },
  'სხვა სახის მომსახურება': { short: 'სხვა სახის მომსახურება', en: 'Other Services' },
  'ხელოვნება, გართობა და დასვენება': { short: 'ხელოვნება', en: 'Arts' },
};

function sectorShortName(fullName) {
  const m = SECTOR_NAMES[fullName];
  return m ? m.short : fullName;
}

function sectorEnName(fullName) {
  const m = SECTOR_NAMES[fullName];
  return m ? m.en : fullName;
}

function parseFdiSectorsWorkbook(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Workbook has no sheets');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Find the header row: it has "ქვეყნის კოდი" in column A.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || [];
    if (String(row[0] || '').trim() === 'ქვეყნის კოდი') { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('Header row with "ქვეყნის კოდი" not found');

  // Detect period columns from the header (D onwards). Accepts:
  //   "2025"           → label "2025"
  //   "2025*"          → label "2025" (preliminary marker stripped)
  //   "2026 I კვ"      → label "2026 I კვ" (quarterly)
  //   "Q1 2026"        → label "Q1 2026"
  // Any header whose stripped form contains a 4-digit year in [2000..2100]
  // counts. The raw label is preserved so the UI can render "2026 I კვ"
  // instead of just "2026".
  const header = rows[headerIdx];
  const periodCols = [];
  for (let c = 3; c < header.length; c++) {
    const raw = String(header[c] || '').replace(/\*/g, '').trim();
    if (!raw) continue;
    const m = /\b(20\d{2}|21\d{2})\b/.exec(raw);
    if (!m) continue;
    const year = parseInt(m[1], 10);
    if (year < 2000 || year > 2100) continue;
    periodCols.push({ col: c, label: raw });
  }
  if (!periodCols.length) throw new Error('No year/period columns found in header');
  const years = periodCols.map(p => p.label); // strings (may include quarter suffix)

  function parseNum(v) {
    if (v === null || v === undefined || v === '-' || v === '') return null;
    const s = String(v).replace(/,/g, '').replace(/\s/g, '').replace(/\u00A0/g, '');
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return n / 1000; // thousand USD → mln USD
  }

  const countries = {};
  const sectorsSet = new Set();
  let current = null;

  // Skip the grand-total block at the top: first country block starts when a
  // row has a non-empty country code in col A.
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const codeRaw = row[0] != null ? String(row[0]).trim() : '';
    const nameRaw = row[1] != null ? String(row[1]).trim() : '';
    const sectorRaw = row[2] != null ? String(row[2]).trim() : '';

    if (codeRaw && !isNaN(parseInt(codeRaw, 10))) {
      // Start a new country block (the row itself may be "სულ" or a sector —
      // but typically it's the total row).
      const code = String(parseInt(codeRaw, 10));
      current = { code, name: nameRaw };
      if (!countries[code]) countries[code] = { name: nameRaw, sectors: {}, totals: {} };
    }
    if (!current || !sectorRaw) continue;

    const values = {};
    for (const { col, label } of periodCols) values[label] = parseNum(row[col]);

    if (sectorRaw === 'სულ') {
      countries[current.code].totals = values;
    } else {
      // Store using the short Georgian name as the key
      const shortName = sectorShortName(sectorRaw);
      countries[current.code].sectors[shortName] = values;
      sectorsSet.add(shortName);
    }
  }

  // Build sector name mapping for the API response (short KA → EN)
  const sectorNameMap = {};
  for (const s of sectorsSet) {
    // Find the English name by checking all mappings
    for (const [full, m] of Object.entries(SECTOR_NAMES)) {
      if (m.short === s) { sectorNameMap[s] = m.en; break; }
    }
    if (!sectorNameMap[s]) sectorNameMap[s] = s;
  }

  return {
    uploadedAt: new Date().toISOString(),
    years,
    sectors: Array.from(sectorsSet),
    sectorNameMap,
    countries,
  };
}

function loadFdiSectorsFromDisk() {
  const parsed = loadParsedFromDisk('fdi-sectors');
  if (parsed) {
    fdiSectorsCache.data = parsed;
    console.log(`fdi-sectors: loaded from disk (${Object.keys(parsed.countries || {}).length} countries, years ${parsed.years?.join(',')})`);
  }
}

// Init: load any previously uploaded data on module load.
loadFdiSectorsFromDisk();

router.get('/fdi-sectors', (req, res) => {
  const data = fdiSectorsCache.data;
  if (!data) return res.json({ success: true, empty: true });
  res.json({
    success: true,
    uploadedAt: data.uploadedAt,
    years: data.years,
    sectors: data.sectors,
    sectorNameMap: data.sectorNameMap || {},
    countries: data.countries,
    yearsCovered: data.years,
    countryCount: Object.keys(data.countries).length,
    sectorCount: data.sectors.length,
  });
});

router.post('/fdi-sectors/upload', ...adminOnly, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const parsed = parseFdiSectorsWorkbook(wb);
    const countryCount = Object.keys(parsed.countries).length;
    if (!countryCount) return res.status(400).json({ error: 'No country data found in file' });
    saveParsedAndRaw('fdi-sectors', parsed, req.file.buffer);
    fdiSectorsCache.data = parsed;
    console.log(`fdi-sectors: uploaded (${countryCount} countries, ${parsed.sectors.length} sectors, years ${parsed.years.join(',')})`);
    res.json({
      success: true,
      uploadedAt: parsed.uploadedAt,
      yearsCovered: parsed.years,
      countryCount,
      sectorCount: parsed.sectors.length,
    });
  } catch (err) {
    console.error('fdi-sectors upload error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to parse uploaded file' });
  }
});

module.exports = router;
