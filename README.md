# Gittensor Hub

A dashboard for miners on **Bittensor Subnet 74 (SN74)** — the subnet that rewards merged GitHub PRs in whitelisted open-source repos.

It polls GitHub for issues and PRs across the 200+ SN74 repos (plus any you add), caches them in SQLite, and surfaces them in Browse, Issues, Pulls, My PRs, and Repositories views.

Built with Next.js 15 (App Router), TypeScript, Primer React, and `better-sqlite3`.

## Quick start

```bash
git clone https://github.com/MkDev11/gittensor-hub.git
cd gittensor-hub
pnpm install
cp .env.local.example .env.local   # then fill in the values (see below)
pnpm dev                           # http://localhost:12074
```

Requires Node 20+ and pnpm.

## GitHub setup

You need an **OAuth App** (sign-in) and one or more **Personal Access Tokens** (polling).

**OAuth App** — <https://github.com/settings/developers> → New OAuth App
- Homepage URL: `http://localhost:12074` (or your public URL in prod)
- Callback URL: `<homepage>/api/auth/github/callback`
- Copy the client ID + secret into `.env.local`.

**PATs** — <https://github.com/settings/tokens>
- Scopes: `public_repo`, `read:user`.
- Create 2–4 tokens and paste them comma-separated into `GITHUB_PATS` — the poller rotates between them to spread the rate limit.

## Access

Anyone with a GitHub account can sign in — there is no admin-approval gate. Admins (configured via `ADMIN_GITHUB_LOGINS`) can revoke access by marking a user `rejected` from the admin users page, which signs them out and blocks future sign-ins.

## Environment variables

| Var | Purpose |
| --- | --- |
| `GITHUB_USERNAME` | Your GitHub login (default miner identity) |
| `GITHUB_PATS` | Comma-separated PATs, rotated automatically |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | OAuth app credentials |
| `ADMIN_GITHUB_LOGINS` | Comma-separated logins auto-granted admin on first sign-in |
| `SESSION_SECRET` | Optional; auto-generated on first run if omitted, or set to a 32+ character secret |
| `PORT` | HTTP port (default `12074`) |

## Production

```bash
pnpm build
pm2 start ecosystem.config.js
pm2 save                  # survive reboot
pm2 logs gittensor-hub
```

The app serves plain HTTP. Put nginx/Caddy in front for TLS — auth cookies switch to `Secure` automatically via `x-forwarded-proto`.

## License

MIT
