# PromptChamp: Office IT Connect event design

Status: event foundation, host setup, registration, lucky-number draw, queue controls, timed turns, and prompt acceptance implemented. The separate `promptchamp` schema is installed in Supabase. Live AI processing and result publication are implemented. Image object storage, per-person host accounts, and technical turn restarts remain future work. See [host setup](host-setup.md) for the implemented scope.

Application name: **PromptChamp**. Monthly office event: **IT Connect**. Individual event titles can vary, e.g. "IT Connect - December Prompt Challenge".

## Confirmed experience

The office runs IT Connect monthly. The hosting team creates a Prompt Match event; other teams participate using one shared team entry. A team enters its name, chooses an available lucky number, waits for its turn, and recreates a reference image by writing a prompt. Every team in the same round sees the same reference image. The lucky number determines playing order, not image assignment. Each team has its own timer; the host configures the duration, normally 120 or 180 seconds.

Recommended first release: one round, one reference image, one submitted prompt per team, one generation, and a score out of 100. The schema supports additional rounds later without requiring three challenges or a wildcard. The app remains focused on Prompt Match; quiz and question-answering engines are outside this release.

### Participant flow

1. Open the event link and enter the event join code, if enabled.
2. Enter the team name. The server creates a team session and provides a private recovery code.
3. Choose an available lucky number. The server atomically claims it for that team.
4. See the queue, own position, and event rules. No reference image is shown yet.
5. The host closes the draw, freezing the queue in ascending lucky-number order, and calls the first team.
6. The called team sees a Ready screen with the duration and presses Start. The server records the start and deadline and authorizes access to the reference image.
7. Study the reference and write the prompt. A visible countdown shows server-derived time remaining. Drafts are saved and restored after refresh.
8. Submit before the deadline. Submission locks the prompt and shows generation/scoring progress. The timer no longer matters after an accepted submission.
9. See the reference, generated image, match score, category ratings, and feedback when results are released.
10. The host advances the queue after a submission is accepted or the turn expires. AI processing for the previous team may continue within the worker's concurrency limit.

The image becomes available when the server accepts Start; loading failures should be reported to the host. An audited restart with a full new timer is the recovery mechanism. Refreshing, changing devices, or opening another tab never resets the deadline.

### Host flow

1. Sign in and create a monthly event from a blank form or by copying a previous event's settings.
2. Set title, date, registration window, turn duration, join policy, reference image, scoring rubric, generation cap, and result visibility.
3. Preview and rehearse in a separate test event.
4. Publish registration, share a link/QR code, and monitor teams and number selection.
5. Close registration and freeze the draw. Resolve missing numbers and remove accidental duplicates before starting.
6. Open the round, call teams in queue order, and monitor countdowns and processing status.
7. Retry failed scoring on the existing image; authorize a technical restart when needed, with a reason.
8. Finish pending scoring, publish final results, show a presentation leaderboard, export results, and archive the event.

## Database design

Use Supabase Postgres for durable records and private object storage for reference/generated images. All tables use UUID primary keys, foreign keys, and UTC `timestamptz` timestamps. The UI displays Malaysia time. An event is a reusable monthly container, rather than a global application environment setting.

| Table | Main fields | Purpose and constraints |
| --- | --- | --- |
| `events` | `id`, `slug`, `title`, `description`, `timezone`, `scheduled_at`, `registration_opens_at`, `registration_closes_at`, `status`, `join_code_hash`, `generation_cap`, `results_visibility`, `retention_days`, `created_by`, timestamps | Monthly event. Status: draft, registration, live, completed, archived. Unique slug; positive cap; valid registration window. No event is required to run for a week. |
| `event_admins` | `event_id`, `user_id`, `role` | Host authorization. Unique `(event_id, user_id)`; user ID references authenticated admin identity. Role: owner or host. |
| `rounds` | `id`, `event_id`, `title`, `sequence`, `duration_seconds`, `reference_asset_id`, `rubric`, `rubric_version`, `generation_settings`, `judge_settings`, `status`, `draw_locked_at`, `current_entry_id`, timestamps | Same image and fixed scoring/model settings for every team in a round. Unique `(event_id, sequence)`; duration restricted to approved values, initially 120 or 180. Status: draft, ready, open, closed. Freeze image, timer, and rubric before opening. |
| `assets` | `id`, `event_id`, `object_key`, `kind`, `mime_type`, `byte_size`, `width`, `height`, `sha256`, `created_at`, `expires_at`, `deleted_at` | Metadata for private images. Kind: reference or generated. No base64 blobs in competition tables. Access is authorized server-side; cleanup can remove objects while retaining score records. |
| `teams` | `id`, `event_id`, `name`, `name_key`, `recovery_code_hash`, `status`, timestamps | One participating team per event. Unique normalized `(event_id, name_key)`; require a sensible name length, e.g. 2–50 characters. Status: active, withdrawn, disqualified. Original name is retained for display. |
| `team_sessions` | `id`, `team_id`, `token_hash`, `expires_at`, `revoked_at`, `created_at` | Recoverable team login. Store hashes of high-entropy tokens, never raw recovery codes/session tokens. Session cookie is HttpOnly and Secure in production. |
| `round_entries` | `id`, `event_id`, `round_id`, `team_id`, `lucky_number`, `queue_position`, `revision`, `is_current`, `state`, `called_at`, `started_at`, `deadline_at`, `draft_prompt`, `draft_version`, `submission_id`, `created_at` | One current team turn per round, with previous revisions retained after technical restarts. Unique `(round_id, team_id, revision)`; partial unique indexes on current `(round_id, team_id)` and `(round_id, lucky_number)` for chosen values. The draw freezes queue positions; entries cannot pick another number afterward. State: waiting, called, active, submitted, expired, completed, withdrawn. |
| `submissions` | `id`, `event_id`, `entry_id`, `request_id`, `prompt`, `accepted_at`, `status`, `generated_asset_id`, `active_evaluation_id`, `created_at`, `updated_at` | Immutable accepted prompt. Unique entry for the first release; unique request ID within the team/event scope. Status: queued, generating, generation_failed, judging, judge_failed, scored, needs_review, voided. No score is assigned to an expired or technically failed entry. |
| `evaluations` | `id`, `submission_id`, `judge_model`, `rubric_version`, `ratings`, `score`, `tip`, `status`, `created_at`, `review_reason` | Preserve scoring history instead of overwriting it on a retry/review. Five validated integer ratings, each 0–5; score 0–100 computed by application weights. One evaluation is designated active for leaderboard use. |
| `processing_jobs` | `id`, `event_id`, `submission_id`, `kind`, `state`, `attempt_count`, `available_at`, `lease_until`, `lease_token`, `provider_request_id`, `error_code`, timestamps | Durable generation and judging work. Kind: generate or judge. Use bounded retries, a unique active job per submission/kind, and lease-token checks to prevent stale workers overwriting results. |
| `provider_requests` | `id`, `event_id`, `submission_id`, `job_id`, `kind`, `request_key`, `status`, `reserved_at`, `completed_at` | Auditable external-call budget. Generation reservations count toward the event cap even if calls fail or completion is uncertain. Every authorized new generation call needs a reservation. Judging retries do not consume a generation reservation. |
| `audit_events` | `id`, `event_id`, `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `reason`, `metadata`, `created_at` | Record host changes, technical restarts, queue overrides, disqualifications, score reviews, and final publication. Exclude secrets and image bytes. |

### Required integrity rules

- Enforce event consistency using composite foreign keys: an entry's round and team must belong to its event; assets must belong to the round/submission's event. Do not trust an event ID supplied by the browser.
- Use partial unique indexes where appropriate so there is at most one called/active entry per round and one active job per submission/kind. Acquire a round row lock when calling/starting/advancing turns.
- Validate timestamp combinations: active entries need start/deadline; deadline must be after start; accepted submission time must be before deadline.
- The submission transaction uses the database clock, locks the entry, verifies eligibility, creates the immutable submission and generation job, and updates the entry together. A duplicate request returns the existing submission even if its deadline has since passed.
- Reserve generation quota atomically immediately before dispatch, under an event lock; count all reservations, including uncertain results. Before accepting a submission, atomically reserve its budget slot so the UI cannot promise processing after the cap is exhausted. Workers use that reservation for the first call; any further host-authorized call requires another one.
- A technical restart voids the original turn/submission with an audit record and grants a new explicit turn revision. Use the entry revision fields and current-entry indexes to preserve history; the lucky number and queue position remain stable.
- Draft saves require an increasing version and an active turn before the deadline. Save conflicts return the authoritative version; old browser tabs cannot overwrite newer drafts.
- Never rely on `CHECK` constraints for current-time eligibility; enforce deadline checks inside the transaction using the database clock.
- Reject queue/round mutations once completed except through explicit audited administrative operations.

Suggested indexes: teams by event/name; entries by round/queue and round/state; submissions by event/status; jobs by state/available time; requests by event/kind; audit records by event/created time.

### Access controls

Enable RLS on application tables and deny anonymous direct access. Team API routes validate the team session and return only authorized fields. Administrative APIs validate the authenticated host and membership in `event_admins` for the requested event. A team name, lucky number, event join code, or hidden admin URL is not administrator authentication.

References and generated images live in private storage. Before a turn starts, the API must not return the reference object path, signed image URL, rubric hints, or original reference prompt. Authorized image URLs have short expiry. The leaderboard never includes session identifiers, recovery codes, or unreleased reference URLs. Admin pages must not expose database or AI credentials.

## Application architecture

Keep the existing TypeScript frontend and backend, but separate HTTP routing, event rules, persistence, and AI calls. Supabase supplies Postgres and private image storage. Image generation and judging remain replaceable integrations behind application-owned interfaces.

```text
Team UI / Host UI / Presentation leaderboard
                    |
               HTTP API
                    |
   Session and admin authorization
                    |
 Event / Queue / Turn / Submission / Ranking services
              |                    |
       PostgreSQL             Private image storage
              |
      Durable processing jobs
              |
      Background job runner
       |                 |
 Image generation    Image judging
```

### Proposed filenames

```text
src/
  pages/
    event.ts
    team-registration.ts
    lucky-draw.ts
    waiting-room.ts
    challenge.ts
    results.ts
    leaderboard.ts
    admin.ts
  components/
    countdown.ts
    image-comparison.ts
    team-queue.ts
  shared/
    types.ts
    scoring.ts
server/
  app.ts
  routes/
    events.ts
    teams.ts
    turns.ts
    submissions.ts
    leaderboard.ts
    admin.ts
  services/
    event-service.ts
    queue-service.ts
    turn-service.ts
    submission-service.ts
    scoring-service.ts
  integrations/
    image-generation.ts
    image-judging.ts
    asset-storage.ts
  database.ts
  sessions.ts
  jobs/
    worker.ts
    generate-image.ts
    score-image.ts
    expire-turns.ts
db/
  migrations/
    001_event_foundation.sql
    002_team_turns.sql
    003_submissions_and_jobs.sql
    004_access_policies.sql
```

Application filenames describe responsibilities, not hosting or AI vendors. The existing generation and judge implementations now use `image-generation.ts` and `image-judging.ts`. The current provider-named deployment directory is an adapter concern: keep any platform-required configuration outside domain code. No hosting migration is required for this event redesign, and no deployment provider is assumed by the service layer.

### API boundaries

| Endpoint | Responsibility |
| --- | --- |
| `GET /api/events/:slug` | Public event summary and rules; no unrevealed image |
| `POST /api/events/:id/teams` | Validate registration and create a team/session |
| `POST /api/team/session` | Recover a team using its private recovery code |
| `GET /api/team/state` | Return team, queue, turn, submission, deadline, and server time |
| `POST /api/rounds/:id/lucky-number` | Atomically claim an available number |
| `POST /api/entries/:id/start` | Idempotently start the called team's timer and reveal the image |
| `PUT /api/entries/:id/draft` | Save a versioned prompt while the turn is active |
| `POST /api/entries/:id/submit` | Atomically accept a prompt and queue processing |
| `GET /api/submissions/:id` | Return authorized processing/result state |
| `GET /api/events/:id/leaderboard` | Return released leaderboard fields only |
| `POST /api/admin/events` | Create an event |
| `PATCH /api/admin/events/:id` | Update allowed settings in valid event states |
| `POST /api/admin/rounds/:id/lock-draw` | Freeze ascending lucky-number order |
| `POST /api/admin/rounds/:id/call-next` | Atomically call the next eligible team |
| `POST /api/admin/entries/:id/restart` | Authorize an audited technical restart/revision |
| `POST /api/admin/submissions/:id/retry-scoring` | Reuse the generated image for judging |
| `POST /api/admin/events/:id/publish-results` | Finalize and release results after pending work is resolved |

The backend enforces every state transition. Client button disabling is convenience only. On Start, respond with `server_now`, `started_at`, and `deadline_at`. The frontend estimates server offset and resynchronizes on focus/reconnect. Submission acceptance uses database time, not the browser's displayed counter.

### Background processing and failure handling

The submit endpoint returns promptly with a submission ID, rather than waiting for two AI services. A worker atomically claims a job, generates an image, uploads it, and creates a judging job. Judging stores a validated evaluation and updates the active result. Participants poll status initially; realtime notifications can be added later without changing timing authority.

Start with a small configurable worker concurrency, normally one generation and one judging call at a time. A real background runner/managed queue must be provisioned; an unawaited promise inside an HTTP handler is not durable background execution. A database jobs table alone does not run jobs.

Judging failures can be retried using the same stored image, including after the team timer ends. Generation calls with an unknown outcome must not be blindly repeated: external AI APIs may not offer idempotency. Mark uncertain calls for host review, preserve their consumed reservation, and require explicit authorization for a replacement call. Deterministic object keys per submission and job lease checks reduce duplicate processing but cannot guarantee exactly-once external generation.

## Functionality and event rules

### Timer and submission

- The host sets 120 or 180 seconds for the round before it opens. Each team's deadline is persisted individually.
- Pressing Start is allowed only for the currently called team; repeated Start requests return the original times.
- The server must receive a valid submission before `deadline_at`. The UI tells teams that network delivery must finish before time runs out.
- Submit early is allowed and final. No editing or regeneration for prompt improvement in the first release.
- At expiry, disable editing and mark unsubmitted entries expired. Do not silently auto-submit an unfinished prompt. Server-side deadline checks apply even if the expiry worker is delayed.
- There is no pause button in the first release. Technical recovery uses an audited restart, not manual browser timer edits.
- Draft recovery helps after refresh but does not extend time. A lost connection near expiry is handled by the host's published technical-incident policy.

### Lucky number and queue

- Teams choose one number from an admin-configured pool. For an event with N teams, 1 through N is a simple default.
- Numbers are unique within a round. Concurrent claims for the same number produce one winner; the other team chooses another number.
- Changing a number is allowed only before the host locks the draw; afterward, only the host can override order with an audit reason.
- Freeze queue positions by ascending selected number; gaps do not block progress. The host can skip an absent team and recall it later with the action recorded.
- Every team sees the same reference image for that round. Numbers never choose a different image.

### Scoring and leaderboard

Keep the current five categories and weights: main subject 30%, setting and objects 25%, composition 20%, lighting and color 15%, visual style 10%. Compute `round(sum(weight * rating / 5))` in application code after validating the judge response.

Describe the result as an AI-assessed visual match score, not a scientifically exact pixel similarity percentage. Fix the model, rubric, and generation settings for the round; the judge evaluates the reference and generated image, not the quality of the written prompt. Team names are not sent to the judge.

One round ranks by its active valid score out of 100. Equal scores share a rank; prompt submission speed is not a tie-breaker. If a winner must be unique, use a separate host-run tie-break round. For future multi-round events, sum one valid score per required round and mark incomplete teams separately, rather than treating technical failures as zero scores.

Recommended visibility: the team can see its own result, but the public presentation screen hides prompts and generated images until every team has finished. The host can hold all results until a final reveal. Final publication requires pending jobs to finish or be explicitly resolved; later score review reopens publication with an audit trail.

### Fairness for sequential teams

Because teams play sequentially against the same reference, later teams may observe the image, prompts, or discussion from earlier turns. Access control cannot prevent people sharing screens or talking. Keep the reference off the projector, waiting room, and public leaderboard; seat waiting teams away from active screens. The host should decide and announce whether informal prior exposure is acceptable. If equal first exposure is essential, a simultaneous-start format would be needed; it is not the selected mode here.

### Host dashboard

- Event settings and draft/published/live/archive status.
- Team registrations and recovery-code rotation.
- Lucky-number pool, frozen queue, call/skip/recall controls.
- Current team's turn status and server-derived countdown.
- Generation/scoring progress and failed/uncertain jobs.
- Event budget reservations, remaining allowance, and processing backlog.
- Audited technical restart and scoring retry controls.
- Result release, fullscreen leaderboard, CSV export, archive/copy event.

### Monthly reuse

Copy an archived event's rules, image configuration, and rubric into a new draft. Do not copy team sessions, submissions, lucky numbers, scores, or consumed quota. Each monthly event has a separate leaderboard and generation budget. Retain results according to the office policy; expire generated images on a configurable schedule, with a proposed 30-day default.

## Configuration changes

Infrastructure secrets stay in server-side environment variables: database connection, AI credentials, session signing secret, private asset storage credentials, and admin authentication settings. Event dates, per-team duration, reference images, registration policy, generation caps, and result visibility move into event/round rows and are editable through the host UI. `APP_MODE` may continue to distinguish isolated demo and live execution, but it must not define a single global event's dates.

## Implementation sequence

1. Introduce event/round/team tables and access policies in an isolated rehearsal database. Keep the old player/attempt tables intact until data migration or retirement is explicitly chosen.
2. Create admin authentication, host event setup, and private reference image uploads.
3. Build registration, team sessions, lucky-number claims, frozen queue, and host call-next controls.
4. Implement atomic Start/Submit, server-authoritative timers, draft recovery, and expiry.
5. Add persistent submissions, object storage, durable workers, external-call reservations, and evaluation history around the existing AI integrations.
6. Replace the fixed gallery with event/team screens; add result visibility and a presentation leaderboard.
7. Rehearse with at least two teams and exercise deadline races, duplicate submissions, number conflicts, refresh/recovery, unauthorized access, AI timeouts, budget exhaustion, and technical restarts.
8. Deploy the rehearsed version, create the real event, and share its registration link.

This redesign is larger than setting a session secret and two dates. Implement the event model before switching the current application into the real office event's live mode.
