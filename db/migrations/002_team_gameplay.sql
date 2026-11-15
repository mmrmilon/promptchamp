alter table promptchamp.events add column if not exists team_capacity integer not null default 20 check(team_capacity between 1 and 100);
create table if not exists promptchamp.submissions (
 id uuid primary key default gen_random_uuid(),
 entry_id uuid not null unique references promptchamp.round_entries(id),
 event_id uuid not null references promptchamp.events(id),
 request_id uuid not null,
 prompt text not null check(char_length(prompt) between 5 and 1000),
 accepted_at timestamptz not null default clock_timestamp(),
 status text not null default 'queued' check(status in ('queued','generating','generation_failed','judging','judge_failed','scored','needs_review','voided')),
 unique(event_id,request_id)
);
alter table promptchamp.submissions enable row level security;
create unique index if not exists entry_event_identity on promptchamp.round_entries(id,event_id);
alter table promptchamp.submissions drop constraint if exists submission_entry_event;
alter table promptchamp.submissions add constraint submission_entry_event foreign key(entry_id,event_id) references promptchamp.round_entries(id,event_id);
create index if not exists team_event_sessions on promptchamp.team_sessions(team_id,expires_at);
create index if not exists round_queue on promptchamp.round_entries(round_id,queue_position) where is_current;
