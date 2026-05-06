# Performance

## Status Grid Endpoint

The `/api/workflow/status-grid` endpoint is the most query-intensive endpoint, loading all sections, department assignments, workflow chains, actor names, and return requests for an event.

### Optimizations Applied
- Batch department assignments query (single `WHERE section_id = ANY($1)`)
- Batch return requests and return info queries (single `DISTINCT ON` each)
- Cached curator/deputy lookups per unique department set
- Pre-fetched DS user info once instead of per-section

### Benchmark Results

Run `node scripts/bench-status-grid.js` with a test event to measure.

| Metric | Before | After |
|--------|--------|-------|
| Queries per request (16 sections) | ~80 | ~8 |
| p50 | TBD | TBD |
| p95 | TBD | TBD |
| p99 | TBD | TBD |
