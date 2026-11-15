# Automated checks and production deployment

Workflow: `.github/workflows/pipeline.yml`.

## GitHub is the configuration source

Maintain settings at **GitHub → mmrmilon/promptchamp → Settings → Environments → production**. Repository Actions secrets also work, but environment secrets take precedence; prefer one location. Never commit `.env`.

Add these **Environment secrets**:

| Secret | Purpose |
| --- | --- |
| `NETLIFY_AUTH_TOKEN` | Token authorized to deploy and read/create/update/delete the site's environment variables |
| `NETLIFY_SITE_ID` | PromptChamp Site/Project ID, not its URL |
| `PRODUCTION_DATABASE_URL` | Supabase Postgres connection string; also synchronized as runtime `DATABASE_URL` |
| `SESSION_SECRET` | Existing random session secret, at least 32 characters |
| `CLOUDFLARE_ACCOUNT_ID` | Image provider account |
| `CLOUDFLARE_API_TOKEN` | Image provider token |
| `GEMINI_JUDGE_API_KEY` | Image judge API key |
| `SUPABASE_URL` | Supabase HTTPS project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key from the same project |
| `PLATFORM_OWNER_EMAIL` | Exact email for initial verified platform-admin registration |
| `ADMIN_ACCESS_KEY` | Optional transition key, at least 32 characters; remove after claiming the office workspace |

Optional **Environment variables** (not secrets):

| Variable | Default / purpose |
| --- | --- |
| `APP_MODE` | `demo`; legacy demo-page switch. Events have their own database mode |
| `PUBLIC_APP_URL` | Omit to use Netlify's canonical URL; otherwise production HTTPS URL |
| `ALLOW_LEGACY_HOST_LOGIN` | Defaults to `true` when a transition key exists, otherwise `false`; set `false` to retire shared-key access |

No separate GitHub `DATABASE_URL` is needed. Values only in local `.env`, or saved as Variables where this table requires Secrets, are not used.

## Automatic workflow

Pull requests and pushes to `main` install locked dependencies on Node 22, build all pages/functions, test configuration synchronization with mocked HTTP, and run isolated Postgres integration tests with fake credentials and mock AI/authentication. Checks use no production secrets or paid AI calls.

After checks pass on `main`, production deployment validates configuration, synchronizes allowlisted settings to Netlify, applies pending migrations, then publishes the application and functions. Failed validation, synchronization or migration stops publication. Deployments are serialized. PRs and other branches cannot deploy or access production secrets.

Synchronized settings use **Functions scope**, **Production context**, and secret-marked values when supported. If Netlify explicitly rejects granular scopes because of the plan, synchronization retries with standard encrypted variables and all scopes, retaining Production context. These standard variables can be read by authorized hosting users; they lack the additional write-only Secrets Controller flag. A warning records this fallback without values. Generic permission failures never trigger it. Existing secret-marked variables that cannot be converted are not deleted to bypass that protection; API errors stop publication.

The script logs names only; it does not write credential files or print API response errors, which could echo values. Deployment credentials are not copied to functions. Built-in `URL`/`SITE_ID` and unrelated variables are untouched. Keep independent hosting builds stopped; all-scopes variables must not be exposed by untrusted builds or frontend code.

GitHub replaces values and contexts for the managed allowlist; use a separate project for staging/preview settings. Missing optional `ADMIN_ACCESS_KEY` and `PUBLIC_APP_URL` are removed from the hosting project to avoid stale fallbacks. Missing required runtime settings fail deployment instead of reusing old values. The initial three deployment credentials retain the setup-warning behavior when absent; inspect deployment steps, not only the checks badge.

Synchronization makes multiple API requests. A failure can leave some stored settings updated, but stops publication. Fix the error and rerun to reconcile. Previously published deployments are not rewritten; avoid restoring deployments with outdated credentials.

## One-time setup

1. Create/import the PromptChamp Netlify project, note its Site/Project ID, and confirm support for background/scheduled functions and Functions-scoped variables.
2. Add the GitHub production settings above, using existing values to preserve sessions and database connectivity.
3. Disable independent Netlify Git-triggered builds using **Stopped builds**, retaining CLI production publishing. Otherwise independent builds could bypass checks and synchronization. See [stopped-builds guidance](https://docs.netlify.com/build/configure-builds/stop-or-activate-builds/).
4. Run **GitHub Actions → PromptChamp CI/CD → Run workflow → main**. Confirm synchronization, migrations and deployment pass. Future passing pushes deploy automatically.
5. Finish Supabase email and redirect configuration in [accounts.md](accounts.md), then register/verify your owner account. SMTP and provider account settings remain in their own services.

Manage subsequent values in GitHub only and rerun deployment after changing them. Direct edits to managed Netlify variables are overwritten next deployment. Netlify still stores runtime copies; GitHub is the place you maintain them. The workflow cannot read your local `.env` or recover GitHub secret values.

API references: [environment variables](https://open-api.netlify.com/#tag/environmentVariables), [Functions environment](https://docs.netlify.com/build/functions/environment-variables/).

## Migrations and validation

Migration names/checksums are recorded in `promptchamp.schema_migrations` under an advisory lock. Files apply once transactionally; edited applied migrations are rejected. Add new numbered files. Windows/Linux line endings are normalized. Existing tables are preserved. Keep changes backward-compatible: failed publication does not undo committed migrations. Use forward migrations for schema corrections.

The CLI and GitHub Actions are pinned; Dependabot proposes updates. Consider requiring **Build and integration tests** in branch protection.

- `npm run check`: build pages and compile functions without secrets.
- `node --test scripts/test-runtime-env.mjs`: validation, allowlist, production scope, updates/removals and error redaction using mocked HTTP.
- `npm run test:ci`: isolated integration suite; requires loopback `promptchamp_ci` Postgres and no `.env` in the checkout. Includes migration replay, accounts/roles/tenant isolation, gameplay and mocked AI processing.
- `npm run migrate`: apply pending migrations to the explicitly configured database.
