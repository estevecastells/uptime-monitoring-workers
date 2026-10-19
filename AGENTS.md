# Agent guide

## Deploys and tests

- **A push to `main` is a production deploy.** `.github/workflows/deploy.yml` deploys every push to `main` to Cloudflare (re-run with `gh workflow run deploy.yml`). GitHub does not run tests; it only deploys. Any manual deploy commands elsewhere in this file are a fallback for when GitHub Actions is unavailable.
- **The full local check suite is mandatory before every push.** Current suite: `npm test`, `[ ! -f wrangler.toml ] || npx wrangler deploy --dry-run --outdir "$(mktemp -d)" >/dev/null`. `.githooks/pre-push` runs it when pushing `main`; enable it once per clone with `git config core.hooksPath .githooks` (the SessionStart hook in `.claude/settings.json` does this for Claude sessions). Never push with `--no-verify` or with a failing check.
- A change is deployed only when the `Deploy` workflow run for that commit succeeded (`gh run list --workflow deploy.yml`, `gh run watch`).
- wrangler.toml is gitignored on purpose; the workflow writes it from the WRANGLER_TOML repository secret. Update that secret whenever you change the local wrangler.toml.
