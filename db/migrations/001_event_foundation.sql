create schema if not exists promptchamp;

create table if not exists promptchamp.events (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(title) between 3 and 100),
 slug text not null unique check(slug ~ '^[a-z0-9-]{3,100}$'),
 scheduled_at timestamptz not null,
 status text not null default 'draft' check(status in ('draft','registration','live','completed','archived')),
 generation_cap integer not null default 80 check(generation_cap between 1 and 10000),
 results_visibility text not null default 'held' check(results_visibility in ('held','released')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

-- Private references are bounded to 2 MiB for the setup release. Move bytes to
-- private object storage when adding generated-image persistence and jobs.
create table if not exists promptchamp.reference_images (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null unique references promptchamp.events(id),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 data text not null check(char_length(data) between 4 and 2796204),
 created_at timestamptz not null default now()
);

create table if not exists promptchamp.rounds (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references promptchamp.events(id),
 sequence integer not null default 1 check(sequence > 0),
 title text not null default 'Prompt challenge',
 duration_seconds integer not null check(duration_seconds in (120,180)),
 status text not null default 'draft' check(status in ('draft','ready','open','closed')),
 draw_locked_at timestamptz,
 unique(event_id,sequence), unique(id,event_id)
);

create table if not exists promptchamp.teams (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references promptchamp.events(id),
 name text not null check(char_length(name) between 2 and 50),
 name_key text generated always as (lower(btrim(name))) stored,
 recovery_code_hash text not null,
 status text not null default 'active' check(status in ('active','withdrawn','disqualified')),
 created_at timestamptz not null default now(),
 unique(event_id,name_key), unique(id,event_id)
);

create table if not exists promptchamp.team_sessions (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references promptchamp.teams(id),
 token_hash text not null unique,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);

create table if not exists promptchamp.round_entries (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references promptchamp.events(id),
 round_id uuid not null,
 team_id uuid not null,
 revision integer not null default 1 check(revision > 0),
 is_current boolean not null default true,
 lucky_number integer check(lucky_number > 0),
 queue_position integer check(queue_position > 0),
 state text not null default 'waiting' check(state in ('waiting','called','active','submitted','expired','completed','withdrawn')),
 started_at timestamptz,
 deadline_at timestamptz,
 draft_prompt text not null default '' check(char_length(draft_prompt) <= 1000),
 draft_version integer not null default 0,
 foreign key(round_id,event_id) references promptchamp.rounds(id,event_id),
 foreign key(team_id,event_id) references promptchamp.teams(id,event_id),
 unique(round_id,team_id,revision),
 check((started_at is null and deadline_at is null) or (started_at is not null and deadline_at is not null and deadline_at > started_at)),
 check(state <> 'active' or (started_at is not null and deadline_at is not null))
);
create unique index if not exists current_team_turn on promptchamp.round_entries(round_id,team_id) where is_current;
create unique index if not exists current_lucky_number on promptchamp.round_entries(round_id,lucky_number) where is_current;
create unique index if not exists active_round_turn on promptchamp.round_entries(round_id) where is_current and state in ('called','active');
alter table promptchamp.round_entries drop constraint if exists entry_time_pair;
alter table promptchamp.round_entries add constraint entry_time_pair check (
 (started_at is null and deadline_at is null) or
 (started_at is not null and deadline_at is not null and deadline_at > started_at)
);

create table if not exists promptchamp.audit_events (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references promptchamp.events(id),
 action text not null,
 actor text not null default 'host',
 metadata jsonb not null default '{}',
 created_at timestamptz not null default now()
);

alter table promptchamp.events enable row level security;
alter table promptchamp.reference_images enable row level security;
alter table promptchamp.rounds enable row level security;
alter table promptchamp.teams enable row level security;
alter table promptchamp.team_sessions enable row level security;
alter table promptchamp.round_entries enable row level security;
alter table promptchamp.audit_events enable row level security;
-- Only the trusted server database role accesses these tables. No browser grants.
revoke all on schema promptchamp from public;
