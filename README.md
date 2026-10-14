# Cloudflare Workers — Status Page

Monitor your websites/APIs with a fast, serverless status page. Checks run on
a schedule via Cron Triggers, history lives in KV, and the frontend is a
dependency-free static page in the visual language of
[UptimeFlare](https://github.com/lyc8503/UptimeFlare).

**Live demo:** https://nextdns.jeremienguyen.workers.dev

## Features

- **90-day uptime bar strip** per monitor (UptimeFlare color tiers; gray days =
  no data yet — history grows over time, nothing is fabricated)
- **Monitor groups** (accordion, e.g. 🇻🇳 Vietnam / 🌏 International) with
  per-group "X/Y Operational" counts; collapse state remembered in localStorage
- **Incidents view** (`#incidents`) with month pager and monitor filter
- **Live ticker**: hero shows "Last updated on … (N sec ago)" with N ticking
  every second; page auto-reloads when data is stale
- **Latency chart** per monitor with red markers on incident days; click a bar
  for incident details (est. downtime, episodes, avg response, per location)
- Dark mode toggle, search filter, responsive layout (bar strip hides on small
  screens like the reference)
- Slack / Telegram / Discord notifications on status change
- No servers, no frontend build step — Cloudflare Workers + KV only

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

## License

MIT — see [LICENSE](./LICENSE).
