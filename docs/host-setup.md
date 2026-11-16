# PromptChamp host setup

The host workspace is at `/admin`. The office event landing page is at `/`; the original competition demo is at `/demo`.

## Sign in

Open the local `.env` file and copy the value of `ADMIN_ACCESS_KEY` into the host sign-in form. Do not share it with participating teams. The initial setup generates this key and `SESSION_SECRET` privately if absent. They are not printed in logs. Keep `.env` out of Git. Changing `SESSION_SECRET` invalidates host cookies; changing only the access key prevents new logins with the old key but does not revoke existing eight-hour cookies.

This initial release uses one shared office host credential. Per-person host accounts and event ownership are future work. Host routes require a signed, eight-hour HttpOnly cookie and same-origin writes. Use HTTPS when deployed. The event dashboard works while the original demo remains in demo mode.

## Prepare an event

1. Create an event with a title, unique address, Malaysia date/time, 2- or 3-minute timer, and generation budget.
2. Upload a PNG, JPEG, or WebP reference under 2 MiB. The host sees a private preview.
3. Edit draft settings as needed. Every team will receive the same image, and lucky numbers will set playing order.
4. Open registration and share the team link displayed beneath the event settings. Teams enter their names, save a recovery code, and choose an available lucky number. Expected team count defines capacity and the number pool (1 to that count).
5. Once all teams have chosen, close registration and lock the draw. Queue positions follow ascending lucky numbers.
6. Call the next team. Only that team can press Start. Its reference is revealed and its persisted 2- or 3-minute timer begins. A called team can be skipped and later returned to the queue, before it has started.
7. Teams save drafts automatically and submit once before their deadline. Refresh and recovery on another device preserve the deadline. At expiry, drafts are not automatically submitted. The host can call the next team after submission or expiry.

Team registration, lucky-number selection, queue controls, timed turns, draft recovery, live image generation, judging, and leaderboard publication are implemented. Accepted submissions reserve a generation and queue durable processing jobs. The original demo stays isolated.

The AI safety limit is under Advanced settings. It protects provider quota; it does not change the timer or number pool. A practical future default is one generation per expected team plus a small reserve for authorized technical retries. The current default remains 80 requests; change it in Advanced if required.

After any team registers, event settings and the reference are frozen. You cannot return the event to draft. Use a separate rehearsal event rather than enrolling test teams in your real office event.

## Database

Run `npm exec --yes --package=node@22 -- node scripts/migrate.mjs` for the ordered additive migrations. It uses `.env` and creates tables in the separate `promptchamp` schema without altering existing `public.players` or `public.attempts`. RLS is enabled on all new tables with no browser policies. Only the trusted server database account accesses them.

The tables cover events, rounds, teams, team sessions, timed entries, submissions, private reference images, and audit history. Evaluation records, durable processing jobs, and generation reservations are also installed. This release stores bounded reference-image bytes privately in Postgres because no private object-storage credentials have been configured. Moving images to object storage is part of the processing stage.

The new event API uses a standard PostgreSQL pool with dedicated transaction clients. The bundled public CA in `db/root-ca.pem` verifies the database provider's TLS certificate and hostname; it is not a secret. Keep it included in server deployment files. The original demo/live backend retains its existing driver.

For automated integration verification, start the development server on port 5174 and run `scripts/test-event-setup.mjs` and `scripts/test-team-gameplay.mjs` using Node 22. They create isolated test events and remove only their own records. Gameplay checks simulate deadline expiry directly in the test's own database rows without waiting for two minutes.

The environment needs `DATABASE_URL`, `SESSION_SECRET`, and `ADMIN_ACCESS_KEY`. The event's own schedule and timer are in the database; the dashboard does not use the old global `EVENT_START` and `EVENT_END` settings.

See [deployment](deployment.md) for production environment variables, background processing, live checks, and current limitations.
