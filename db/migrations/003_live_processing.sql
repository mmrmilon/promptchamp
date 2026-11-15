alter table promptchamp.submissions add column if not exists score integer check(score between 0 and 100);
alter table promptchamp.submissions add column if not exists ratings jsonb;
alter table promptchamp.submissions add column if not exists tip text;
alter table promptchamp.submissions add column if not exists generated_data text;
alter table promptchamp.submissions add column if not exists generated_mime text;
alter table promptchamp.submissions add column if not exists image_expires_at timestamptz;
alter table promptchamp.submissions add column if not exists updated_at timestamptz not null default now();
create table if not exists promptchamp.processing_jobs (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references promptchamp.submissions(id),
 kind text not null check(kind in ('generate','judge')),
 state text not null default 'queued' check(state in ('queued','running','succeeded','failed','needs_review')),
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists active_processing_job on promptchamp.processing_jobs(submission_id,kind) where state in ('queued','running');
create table if not exists promptchamp.generation_reservations (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references promptchamp.events(id),
 submission_id uuid not null references promptchamp.submissions(id),
 job_id uuid not null unique references promptchamp.processing_jobs(id),
 created_at timestamptz not null default now()
);
create index if not exists event_generation_usage on promptchamp.generation_reservations(event_id);
create table if not exists promptchamp.evaluations (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references promptchamp.submissions(id),
 model text not null,
 rubric_version text not null,
 score integer not null check(score between 0 and 100),
 ratings jsonb not null,
 tip text not null,
 created_at timestamptz not null default now()
);
create table if not exists promptchamp.worker_heartbeats (
 id uuid primary key,
 last_seen timestamptz not null default clock_timestamp()
);
alter table promptchamp.processing_jobs enable row level security;
alter table promptchamp.generation_reservations enable row level security;
alter table promptchamp.evaluations enable row level security;
alter table promptchamp.worker_heartbeats enable row level security;
-- Earlier rehearsals must not silently start billable calls on upgrade.
update promptchamp.submissions s set status='needs_review' where status='queued'
 and not exists(select 1 from promptchamp.processing_jobs j where j.submission_id=s.id);
