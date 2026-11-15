# Automated checks and production deployment

Workflow: `.github/workflows/pipeline.yml`.

## What happens automatically

Pull requests to `main` and pushes to `main` install locked dependencies on Node 22, build every application page, compile all API/background/scheduled functions, and run the database-backed integration suite. Tests use a disposable PostgreSQL service with fake credentials and mocked AI providers. No production database, private API key, or paid AI call is used for CI.

The suite checks host authorization, private references, team registration, concurrent number claims, timed deadlines, session recovery, duplicate submissions, processing leases, generation caps, judging recovery, and result publication. It runs migrations twice to check replay safety. Tests refuse a non-loopback database, a database other than `promptchamp_ci`, or a checkout containing `.env`.

After successful checks on `main`, production deployment applies unapplied database migrations and publishes the application and functions to the configured Netlify site. Failed checks or migrations stop deployment. Production deploys are serialized. Other branches and pull requests cannot deploy or access deployment secrets. You can also run the workflow manually from GitHub Actions on `main`.

## One-time setup

1. Create/import the PromptChamp project in Netlify and note its Site/Project ID. Confirm that your plan supports background and scheduled functions.
2. In Netlify, set the existing runtime values listed in [deployment.md](deployment.md): database, AI credentials, session secret, and host key. They need Functions scope. Keep these out of the repository.
3. In GitHub repository Settings → Secrets and variables → Actions, add these repository secrets (or put them in the `production` environment):

| Secret | Value |
| --- | --- |
| `NETLIFY_AUTH_TOKEN` | A Netlify personal access token authorized for your site |
| `NETLIFY_SITE_ID` | The intended PromptChamp site's ID, not its URL |
| `PRODUCTION_DATABASE_URL` | The same database connection string used by the deployed application; used only by the migration step |

4. Disable the site's independent Git-triggered builds using **Stopped builds**, while retaining deploys through the CLI. GitHub Actions must be the deployment authority; otherwise a Git-connected Netlify build could publish code before checks pass. Do not lock/pause all production publishing, which would also block CLI deploys. See the official [Netlify stopped-builds guidance](https://docs.netlify.com/build/configure-builds/stop-or-activate-builds/).
5. Open the repository's Actions tab, select **PromptChamp CI/CD**, and run the workflow on `main`. Once configured, future passing pushes deploy automatically.

If any deployment secret is missing, CI still runs and the deployment job records a warning and setup instructions rather than attempting to publish. A green checks job alone does not mean the site was deployed. The deployment step's logs show the published URL.

The GitHub workflow cannot copy secrets from your local computer or create a Netlify account. Saving `.env` locally does not configure GitHub or Netlify. Do not paste tokens into issues, commits, or workflow YAML.

## Database migrations

Migration names and SHA-256 checksums are recorded in `promptchamp.schema_migrations` under an advisory lock. Each file applies once inside a transaction. An edited applied migration is rejected; add a new numbered file instead. Line endings are normalized before hashing, so Windows and Linux agree.

Existing pilot databases without the migration ledger run the existing idempotent foundation files once to establish the ledger. Earlier rehearsal submissions without processing jobs stay marked for host review; they are not silently sent to AI.

Keep changes backward-compatible because migrations run before code publication. A failed deployment does not undo committed database changes. Roll back code using a previous Netlify deploy or a revert commit; apply a forward migration for schema corrections. Destructive migrations need separate review and backups.

## Local commands

- `npm run check`: frontend build and compilation of all functions. No secrets needed.
- `npm run test:ci`: the isolated integration harness. Requires CI environment variables, a local `promptchamp_ci` PostgreSQL instance, and no `.env`. Prefer running this in a fresh checkout or GitHub Actions, not the folder containing office credentials.
- `npm run migrate`: apply pending migrations against the explicitly configured database.

The deployment CLI is pinned in package-lock.json; GitHub Actions are pinned to immutable release commits. Dependabot proposes updates monthly. Fork PRs use disposable CI credentials and receive no production secrets. Consider requiring **Build and integration tests** in branch protection once the first run succeeds.
