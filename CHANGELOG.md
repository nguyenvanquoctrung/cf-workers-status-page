# Changelog

All notable changes to this project are documented here. Dates are in
Asia/Saigon (GMT+7).

## [Unreleased]

## 2026-10-14 — Phase 7: measure latency from your browser (`345e7d7`)

- New "Latency from your browser" card: measures live RTT from the visitor's
  browser to all 13 POPs via `GET https://<host>/info` timed with
  `performance.now()` (ping.nextdns.io-style). Results sorted fastest-first,
  fastest POP highlighted, server-reported rtt shown alongside.
- Complements (does not replace) the server-side cron measurements that power
  history, uptime % and incidents. No auto-run; button-triggered only.
- Frontend-only: no Worker, KV or config changes.

## 2026-10-14 — Phase 6: latency threshold alerts (`a065509`)

- Per-monitor `latencyThresholdMs` in `config.yaml` (thresholds derived from
  live p50/p95 baselines).
- Frontend computes the median of the last 12 latency points (≥3 required);
  exceeding the threshold shows an orange "High latency" pill with a native
  tooltip, plus a dashed orange threshold line on the 12h chart.
- Visual only: does not affect uptime % math, operational status, Overall
  values, group counts or incidents. No Worker/KV changes.

## 2026-10-14 — Fix Phase 5 QA (`0c33ba0`)

- Fixed `renderIncidents` crash (wrong variable name) that blanked the
  Incidents view.
- Monitor names are links again (removed stale `linkable: false`): underlined,
  native URL tooltip, opens in a new tab.

## 2026-10-14 — Phase 5: UptimeFlare parity refinements (`a61b55f`)

- Incident modal title is now `🚨 {Monitor} incidents at {D/M/YYYY}`.
- No tooltip on gray no-data bars; hovered bars brighten to `#9DEAB8`;
  default cursor on bars.
- Removed the ⓘ info icon; monitor name links carry a native `title` tooltip.
- Footer: `Powered by Cloudflare Workers, made with ❤ by nguyenvanquoctrung
  · Get Your Status Page`.
- Scheduled maintenance windows: `maintenances:` in `config.yaml`
  (title/body/monitors/start/end/color), rendered as cards on the Incidents
  view and as a yellow triangle on monitor rows during the window.
  Display-only; Worker notification logic untouched.
- Dark mode: follows the OS by default, manual 3-state toggle
  (auto → light → dark) persisted in localStorage.
- All clock times render in Asia/Saigon with a `GMT+7` label.

## 2026-10-14 — Incidents pager bounded to KV data window (`de3cdec`)

- The Incidents month pager can no longer go past the earliest month that
  still has KV data, nor into future months. Empty months beyond retention
  previously rendered a misleading "No incidents".

## 2026-10-14 — Phase 4: 12h intraday latency chart (`cd7e990`)

- Replaced the 90-day daily latency chart with a 12h intraday chart like
  UptimeFlare: per-check ring buffer in KV (trimmed to 12h, rides the existing
  single write per cycle — no extra KV writes), smooth 2px slate line, hour
  axis, black hover tooltip with timestamp + latency/location, gaps on failed
  checks, "No data yet" placeholder while filling up.

## 2026-10-14 — Card width 897px (`140972e`)

- Card returned to the UptimeFlare-with-groups width (897px) so 90 bars fit
  without stretching.

## 2026-10-14 — Compact 90-bar strip (`fd61f27`)

- 7px bars at ~9px pitch hugging the content instead of spreading full width.

## 2026-10-14 — UptimeFlare-style uptime math (`ff676b9`)

- Overall % is time-weighted (like UptimeFlare) instead of check-counted.

## 2026-10-14 — Cron every 10 minutes (`6a35550`)

- Reduced from every 2 minutes to every 10 minutes: ~144 KV writes/day,
  safely under the 1,000/day free-tier quota (was tripping the 50% alert).

## 2026-10-14 — Standalone project docs (`511d1d0`, `b7d8236`)

- LICENSE holder, Code of Conduct contact and README rewritten for a
  standalone project; upstream credits kept in README Credits only.

## 2026-10-14 — Phase 3: groups, incidents, ticker (`bec3b29`)

- 90-day retention; monitors grouped (🇻🇳 Vietnam 4 / 🌏 International 9);
  accordion state remembered; Incidents view with month pager, monitor filter
  and `#incidents` deep-link; live per-second hero ticker.

## 2026-10-14 — Phase 2: UptimeFlare UI spec (`88bae91`, `5eb6e55`)

- 90-day uptime bar strip, 4-tier day colors, tooltip/day modal, locale dates.

## 2026-10-14 — Phase 1: UptimeFlare restyle (`a97c583`)

- Frontend restyled in the UptimeFlare design language.

## 2026-10-13 — Rewrite & deploy groundwork

- Modernized to wrangler v4 / modules Worker (`d67af39`); deploy fixes for
  Node 22 and KV namespace creation (`312ee2c`, `adc021e`); 13 NextDNS edge
  monitors configured (`9a7d020`).
