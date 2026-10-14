# Changelog

All notable changes to this project are documented here. Dates are in
Asia/Saigon (GMT+7).

## [Unreleased]

## 2026-10-14 — Phase 10: Ping tab (`960be8f`, `43fc8ea`, `3138663`, `dd84210`)

- **"Latency from your browser" card became a dedicated Ping tab** (`#ping`,
  nav: Status | Incidents | Ping | Speedtest | DNS Tools) — same one-click
  browser-to-POP latency measurement, now with its own view.
- **Auto-runs on first open** (like ping.nextdns.io); "Measure now" re-runs
  manually; results survive tab switches and reloads (nav click now sets the
  `#ping` hash — previously fell through to `#`, losing the tab on reload).
- **Monitor groups default: Vietnam expanded, International collapsed**
  (was: all collapsed); localStorage still remembers manual toggles.
- A test.nextdns.io-style **"NextDNS status"** card was prototyped (random-
  subdomain trick, reformatted to this site's design, "Powered by
  test.nextdns.io") then **quarantined** (`NX_STATUS_ENABLED = false`): the
  verdict never arrives on the owner's network (QA from test browsers passed).

## 2026-10-14 — Phase 9c: leak test full info parity (`f478290`)

- **DNSSEC probe fixed (was broken, now works):** the 9b `<link
  rel=stylesheet>` onload/onerror technique never fired — browsers MIME-check
  stylesheets and the test domains answer `Content-Type: text/plain`. Replaced
  with `fetch(url, {mode: 'no-cors', cache: 'no-store'})`: resolve (opaque) =
  connected, reject = blocked — the exact 1:1 port of the original's
  first-party `fetch().ok` signal. Applies to the calibration probe and all
  matrix probes; honest "untestable" fallback kept for genuinely blocked
  networks.
- **Full info parity with dnscheck.tools:** "Your IP addresses" now shows the
  **RDAP registrant** above each IP and **"City, Region, CC"** geolocation
  beside it (registrant via IANA RDAP bootstrap + per-RIR RDAP, CORS-open;
  geo via `ip.addr.tools`); extended WebRTC IPs hide behind **"(show more)"**.
- **"Your DNS resolvers"** grouped by registrant (like the original), each row
  with reverse DNS, geolocation, protocol and query count; ECS subnets keep
  their own summary line.
- New bottom **status bar** mirroring the original: `{rtt}ms IPv6 EDNS DNSSEC
  ECH` indicators + live **`dns: N`** query counter. **ECH** renders `n/a`
  with a tooltip — `X-ECH-Status` is only exposed to dnscheck.tools itself,
  never cross-origin (shown honestly, never faked).
- Attribution line kept honest: "Like this tool? Star us on GitHub" →
  `brianshea2/addr.tools`.
- **Post-release refinements** (`fb97190`, `f830a04`, `a023236`, `87e8035`,
  `d3b67be`, `59da851`): DNSSEC calibration now probes `{id}.test-alg15`
  (real IP) instead of `a.{id}-nullip` (`0.0.0.0` by design); "(show more)"
  toggle works before/during/after a run (state split from run state);
  microphone-permission flow on "(show more)" (RFC 8828) like the original;
  private IPs labeled "Reserved"; removed the duplicated DNSSEC caption and
  the GitHub promo line; credit-only subtitles everywhere.

## 2026-10-14 — Fix: page auto-reload killing measurements (`0f94d5f`)

- Root cause: `tickHero()` reloaded the page when monitor data was older than
  300s — a leftover from the 2-minute cron era. With the 10-minute cron, data
  is routinely 5–10 minutes old, causing reload loops mid-measurement. Now
  reloads only when data is older than 1800s (30 min), and never while a
  speedtest, detailed test or leak test is running.


## 2026-10-14 — Phase 9b: leak test mirrors dnscheck.tools (`64bbe41` pt.2)

- **DNS Leak Test** card reworked per Jeremie's "as close to the original as
  possible": logic ported from `brianshea2/addr.tools`
  `website/dnscheck.tools/main.js`.
- New **"Your IP addresses"** section: `myipv4`/`myipv6.addr.tools/plain`
  plus best-effort WebRTC ICE candidates via STUN (no mic prompt).
- New **DNSSEC Validation Tests** matrix (Invalid/Expired/Missing × ECDSA
  P-256, ECDSA P-384, Ed25519, ML-DSA-44) with the original's exact pass/fail
  semantics: per algorithm the valid-signature domain is probed first, then its
  badsig/expiredsig/nosig variants — a connected bad variant = FAIL (red),
  blocked = PASS (green), ML-DSA-44 FAIL* yellow with footnote, failed valid
  domain = column ERR. Cross-origin the "connected" signal is read via
  `<link rel=stylesheet>` onload/onerror (fetch would reject on CORS); a
  calibration probe gates the matrix — if blocked, cells honestly show
  "untestable" instead of faked results.
- New status pills mirroring the original's status bar: **RTT** (15 probes,
  same green ≤150ms / yellow ≤500ms / red thresholds), **IPv6**, **ADoX**,
  **EDNS** (advertised UDP sizes, yellow if <1200), **DNSSEC**. ECH omitted —
  `X-ECH-Status` is not readable cross-origin.
- ECS subnets now also shown as their own line ("Your DNS resolvers advertise
  your IP subnet (ECS)"); resolvers table kept with PTR enrichment.

## 2026-10-14 — Phase 8c: detailed test uses vietcdn's real servers (`64bbe41` pt.1)

- "Detailed test" reworked per Jeremie's decision (their-infrastructure-first):
  now measures against **vietcdn.net's 8 real servers** (Netherlands, RBX,
  HKG1, SGP1, TYO1, LAX1, TLV1, Cloudflare via Real-Debrid 10&nbsp;GiB test
  files — URLs taken from vietcdn.net's page source, all verified reachable
  with `Access-Control-Allow-Origin: *`), plus a final **Cloudflare edge
  (this site)** row using the self-hosted 20&nbsp;MB file as fallback.
- Per server: sequential single-connection then 6-connection rounds (10s
  window, **1.5s warmup grace like the original**, same Mbps formula); rows
  appear progressively with live Mbps; per-round failures marked "failed"
  without stopping the run.
- Row presentation mirrors vietcdn.net: flag per server (flagcdn.com, orange
  ☁ badge for Cloudflare rows), 📍 pin on HKG1 (their "closest server" pick
  for VN visitors), **Multi** badge on 6-connection rows, bold live Mbps +
  1-decimal MB/s, overall progress bar, fastest-single-connection summary
  line. Deliberately NOT copied: their hardcoded server-IP list, ISP-report
  note, visitor-IP box, and results telemetry (their API).
- New **Stop** button (aborts promptly, keeps completed rows) and progress
  line ("Server 3/9 …"); ~3-minute full run; mutual exclusion with the
  simple test kept. Note under the section credits Real-Debrid/vietcdn.net
  infrastructure.
- QA follow-ups: finished rows are never cleared on completion/stop
  ("Run again" clears and restarts); `renderSpeedtest()` no longer re-renders
  while a test is running (hashchange re-render can't wipe rows mid-test);
  `refreshState()` validates the `/api/state` payload shape and guards each
  render with try/catch + console logging — a bad payload or render exception
  keeps the last good DOM and retries on the next cycle instead of blanking
  the page.

## 2026-10-14 — Phase 9: DNS Tools tab (`923b59a`)

- New **DNS Tools** tab (`#dns`, next to Speedtest), frontend-only.
- **DNS Lookup**: domain input + record-type select (A/AAAA/CNAME/MX/TXT/NS/
  SOA/SRV/PTR/CAA), client-side validation, IP→reverse-DNS auto-conversion
  for PTR. Provider abstraction: primary dnscheck.tools (addr.tools) with
  automatic fallback to Cloudflare DNS-over-HTTPS on any failure
  (`DNS_PROVIDER_ORDER` = one-line swap); NXDOMAIN/SERVFAIL handled as
  informative states; query time shown; results table with type names, TTL,
  data; loading spinner; Enter-key submit.
- **DNS Leak Test**: replicates the dnscheck.tools main flow — random client
  ID, WebSocket to their infrastructure, `no-cors` trigger queries, resolver
  grouping (IP/protocol/ECS/query count) with best-effort reverse DNS;
  graceful "unreachable" message if their WebSocket is blocked. Display-only;
  never crashes the page.

## 2026-10-14 — Phase 8b: vietcdn-style detailed speedtest (`fce7a4a`)

- New "Detailed test" section inside the Speedtest tab (below the summary
  cards): sequential single-connection then 6-connection download rounds
  against the Cloudflare edge, rows appearing progressively with live Mbps
  like vietcdn.net. Same 20&nbsp;MB test file and Mbps formula; own start
  button, no auto-run; the two test modes are mutually exclusive so they
  can't skew each other's numbers.

## 2026-10-14 — Phase 8: self-hosted speedtest tab (`bc88561`)

- New **Speedtest** tab next to Incidents (`#speedtest` deep-link): measures
  **ping** (median of 3 timed `/api/state` fetches), **download** and **upload**
  from the visitor's browser to the Cloudflare edge, vietcdn.net-style
  (fixed 10s window, 1s warmup grace, Mbps = 8·bytes/s·1.1/1048576).
- Fully self-hosted: download pulls a 20&nbsp;MB random-bytes static asset
  (`public/speedtest-20m.bin`, 4 parallel streams re-requesting as needed);
  upload POSTs generated 2&nbsp;MB random blobs to the Worker's new
  `POST /speedtest/upload` endpoint (reads and discards the body, no KV
  writes). No third-party bandwidth.
- Button-triggered only, live-updating numbers, per-metric failure isolation.

## 2026-10-14 — Groups collapsed by default (`2389253`)

- Monitor groups now start collapsed (click a group header to expand),
  giving a compact overview on load. An explicit expand/collapse choice is
  still remembered in localStorage.

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

## 2026-10-14 — Hash deep-link mid-session (`5f2fb62`)

- Changing the URL hash mid-session (`#incidents` / `#speedtest`) now switches
  views via a `hashchange` listener (previously only worked on page load).
