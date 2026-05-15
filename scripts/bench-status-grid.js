#!/usr/bin/env node

/**
 * Benchmark script for the /api/workflow/status-grid endpoint.
 *
 * Prerequisites:
 *   - Node 18+ (uses native fetch)
 *   - A running vector-app server with a seeded database
 *   - A valid user account and an existing event ID
 *
 * Usage:
 *   EVENT_ID=42 USERNAME=admin PASSWORD=secret node scripts/bench-status-grid.js
 *
 * Environment variables:
 *   BASE_URL  - Server origin (default: http://localhost:3000)
 *   USERNAME  - Login username (required)
 *   PASSWORD  - Login password (required)
 *   EVENT_ID  - ID of an existing event to query (required)
 *   ITERATIONS - Number of requests to fire (default: 100)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;
const EVENT_ID = process.env.EVENT_ID;
const ITERATIONS = parseInt(process.env.ITERATIONS || '100', 10);

// ── helpers ────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function fmt(ms) {
  return `${ms.toFixed(1)} ms`;
}

// ── main ───────────────────────────────────────────────────────────────

async function main() {
  // Validate required env vars
  if (!USERNAME || !PASSWORD) {
    console.error('ERROR: USERNAME and PASSWORD environment variables are required.');
    process.exit(1);
  }
  if (!EVENT_ID) {
    console.error('ERROR: EVENT_ID environment variable is required.');
    process.exit(1);
  }

  console.log(`Benchmark: GET /api/workflow/status-grid?event_id=${EVENT_ID}`);
  console.log(`Server:    ${BASE_URL}`);
  console.log(`Iterations: ${ITERATIONS}\n`);

  // ── Step 1: Authenticate ─────────────────────────────────────────────

  console.log('Authenticating...');

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });

  if (!loginRes.ok) {
    const body = await loginRes.text();
    console.error(`Login failed (${loginRes.status}): ${body}`);
    process.exit(1);
  }

  // Extract session cookie(s) from Set-Cookie headers
  const setCookies = loginRes.headers.getSetCookie
    ? loginRes.headers.getSetCookie()
    : [loginRes.headers.get('set-cookie')].filter(Boolean);

  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');

  if (!cookieHeader) {
    // Fall back to token-based auth if the response body contains a token
    const loginBody = await loginRes.json().catch(() => null);
    if (!loginBody?.token) {
      console.error('No session cookie or token received from login.');
      process.exit(1);
    }
    // Will be handled below if needed
  }

  console.log('Authenticated successfully.\n');

  // ── Step 2: Warm-up request ──────────────────────────────────────────

  const warmupUrl = `${BASE_URL}/api/workflow/status-grid?event_id=${EVENT_ID}`;
  const warmupRes = await fetch(warmupUrl, {
    headers: { Cookie: cookieHeader },
  });

  if (!warmupRes.ok) {
    const body = await warmupRes.text();
    console.error(`Warm-up request failed (${warmupRes.status}): ${body}`);
    process.exit(1);
  }

  // consume the body so the connection is freed
  await warmupRes.json();
  console.log('Warm-up request OK.\n');

  // ── Step 3: Benchmark loop ───────────────────────────────────────────

  const durations = [];
  const url = `${BASE_URL}/api/workflow/status-grid?event_id=${EVENT_ID}`;

  for (let i = 1; i <= ITERATIONS; i++) {
    const start = performance.now();

    const res = await fetch(url, {
      headers: { Cookie: cookieHeader },
    });

    // consume the response body (included in the timing)
    await res.json();

    const elapsed = performance.now() - start;
    durations.push(elapsed);

    if (i % 10 === 0 || i === 1) {
      process.stdout.write(`  ${i}/${ITERATIONS}  (last: ${fmt(elapsed)})\r`);
    }
  }

  process.stdout.write('\n\n');

  // ── Step 4: Report ───────────────────────────────────────────────────

  durations.sort((a, b) => a - b);

  const min = durations[0];
  const max = durations[durations.length - 1];
  const mean = durations.reduce((s, v) => s + v, 0) / durations.length;
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const p99 = percentile(durations, 99);

  console.log('Results');
  console.log('─'.repeat(36));
  console.log(`  min:  ${fmt(min)}`);
  console.log(`  max:  ${fmt(max)}`);
  console.log(`  mean: ${fmt(mean)}`);
  console.log(`  p50:  ${fmt(p50)}`);
  console.log(`  p95:  ${fmt(p95)}`);
  console.log(`  p99:  ${fmt(p99)}`);
  console.log('─'.repeat(36));
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
