# Cloudflare Workers — Status Page

Monitor your websites/APIs, showcase status including daily history, and get
Slack / Telegram / Discord notifications whenever a status changes.
Powered by **Cloudflare Workers**, **Cron Triggers** and **KV storage** —
no servers, no build step for the frontend.

![Status Page](.gitbook/assets/status_page_screenshot.png)

## How it works

- Every 2 minutes a Cron Trigger runs the Worker (`src/index.js`), which
  fetches every URL in `config.yaml` and stores results in KV
  (key `monitors_data_v1_1` — same as v1, so history survives upgrades).
- Old entries are garbage-collected automatically (monitors removed from
  config, days older than `daysInHistogram`).
- The frontend (`public/`) is plain HTML/CSS/JS served via
  [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/);
  it polls `GET /api/state` every 30 seconds.
- On status change the Worker can notify Slack, Telegram and/or Discord.

## Deploy with GitHub Actions (recommended)

1. Fork/clone this repository.
2. In your repo go to **Settings → Secrets and variables → Actions** and add:
   - `CF_API_TOKEN` — Cloudflare API token with `Edit Cloudflare Workers`
     (and Workers KV) permissions
   - `CF_ACCOUNT_ID` — your Cloudflare account ID
   - _(optional)_ `SECRET_SLACK_WEBHOOK_URL`
   - _(optional)_ `SECRET_TELEGRAM_API_TOKEN` + `SECRET_TELEGRAM_CHAT_ID`
     (see "Telegram notifications" below)
   - _(optional)_ `SECRET_DISCORD_WEBHOOK_URL`
3. Edit [`config.yaml`](./config.yaml) — list the monitors you want to watch:

   ```yaml
   monitors:
     - id: my-site # unique identifier
       name: example.com
       description: 'My website' # shown as tooltip, optional
       url: 'https://example.com/' # URL to fetch
       method: GET # default=GET
       expectStatus: 200 # operational status, default=200
       followRedirect: false # default=false
       linkable: true # make the title a link, default=true
   ```

4. Push to `main` (or run the **Deploy** workflow manually). The workflow
   builds the config, creates the `KV_STATUS_PAGE` namespace if missing,
   sets secrets and deploys.
5. _(optional)_ In the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/workers)
   assign a custom domain/route to the Worker.

## Telegram notifications

1. [Create a bot](https://core.telegram.org/bots#creating-a-new-bot) and copy
   its token → `SECRET_TELEGRAM_API_TOKEN`.
2. Send any message to the bot from the account that should receive alerts.
3. Get the chat id:
   `curl https://api.telegram.org/bot<TOKEN>/getUpdates`
   → `.result[0].message.chat.id` → `SECRET_TELEGRAM_CHAT_ID`.
4. Redeploy (push or run the workflow).

## Run locally

Requirements: Node 22+, a Cloudflare account.

```bash
npm install
npm run dev        # builds config, starts wrangler dev with local KV
```

Open http://localhost:8787. Manually trigger a check cycle:
`curl http://localhost:8787/api/trigger`.

## Deploy manually (without GitHub Actions)

```bash
npm install
wrangler login
wrangler kv namespace create KV_STATUS_PAGE   # copy the id ...
# ... and put it into wrangler.toml (replace KV_NAMESPACE_ID_PLACEHOLDER)
wrangler secret put SECRET_SLACK_WEBHOOK_URL  # repeat for other secrets (optional)
npm run deploy
```

## Notes

- **Upgrading from v1:** the KV data key is unchanged, so deploying v2 over
  an existing v1 namespace keeps all history. The v1 Flareact frontend and
  `wrangler.toml` format are gone — do not mix old and new files.
- Free plan: KV quota is enough for the default 2-minute interval. To check
  less often, edit the `crons` line in `wrangler.toml`.
- Max ~25 monitors when using Slack notifications (Cloudflare subrequest limit).

## License

MIT — see [LICENSE](./LICENSE).
