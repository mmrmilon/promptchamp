# Accounts, workspaces, and administrator setup

PromptChamp now uses verified Supabase email/password accounts for workspace administration. Participating teams still use event links and their own recovery codes.

## Configure authentication

Set these values in local `.env` for development and GitHub's `production` Environment secrets for deployment. CI/CD synchronizes them to Netlify with production Functions scope; see [ci-cd.md](ci-cd.md). `PUBLIC_APP_URL` belongs in GitHub Environment variables instead of secrets.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | The project's HTTPS URL from Supabase Connect, not the Postgres connection string |
| `SUPABASE_PUBLISHABLE_KEY` | The publishable key from that same project; the legacy `SUPABASE_ANON_KEY` is also supported |
| `PLATFORM_OWNER_EMAIL` | The exact address you will verify and use for the initial platform-admin account |
| `SESSION_SECRET` | Existing server secret, retained to encrypt provider tokens and sign processing requests |
| `PUBLIC_APP_URL` | Optional canonical application URL. Netlify's built-in `URL` is used when absent |

The publishable key and project URL are not private API credentials, but this implementation keeps provider calls on the server. Do not supply the Supabase secret/service-role key. GitHub's `PRODUCTION_DATABASE_URL` supplies migrations and runtime `DATABASE_URL`; the workflow copies all required runtime settings, so no manual Netlify duplication is needed.

In Supabase Authentication, enable email/password login and email confirmation. Set the Site URL to the published PromptChamp site and allow its `/admin.html` redirect URL (and `http://localhost:5173/admin.html` for local use). Configure custom SMTP for verification and password-reset delivery before opening public registration. Supabase's built-in sender is restricted and is not a production mail service. Gmail may be used as the user's login address; it is separate from the SMTP sender.

Password reset links return to `/admin.html?recovery=1`. Allow that redirect as well. Keep Supabase's default email templates using the confirmation URL, or preserve the equivalent provider verification link when customizing templates. The application consumes a recovery session from the URL fragment, immediately removes the fragment, and requires a new password before opening the dashboard. Tokens are never kept in localStorage.

Reference: [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Claim the existing office workspace

1. Configure the values above in GitHub's production environment and deploy through GitHub Actions.
2. Keep `ADMIN_ACCESS_KEY` during the transition. Existing key login is restricted to the reserved office workspace.
3. Register using the exact `PLATFORM_OWNER_EMAIL`, confirm the email, and sign in.
4. The verified account is granted the initial platform role and ownership of **IT Connect Office**. Existing events, reference images, teams, and scores remain in that workspace.
5. The shared-key login is automatically disabled in the database when ownership is claimed. Existing shared-key cookies stop granting access too. After verifying account access, remove `ADMIN_ACCESS_KEY` from deployment variables.

Do not change `PLATFORM_OWNER_EMAIL` casually: any verified account matching the configured address can receive the bootstrap platform role. Platform privileges cannot be requested through registration, profile metadata, or a workspace settings form. `ALLOW_LEGACY_HOST_LOGIN=false` can explicitly disable the transition login earlier, but only do that once account access is usable.

## Roles and customer onboarding

- **Platform admin:** manage workspace availability, approve live AI access, set monthly image allowances, and inspect workspace counts. Initially assigned only through the trusted bootstrap address.
- **Workspace owner:** manage their own workspace settings and members, create and operate events, use the reference library, and export results.
- **Event host:** create and operate events inside an invited workspace. Hosts cannot change workspace settings, invite/remove members, or grant live access.

Other verified registrations create their own demo workspace. A user can own up to five workspaces. The selected workspace is stored in the server-side session, and every admin request checks current membership; knowing an event UUID or changing a browser URL does not grant access.

Owners invite hosts by email from Members. This release creates a private seven-day invitation link for the owner to share. It does not send invitation emails automatically. The recipient registers/verifies their own account, reopens the link if necessary, and accepts while signed in as the invited email. Invitations cannot be reused. Removing a host removes access on subsequent requests.

Customer events are unlisted by default: participants use the share link, and customer event names are not enumerated on the global public homepage. Participant links themselves are public bearer links, not corporate SSO. Original office events keep their previous discovery setting.

## Demo, live, and usage

Mode is a single choice on each event, with a workspace default. It is frozen after a team registers. Demo submissions use a labeled reference sample and deterministic simulated category scores; they issue no provider requests and consume no AI allowance. Live events call the configured image generator and judge. Their results cannot be mixed into another event's leaderboard.

New workspaces start with demo access. Platform admins manually approve live access and set a monthly generation allowance. Event budgets and workspace allowances are both enforced transactionally, including concurrent events. Quota follows UTC calendar months and includes failed/uncertain generation reservations. Scoring retries reuse an image. Suspending a workspace blocks its dashboard for ordinary members, new participation mutations, and live provider processing.

Workspace name/branding, timezone, default mode, and default 2- or 3-minute timer are available in Settings. Changes apply to new events. Draft events can reuse an existing workspace reference, be duplicated without teams/results, or be archived when unused; completed events can also be archived. Results export as CSV.

Subscription billing and payments are not active in this release. Manual approval and quotas are the foundation for later plans and entitlements. No registration is represented as a paid subscription.

## Security and storage

Supabase verifies passwords and email ownership. The application verifies the provider's user endpoint on account requests, refreshes expired provider sessions, and encrypts provider tokens at rest using AES-256-GCM. Browser cookies contain only random opaque session identifiers, with HttpOnly, SameSite, and Secure on HTTPS. Rotating `SESSION_SECRET` invalidates encrypted sessions and requires users to sign in again.

The database migration adds profiles, platform roles, workspaces, memberships, invitations, encrypted sessions, and workspace audit records. The existing office events are assigned to the reserved workspace. Private `promptchamp` tables are not granted to browser Data API roles. The current privileged backend explicitly scopes administration by workspace; additional RLS read policies are tested with a non-owner database role and server-set identity. Do not expose this schema or grant browser access without adding and reviewing the corresponding policies.

CI uses a local mock authentication provider, not real Supabase accounts or email. Tests cover unverified-email rejection, platform-role bootstrap, session encryption, logout/refresh/recovery, customer isolation, invitation restrictions, host removal, suspension, demo quota isolation, monthly quota races, and RLS. Real verification-email delivery still depends on your SMTP setup.
