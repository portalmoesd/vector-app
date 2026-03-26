/**
 * Statistics proxy — relays requests to ex-trade-api.geostat.ge
 * so the frontend avoids CORS issues and we can cache / transform data.
 */
const express = require('express');
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

module.exports = router;
