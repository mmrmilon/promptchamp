create table promptchamp.profiles (
 id uuid primary key,
 email text not null unique,
 display_name text not null default '',
 created_at timestamptz not null default now()
);
create table promptchamp.platform_admins (
 user_id uuid primary key references promptchamp.profiles(id),
 created_at timestamptz not null default now()
);
create table promptchamp.workspaces (
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(name) between 2 and 80),
 timezone text not null default 'Asia/Kuala_Lumpur',
 default_mode text not null default 'demo' check(default_mode in ('demo','live')),
 default_duration integer not null default 120 check(default_duration in (120,180)),
 status text not null default 'active' check(status in ('active','suspended')),
 live_enabled boolean not null default false,
 monthly_generation_limit integer not null default 20 check(monthly_generation_limit between 0 and 10000),
 created_at timestamptz not null default now()
);
insert into promptchamp.workspaces(id,name,default_mode,live_enabled,monthly_generation_limit)
 values('00000000-0000-4000-8000-000000000001','IT Connect Office','live',true,100);
create table promptchamp.workspace_members (
 workspace_id uuid not null references promptchamp.workspaces(id),
 user_id uuid not null references promptchamp.profiles(id),
 role text not null check(role in ('owner','host')),
 created_at timestamptz not null default now(),
 primary key(workspace_id,user_id)
);
create table promptchamp.workspace_invites (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references promptchamp.workspaces(id),
 email text not null,
 token_hash text not null unique,
 expires_at timestamptz not null default now()+interval '7 days',
 accepted_at timestamptz,
 created_at timestamptz not null default now()
);
create table promptchamp.account_sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references promptchamp.profiles(id),
 token_hash text not null unique,
 provider_tokens text not null,
 purpose text not null default 'normal' check(purpose in ('normal','recovery')),
 workspace_id uuid references promptchamp.workspaces(id),
 expires_at timestamptz not null default now()+interval '14 days',
 created_at timestamptz not null default now()
);
create table promptchamp.platform_settings (
 id boolean primary key default true check(id),
 legacy_login_enabled boolean not null default true
);
insert into promptchamp.platform_settings(id) values(true);
create table promptchamp.workspace_audit (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid references promptchamp.workspaces(id),
 actor_id uuid references promptchamp.profiles(id),
 action text not null,
 details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
alter table promptchamp.events add column workspace_id uuid not null default '00000000-0000-4000-8000-000000000001' references promptchamp.workspaces(id);
alter table promptchamp.events add column mode text not null default 'live' check(mode in ('demo','live'));
alter table promptchamp.events add column discoverable boolean not null default false;
-- Preserve the original office landing page, while new customer events are
-- available only through their share link unless discovery is added later.
update promptchamp.events set discoverable=true where workspace_id='00000000-0000-4000-8000-000000000001';
create index events_workspace on promptchamp.events(workspace_id,created_at);
create index members_by_user on promptchamp.workspace_members(user_id);
create index invites_by_workspace on promptchamp.workspace_invites(workspace_id,email);

-- No public Data API grants are added. The trusted API validates provider
-- identity and workspace membership on every request. These policies also
-- support non-owner DB roles with a server-set request identity in the future.
create function promptchamp.can_access_workspace(w uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,promptchamp as $$
 select exists(select 1 from promptchamp.workspace_members where workspace_id=w
   and user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid)
 or exists(select 1 from promptchamp.platform_admins where user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid)
$$;
alter table promptchamp.profiles enable row level security;
alter table promptchamp.platform_admins enable row level security;
alter table promptchamp.workspaces enable row level security;
alter table promptchamp.workspace_members enable row level security;
alter table promptchamp.workspace_invites enable row level security;
alter table promptchamp.account_sessions enable row level security;
alter table promptchamp.platform_settings enable row level security;
alter table promptchamp.workspace_audit enable row level security;
create policy workspace_isolation on promptchamp.workspaces for select using(promptchamp.can_access_workspace(id));
create policy workspace_membership on promptchamp.workspace_members for select using(promptchamp.can_access_workspace(workspace_id));
create policy event_isolation on promptchamp.events for select using(promptchamp.can_access_workspace(workspace_id));
create policy reference_isolation on promptchamp.reference_images for select using(exists(select 1 from promptchamp.events e where e.id=event_id and promptchamp.can_access_workspace(e.workspace_id)));
