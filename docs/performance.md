# Dashboard latency investigation

## Findings

The November 2026 investigation found avoidable work in the account request path:

- Account endpoints resolved the account, then resolved it again through the workspace-context helper. This made two Supabase user-verification calls in one HTTP request.
- Normal authentication held a session row lock and database transaction open during the provider request. Concurrent tabs, reference images and other requests using the same cookie waited for that lock.
- Every request rewrote the profile and repeated office-owner bootstrap writes/checks, even when identity and privileges were unchanged.
- The event screen fetched its session and event list sequentially on every reload. Creating an event waited for both additional authenticated requests.
- Logged-in page startup fetched public sign-in configuration before loading the session and dashboard.

## Changes

Authentication results are shared only within a single `Request` using a `WeakMap`; every later HTTP request still verifies identity with Supabase. Ordinary validation reads the session and role metadata in one query and contacts the provider outside a database transaction. It synchronizes profiles/bootstrap roles only when needed. Workspace membership and suspension are still read on every authorized request.

Only token refresh takes the session row lock. It re-reads tokens after acquiring the lock, so concurrent requests reuse the first successful refresh rather than rotating an old refresh token again. Logout, expiration, recovery restrictions and provider identity checks remain enforced.

The event-list API returns its existing authorized workspace context with the list, avoiding a separate session fetch. Logged-in startup skips public sign-in configuration. Workspace tabs display a loading status while data arrives.

No data migration or cross-request authentication/authorization cache is introduced.

## Measurements and limits

Read-only probes from the developer machine observed approximately 18–19 ms for a warm database round trip and 17 ms for a dashboard-count query. The production public account-config endpoint took approximately 508–525 ms warm and 3.3 seconds for the first sample. These are small samples from one location, not production percentile metrics or authenticated dashboard timings.

The database pooler hostname identifies Singapore (`ap-southeast-1`). Netlify documents Ohio as its default compute region; the actual site's compute region was not independently verified. Cross-region round trips and function startup can add latency beyond the code bottlenecks. Region selection is a paid-plan feature, so this change leaves deployment-region settings alone. See [Netlify function configuration](https://docs.netlify.com/build/functions/configuration/).

Integration tests use an isolated local Postgres database and a mock authentication provider. They assert one user verification per account/dashboard request, concurrent verification for separate requests sharing a cookie, no profile rewrite on unchanged reads, and one refresh for simultaneous requests with expired access tokens. Existing tests continue to cover tenant isolation, removed-host access, workspace suspension, recovery and logout.

For later profiling, separate cold and warm requests and measure network durations for `/api/account/session`, `/api/account/dashboard`, and `/api/admin/events` in the browser. Test event creation separately from follow-up list/image/queue loads. Do not publish cookies, auth tokens, database URLs, reference images or prompt contents in diagnostics.
