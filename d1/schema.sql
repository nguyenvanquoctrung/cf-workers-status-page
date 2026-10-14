-- D1 schema for cf-workers-status-page (pilot B)
-- Time-series latency storage. KV remains source of truth for
-- status / incidents / day-stats during the pilot (rollback-safe).

-- One row per check per monitor. ms NULL = check failed (gap in chart).
CREATE TABLE IF NOT EXISTS latency (
  monitor_id TEXT NOT NULL,
  ts INTEGER NOT NULL,          -- unix seconds
  ms REAL,                      -- round-trip ms, NULL on failure
  loc TEXT NOT NULL,            -- edge location, e.g. 'BOM', 'EWR'
  PRIMARY KEY (monitor_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_latency_ts ON latency(ts);

-- Retention: 90 days, matching the Worker's 90-day chart window.
-- Cleanup runs inside the cron handler:
--   DELETE FROM latency WHERE ts < unixepoch('now', '-90 days');
--
-- Capacity (free tier): 13 monitors x 1 check/min = ~18.7K writes/day
-- (quota 100K/day). 90 days ~= 1.7M rows, well under 5GB.
