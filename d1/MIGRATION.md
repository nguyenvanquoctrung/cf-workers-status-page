# D1 Pilot Plan (Phase B trial)

Goal: 1-minute checks with D1 time-series storage, keeping KV untouched as
the rollback path.

## Design

- **KV stays as-is.** `monitors_data_v1_1` keeps being written every cycle
  (status, incidents, day-stats, 12h latency ring buffer). Nothing deleted.
- **D1 stores latency time-series only** (see `schema.sql`). Dual-write in
  the cron handler: KV write (existing) + D1 batch insert (new).
- **New API:** `GET /api/latency?monitor=<id>&hours=24` reads from D1.
  Frontend chart tries D1 first, falls back to the KV-embedded `latency`
  array if D1 errors or returns empty.
- **Cron:** `*/10 * * * *` → `* * * * *` (every minute).

## Steps

1. `npx wrangler d1 create status-page-ts` → copy `database_id` into
   `wrangler.toml` under `[[d1_databases]]` (binding `DB`).
2. `npx wrangler d1 execute status-page-ts --file=d1/schema.sql`
3. Backfill: `node d1/backfill.mjs` — reads KV `monitors_data_v1_1`,
   inserts existing 12h latency points into D1 (INSERT OR IGNORE).
4. Deploy Worker with dual-write + `/api/latency` + 1-min cron.
5. QA live: chart renders from D1, 1-min granularity visible, uptime
   unaffected, D1 dashboard shows writes ~18.7K/day.
6. Soak 24–48h. If stable → keep. If not → rollback.

## Rollback (one deploy)

1. Revert `wrangler.toml` cron to `*/10 * * * *`, remove `[[d1_databases]]`.
2. Redeploy. Frontend automatically falls back to KV latency array.
3. D1 database can be left idle or deleted — KV data was never touched.

## Quota check (free tier)

- D1 writes: 13 monitors × 1440/day ≈ 18.7K/day (limit 100K) ✓
- D1 reads: chart polls are small range queries ✓
- KV writes: unchanged (~144/day) ✓
- Worker CPU: 13 sequential fetches/min — already proven at 10-min
  cadence; watch p50/p99 in dashboard during soak.
