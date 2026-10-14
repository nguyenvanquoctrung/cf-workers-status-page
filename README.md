# Cloudflare Workers — Status Page

**English** | [Bản tiếng Việt](README.vi.md)

Monitor your websites/APIs with a fast, serverless status page. Checks run on
a schedule via Cron Triggers, history lives in KV, and the frontend is a
dependency-free static page in the visual language of
[UptimeFlare](https://github.com/lyc8503/UptimeFlare).

**Live demo:** https://nextdns.jeremienguyen.workers.dev

## Features

- **Vietnamese/English UI** — one-click language switch in the header
  (persisted, defaults to Vietnamese); dates, numbers and timestamps follow
  the active locale (timezone stays Asia/Saigon); switching language never
  wipes a running measurement or its results
- **90-day uptime bar strip** per monitor (UptimeFlare color tiers; gray days =
  no data yet and show no tooltip — history grows over time, nothing is
  fabricated)
- **12h intraday latency chart** per monitor (smooth 2px line, hour axis, black
  hover tooltip, gaps on failed checks); per-monitor **latency threshold
  alerts** — an orange "High latency" pill plus a dashed threshold line when
  the recent median exceeds the configured `latencyThresholdMs`
- **Ping tab** (`#ping`): one click measures live RTT from the
  visitor's browser to every POP (ping.nextdns.io-style), sorted fastest-first;
  auto-starts on first open. (A test.nextdns.io-style NextDNS status check was
  prototyped but is quarantined — unreliable on the owner's network.)
- **Speedtest tab** (`#speedtest`): self-hosted ping/download/upload test
  (vietcdn.net-style) against the Cloudflare edge — 20&nbsp;MB random test
  file, 4 parallel streams, 10s window with 1s warmup grace; no third-party
  bandwidth. Plus a **detailed test** section measuring vietcdn.net's 8 real
  servers (Real-Debrid 10&nbsp;GiB files) plus the Cloudflare edge row —
  sequential single-connection then 6-connection rounds per server, rows
  appearing progressively like vietcdn, with Stop and per-server progress
- **DNS Tools tab** (`#dns`): **DNS Lookup** — query any record type for any
  domain via dnscheck.tools (addr.tools) infrastructure with automatic
  fallback to Cloudflare DNS-over-HTTPS (swappable provider order); **DNS
  Leak Test** — mirrors dnscheck.tools: your IP addresses with RDAP registrant
  and geolocation ("(show more)" for extended IPs), live status pills
  (RTT, IPv6, ADoX, EDNS, DNSSEC), a full DNSSEC validation matrix
  (Invalid/Expired/Missing × 4 signature algorithms), resolvers grouped by
  registrant with ECS subnets, a bottom status bar with live `dns:` query
  counter (ECH shown as n/a — unreadable cross-origin), all powered by their
  WebSocket + nameserver observation
- **Monitor groups** (accordion, e.g. 🇻🇳 Vietnam / 🌏 International) with
  per-group "X/Y Operational" counts; collapse state remembered in localStorage
- **Incidents view** (`#incidents`) with month pager (bounded to the KV data
  window — no paging into months whose data is gone), monitor filter, and
  **scheduled maintenance windows** (`maintenances:` in `config.yaml`)
- **Live ticker**: hero shows "Last updated on … (GMT+7) (N sec ago)" with N
  ticking every second; page auto-reloads when data is stale
- Time-weighted **Overall %** (UptimeFlare-style math); click a bar for
  incident details (est. downtime, episodes, avg response, per location)
- Dark mode (follows the OS by default; manual auto → light → dark toggle),
  search filter, responsive layout (bar strip hides on small screens like the
  reference)
- Slack / Telegram / Discord notifications on status change (optional, via
  Worker secrets)
- No servers, no frontend build step — Cloudflare Workers + KV only

Full history: [CHANGELOG.md](CHANGELOG.md).

## How it works

- A Cron Trigger checks monitors every 10 minutes (`crons` in
  `wrangler.toml`); results are stored in KV under `monitors_data_v1_1` —
  **history survives redeploys and upgrades**
- `config.yaml` is the single source of truth for monitors and texts
- Stale-data cleanup (monitors removed from config, days older than
  `daysInHistogram`) runs inside the Worker — no post-deploy scripts
- Free-plan friendly: ~144 KV writes/day at the default 10-minute interval,
  well under the 1,000/day quota; 90 days of daily history per monitor

## What changed in the 2026 rewrite

- **Removed Flareact** (unmaintained since 2021, incompatible with modern
  wrangler) → dependency-free static frontend (plain HTML/CSS/JS)
- **Worker rewritten** to modules format (`src/index.js`: `fetch` + `scheduled`)
- **wrangler v4** config: Workers Static Assets, `kv_namespaces`, cron triggers
- **Deploy workflow rebuilt**: Node 22, wrangler CLI directly, KV namespace
  auto-created/reused via API; runs on push to `main` or manually
- Frontend restyled to match UptimeFlare (bar strip, groups, incidents view,
  live ticker); uptime math is time-weighted like the reference
- Dependencies updated; vulnerable `node-fetch`/`postcss` era packages gone

## Deploy with GitHub Actions (recommended)

1. Clone this repository (or use it as a template).
2. **Settings → Secrets and variables → Actions**, add:
   - `CF_API_TOKEN` — token with `Edit Cloudflare Workers` permissions
   - `CF_ACCOUNT_ID` — your Cloudflare account ID
   - _(optional)_ `SECRET_SLACK_WEBHOOK_URL`
   - _(optional)_ `SECRET_TELEGRAM_API_TOKEN` + `SECRET_TELEGRAM_CHAT_ID`
   - _(optional)_ `SECRET_DISCORD_WEBHOOK_URL`
3. Edit [`config.yaml`](./config.yaml):

   ```yaml
   monitors:
     - id: my-site # unique identifier
       name: example.com
       description: 'My website' # tooltip, optional
       url: 'https://example.com/' # URL to fetch
       method: GET # default=GET
       expectStatus: 200 # default=200
       followRedirect: false # default=false
       linkable: true # title as link, default=true
   ```

4. Push to `main` (or run the **Deploy** workflow manually).
5. _(optional)_ Assign a custom domain in the
   [Cloudflare dashboard](https://dash.cloudflare.com/?to=/workers).

## Telegram notifications

1. [Create a bot](https://core.telegram.org/bots#creating-a-new-bot) →
   `SECRET_TELEGRAM_API_TOKEN`.
2. Send any message to the bot.
3. `curl https://api.telegram.org/bot<TOKEN>/getUpdates` →
   `.result[0].message.chat.id` → `SECRET_TELEGRAM_CHAT_ID`.
4. Redeploy.

## Run locally

Requirements: Node 22+, a Cloudflare account.

```bash
npm install
npm run dev        # builds config, starts wrangler dev with local KV
```

Open http://localhost:8787. Trigger a check manually:
`curl http://localhost:8787/api/trigger`.

## Deploy manually (without GitHub Actions)

```bash
npm install
wrangler login
wrangler kv namespace create KV_STATUS_PAGE   # copy the id into wrangler.toml
wrangler secret put SECRET_SLACK_WEBHOOK_URL  # repeat for other secrets (optional)
npm run deploy
```

## Notes

- The KV key is unchanged across rewrites, so redeploying over an existing
  namespace keeps all history. Do not mix old and new files.
- Free plan: KV quota covers the default 10-minute interval (~144 writes/day);
  change `crons` in `wrangler.toml` to check more or less often.
- Max ~25 monitors with Slack notifications (Cloudflare subrequest limit).

## Credits

- Original project: [eidam/cf-workers-status-page](https://github.com/eidam/cf-workers-status-page)
  (via [yue374/cf-workers-status-page](https://github.com/yue374/cf-workers-status-page),
  which this repository was forked from). The git history was restarted in
  October 2026 from the full rewrite, but the idea and the early work belong
  to the upstream authors — thank you.
- UI/UX design language inspired by [lyc8503/UptimeFlare](https://github.com/lyc8503/UptimeFlare).
- **DNS Leak Test & DNS Lookup** powered by [dnscheck.tools](https://dnscheck.tools)
  ([brianshea2/addr.tools](https://github.com/brianshea2/addr.tools), AGPL-3.0)
  infrastructure — the leak test mirrors its logic and behavior; thank you for
  keeping the endpoints CORS-open.
- **Detailed speedtest** uses [vietcdn.net](https://vietcdn.net)'s 8 test
  servers and test files, hosted by Real-Debrid — thank you.
- **Ping tab** inspired by [ping.nextdns.io](https://ping.nextdns.io); the
  (currently quarantined) NextDNS status check uses the
  [test.nextdns.io](https://test.nextdns.io) technique — thank you, NextDNS.

## License

MIT — see [LICENSE](./LICENSE).
