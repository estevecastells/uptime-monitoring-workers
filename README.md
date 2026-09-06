# Free Uptime Monitor for Cloudflare Workers

A free, open-source uptime monitoring tool that runs entirely on **Cloudflare Workers**. It auto-discovers all domains on your Cloudflare account and monitors them, with alerts via Telegram and email.

**Zero cost** — runs within Cloudflare's free tier (supports up to ~200 monitors).

## Features

- **Auto-discovery** — automatically monitors every active domain in your Cloudflare account
- **Manual monitors** — add any URL through the dashboard
- **5-minute checks** — HTTP health checks with response time tracking
- **1-minute re-checks** — down sites are re-checked every minute for faster detection
- **Zero Trust dashboard** — gated by Cloudflare Access, with a dark-themed UI showing uptime bars, response time charts, and incident history
- **Telegram alerts** — instant notifications when a site goes down or recovers
- **Email alerts** — via Resend API
- **Smart alerting** — requires 2 consecutive failures before alerting (no false positives, ~1 min detection)
- **Incident tracking** — logs downtime periods with duration
- **Edit, pause, delete** — full control over each monitor from the dashboard
- **Down-first sorting** — down monitors always appear at the top
- **7-day retention** — automatic cleanup of old data

## Quick Setup

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [Node.js](https://nodejs.org/) 18+
- A [Telegram bot](https://core.telegram.org/bots#creating-a-new-bot) and chat/group ID
- A [Resend](https://resend.com/) account (free tier: 100 emails/day)

### 1. Clone and install

```bash
git clone https://github.com/estevecastells/uptime-monitoring-workers.git
cd uptime-monitoring-workers
cp wrangler.toml.example wrangler.toml
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create uptime-monitor-db
```

Copy the `database_id` from the output and paste it into your `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "uptime-monitor-db"
database_id = "your-database-id-here"  # <-- paste here
```

### 3. Run the migration

```bash
npx wrangler d1 migrations apply uptime-monitor-db --remote
```

### 4. Set your secrets

```bash
npx wrangler secret put CLOUDFLARE_API_KEY     # CF API token with Zone:Read
npx wrangler secret put CLOUDFLARE_EMAIL       # Your CF account email (legacy Global Key only)
npx wrangler secret put TELEGRAM               # Format: BOT_TOKEN|CHAT_ID
npx wrangler secret put RESEND                 # Your Resend API key
npx wrangler secret put ALERT_EMAIL            # Email address to receive alerts
```

There is no dashboard password: access is handled by Cloudflare Access, set up
in step 5.

#### Getting your Telegram credentials

1. Create a bot with [@BotFather](https://t.me/BotFather) → you'll get a bot token like `123456789:AAGxyz...`
2. Add the bot to a group, or message it directly
3. Get your chat ID by messaging [@userinfobot](https://t.me/userinfobot) on Telegram, or check `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` after sending the bot a message
4. Set the secret as `BOT_TOKEN|CHAT_ID` (pipe-separated). Example: `123456789:AAGxyz...|-1001234567890`

#### Resend email setup

On the free tier without a verified domain, Resend only delivers to the email address you signed up with. To send to any address, [verify a domain](https://resend.com/domains) in your Resend dashboard and add the required DNS records.

### 5. Put Cloudflare Access in front of the Worker

The dashboard has no built-in login. It authenticates users with
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/)
(free tier is enough), which signs users in at the edge before a request ever
reaches the Worker. **Set this up before deploying** — without it the Worker
correctly refuses every request.

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
2. **Access > Applications > Add an application > Self-hosted**
3. Set the application domain to your Worker hostname, e.g.
   `uptime-monitor.<your-subdomain>.workers.dev`
4. Add a policy — for a personal instance, an *Allow* policy including just
   your own email address
5. Open the application's **Overview** tab and copy the **Application Audience
   (AUD) Tag**
6. Put that tag, and your team domain, in `wrangler.toml`:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "your-team.cloudflareaccess.com"
ACCESS_AUD = "your-access-application-aud-tag"
```

Neither value is a secret — the AUD tag is useless without a token signed by
your team's private key — so they live in `wrangler.toml` rather than in
`wrangler secret`.

### 6. Deploy

```bash
npx wrangler deploy
```

Your monitor is now live at `https://uptime-monitor.<your-subdomain>.workers.dev`,
and visiting it redirects you through your identity provider first.

## Cloudflare Credentials

Zone discovery only calls `GET /zones`, so the credential it needs is an **API
token scoped to `Zone:Read`** — create one under
[My Profile > API Tokens](https://dash.cloudflare.com/profile/api-tokens).

Do not use a Global API Key. It grants full control of the account (DNS, R2,
Workers, Access, billing), and credentials added through **Settings > Cloudflare
Accounts** are stored in D1 in plain text — so anything able to read the
database would inherit whatever that credential can do. A scoped token limits
that to listing zone names.

Existing installs that predate this keep working: rows carry an `auth_type` of
`global_key` and still authenticate with `X-Auth-Email`/`X-Auth-Key`. To move
one over, create a `Zone:Read` token and update the row:

```sql
UPDATE cf_accounts SET api_key = '<token>', auth_type = 'token' WHERE id = <id>;
```

## Dashboard Authentication

Authentication is entirely delegated to Cloudflare Access. The Worker verifies
the JWT that Access attaches to each request (`Cf-Access-Jwt-Assertion`),
checking the RS256 signature against your team's published keys plus the
`aud`, `iss` and `exp` claims — see [`src/auth/access.ts`](src/auth/access.ts).

Two things worth knowing:

- **The signature is what is trusted, not the headers.** Access also sends a
  convenient `Cf-Access-Authenticated-User-Email` header, but any client that
  reaches the Worker outside of Access can set that header to anything. Since a
  Worker stays reachable on its `workers.dev` hostname, trusting the header
  alone would be one misconfiguration away from no authentication at all.
- **The allowlist lives only in the Access policy.** There is no list of
  permitted emails in this codebase, so adding or removing a user is a change
  in one place and needs no deploy.

To revoke someone's access, remove them from the Access policy; their session
stops working as soon as their current token expires.

## Local Development

Create a `.dev.vars` file with your secrets (never commit this):

```
CLOUDFLARE_API_KEY=your-api-key
CLOUDFLARE_EMAIL=your@email.com
TELEGRAM=bot-token|chat-id
RESEND=re_your-resend-key
ALERT_EMAIL=your@email.com
```

Local `wrangler dev` runs without Access in front of it, so the Worker has no
JWT to verify and will refuse requests. Point `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`
at a real application and copy a `CF_Authorization` cookie from the deployed
dashboard when you need to exercise authenticated routes locally.

Then run:

```bash
npx wrangler d1 migrations apply uptime-monitor-db --local
npx wrangler dev --test-scheduled
```

Visit `http://localhost:8787` to see the dashboard.

## How It Works

| Cron | Schedule | Purpose |
|------|----------|---------|
| `* * * * *` | Every minute | Re-check down monitors; full check every 5th minute |
| `0 */6 * * *` | Every 6 hours | Re-sync domains from Cloudflare API |
| `0 3 * * *` | Daily at 3 AM UTC | Purge data older than 7 days |

### Alert Logic

1. Every 5 minutes, all active monitors are checked
2. If a site is down, it's re-checked **every minute**
3. After **2 consecutive failures** (~1 minute apart), a DOWN alert is sent via Telegram and email
4. When the site recovers, a RECOVERED alert is sent
5. No duplicate alerts — each downtime period is tracked as an incident

### Architecture

- **Runtime:** Cloudflare Workers (free tier)
- **Database:** Cloudflare D1 (SQLite)
- **Router:** [Hono](https://hono.dev/)
- **UI:** Server-rendered HTML (no build step, no frontend framework)
- **Notifications:** Telegram Bot API + Resend email API

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Dashboard |
| `GET` | `/monitor/:id` | Monitor detail page |
| `GET` | `/settings` | Settings page |
| `POST` | `/api/monitors` | Add a monitor `{ url, name? }` |
| `PUT` | `/api/monitors/:id` | Edit a monitor `{ url?, name? }` |
| `DELETE` | `/api/monitors/:id` | Delete a monitor |
| `POST` | `/api/monitors/:id/toggle` | Pause/resume a monitor |
| `GET` | `/api/monitors/:id/checks` | Check history (JSON) |
| `GET` | `/api/stats` | Dashboard summary (JSON) |
| `POST` | `/api/sync-zones` | Force Cloudflare zone re-sync |

## Free Tier Limits

| Resource | Free Tier | Usage (50 monitors) | Headroom |
|----------|-----------|---------------------|----------|
| Worker requests/day | 100,000 | ~15,000 | 85% |
| D1 rows written/day | 100,000 | ~15,000 | 85% |
| D1 rows read/day | 5,000,000 | ~65,000 | 98% |
| Cron triggers | 5 | 3 | 2 spare |

Comfortably supports up to **~200 monitors** on the free tier.

## Tests

Run the test suite before submitting a PR:

```bash
npm test
```

Tests use [Vitest](https://vitest.dev/) with Cloudflare's Workers test pool, so they run against a real D1 database in a local Workers runtime. The suite covers:

- **DB queries** — CRUD operations, soft-delete, stats, cleanup
- **Health checker** — check logic, incident creation after 2 failures, recovery
- **API routes** — auth, monitor CRUD, toggle, validation
- **Notifications** — Telegram and email payload formatting
- **Zone discovery** — sync, deactivation, soft-delete protection

## Contributing

Contributions are welcome! Feel free to open issues, submit pull requests, or fork the project for your own use. Whether it's bug fixes, new features, documentation improvements, or ideas — all contributions are appreciated.

Please run `npm test` and make sure all tests pass before submitting a PR.

## License

MIT — free and open source. Use it however you want, including commercially. Fork it, modify it, sell it, deploy it for your clients — no restrictions beyond the MIT license terms.
