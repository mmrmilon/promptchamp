create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  invite_hash text not null unique,
  display_name text check (char_length(display_name) between 2 and 28)
);

create table if not exists attempts (
  id uuid primary key,
  player_id uuid not null references players(id),
  challenge_id text not null check (challenge_id in ('falls','alpine','desert')),
  status text not null check (status in ('generating','judging','judge_failed','scored','generation_failed')),
  wildcard boolean not null,
  prompt text not null check (char_length(prompt) between 5 and 500),
  score integer check (score between 0 and 100),
  ratings jsonb,
  tip text,
  image_data text,
  image_mime text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attempts_player_round on attempts(player_id, challenge_id, status);

-- Serializes quota reservations in this pilot. No provider call occurs inside this transaction.
create or replace function reserve_attempt(
  p_id uuid, p_player uuid, p_challenge text, p_prompt text, p_cap integer,
  p_start timestamptz, p_end timestamptz
) returns text language plpgsql as $$
declare
  n_scored integer;
  use_wildcard boolean;
begin
  perform pg_advisory_xact_lock(947461);
  if exists(select 1 from attempts where id = p_id and player_id = p_player) then return 'duplicate'; end if;
  if exists(select 1 from attempts where id = p_id) then return 'conflict'; end if;
  if clock_timestamp() < p_start or clock_timestamp() >= p_end then return 'closed'; end if;
  if (select count(*) from attempts) >= p_cap then return 'cap'; end if;
  if (select count(*) from attempts where player_id = p_player) >= 4 then return 'limit'; end if;
  if exists(select 1 from attempts where player_id = p_player
            and status in ('generating','judging','judge_failed')) then return 'pending'; end if;
  select count(distinct challenge_id) into n_scored from attempts where player_id = p_player and status = 'scored';
  use_wildcard := exists(select 1 from attempts where player_id = p_player
                        and challenge_id = p_challenge and status = 'scored');
  if use_wildcard and n_scored < 3 then return 'locked'; end if;
  if use_wildcard and exists(select 1 from attempts where player_id = p_player and wildcard) then return 'limit'; end if;
  insert into attempts(id,player_id,challenge_id,status,wildcard,prompt)
    values(p_id,p_player,p_challenge,'generating',use_wildcard,p_prompt);
  return 'reserved';
end $$;
