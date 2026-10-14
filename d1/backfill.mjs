// Backfill D1 from the live /api/state endpoint.
// Usage: node d1/backfill.mjs > d1/backfill.sql
// Then: npx wrangler d1 execute status-page-ts --file=d1/backfill.sql
//
// Reads each monitor's 12h latency ring buffer from KV (via the public
// state API) and generates INSERT OR IGNORE statements for D1.
// Safe to re-run: PRIMARY KEY (monitor_id, ts) + OR IGNORE = idempotent.

const STATE_URL = 'https://nextdns.jeremienguyen.workers.dev/api/state'

const res = await fetch(STATE_URL)
if (!res.ok) throw new Error(`state API: ${res.status}`)
const state = await res.json()

const esc = (s) => `'${String(s).replace(/'/g, "''")}'`
const monitors = state.monitors || {}
let n = 0
for (const id of Object.keys(monitors)) {
  const m = monitors[id]
  const pts = m.latency || []
  for (const p of pts) {
    if (!Number.isFinite(p.t)) continue
    const ms = Number.isFinite(p.ms) ? p.ms : 'NULL'
    console.log(
      `INSERT OR IGNORE INTO latency (monitor_id, ts, ms, loc) VALUES (${esc(id)}, ${Math.floor(p.t)}, ${ms}, ${esc(p.loc || '')});`
    )
    n++
  }
}
console.error(`-- ${n} rows generated`)
