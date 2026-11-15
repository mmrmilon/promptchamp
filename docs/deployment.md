# Publish PromptChamp from GitHub

Repository: `https://github.com/mmrmilon/promptchamp`.

## Server-side variables

Maintain production values in GitHub's `production` environment as described in [ci-cd.md](ci-cd.md). CI/CD synchronizes them to production Functions before deployment. The GitHub secret `PRODUCTION_DATABASE_URL` supplies runtime `DATABASE_URL`. Never put `.env` itself in GitHub, frontend variables, or build logs.

- `DATABASE_URL`
- `SESSION_SECRET` (at least 32 random characters)
- `ADMIN_ACCESS_KEY` (at least 32 random characters)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `GEMINI_JUDGE_API_KEY`
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `PLATFORM_OWNER_EMAIL` for registered accounts; see [accounts](accounts.md) for SMTP, redirects, and the shared-key transition.
- `APP_MODE=demo` keeps the optional `/demo.html` experience isolated. The real event pages use database event settings and live AI independently of this legacy switch.

Global `EVENT_START` and `EVENT_END` are not required for the team event flow. Create and schedule events through `/admin.html`.

## Database and build

The migrations are already applied to the currently configured Supabase database. For another database, use Node 22 and run `npm ci` then `npm run migrate` locally against that database. Migrations are additive and keep the legacy competition tables separate.

Import the GitHub repository into Netlify. Build command: `npm run build`; publish directory: `dist`. `netlify.toml` declares the functions directory, public CA file, reference assets, and Node 22 build version. Configure the Functions runtime for Node 22 or later. Set environment variables before deploying, then trigger a new deployment when variables change.

Production must support background and scheduled functions. `process-queue-background` processes up to 20 queued jobs per invocation, bounded to eight minutes. After an accepted submission, the API invokes that function with a signed internal credential. `queue-dispatch` runs every minute as a fallback if an invocation was lost. Internal invocations use the host-provided `URL` variable and do not trust browser-supplied hosts. Runtime detection uses `URL` and `SITE_ID`, which the host supplies to functions. Domain changes should be made in the hosting project's primary domain settings so `URL` stays correct. Do not override these read-only values.

Functions scope must include all AI/database/session variables for the API, background processor, and scheduled dispatcher. Add the custom `URL` domain to your deployment smoke test when you change domains.

## Live checks

1. Open `/admin.html`, register/verify the configured owner email, then sign in. The private host key is transitional only.
2. Create a small rehearsal event, upload a reference under 2 MiB, and open registration.
3. Open the team link in another browser/profile; join, save the recovery code, and choose a number.
4. Lock the draw, call the team, start, and submit a prompt. Verify generation, scoring, and image persistence after reload.
5. Publish results and verify the presentation leaderboard from a signed-out browser.
6. Create the actual office event separately. A rehearsal consumes real provider quota when processing runs.

Generation reservations enforce the event's image cap, including failures and uncertain calls. Duplicate submissions reuse the existing reservation. Scoring retries reuse the generated image. A replacement generation requires an explicit host action, a reason, and another quota slot. Earlier unprocessed rehearsal submissions are marked for host review rather than automatically sent to AI after upgrade.

Reference and generated images are currently stored privately in Postgres. Successful generated images expire after 30 days; scores and prompts remain. This suits the initial office pilot but object storage is the next scaling step. Uploaded reference images are not automatically deleted.

Administration uses verified personal accounts and workspace roles; see [accounts.md](accounts.md). Event registration links are open to anyone who has the link; this version does not implement corporate SSO or an event join code.

## Local operation

`npm run dev` starts the application and a durable database-backed processing loop. `PROCESS_AI=false` disables that local loop for automated testing. `npm run worker` starts a separate local runner if needed; do not depend on an unawaited HTTP promise for processing. Multiple workers use transactional leases to avoid claiming the same job. An expired generation lease goes to host review rather than issuing an automatic duplicate call.

Automated integration tests use a test server on port 5174 with `PROCESS_AI=false`. Build `server/processing.ts` into `.netlify/local/processing-test.mjs` with esbuild before running `scripts/test-live-processing.mjs`. Its default mode uses mock AI providers. Adding `--live-ai` makes one real generation and judging call. Test scripts create and clean their own isolated records.
