-- Existing events and their one-image API remain shared by default.
alter table promptchamp.events add column reference_mode text not null default 'shared'
 check(reference_mode in ('shared','random_unique'));
create table promptchamp.reference_pool_images (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references promptchamp.events(id) on delete cascade,
 label text not null check(char_length(label) between 1 and 100),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 data text not null check(char_length(data) between 4 and 2796204),
 image_hash text not null,
 created_at timestamptz not null default now(),
 unique(event_id,image_hash),unique(id,event_id)
);
alter table promptchamp.reference_pool_images enable row level security;
create policy pool_workspace_isolation on promptchamp.reference_pool_images for select using
 (exists(select 1 from promptchamp.events e where e.id=event_id and promptchamp.can_access_workspace(e.workspace_id)));
alter table promptchamp.round_entries add column reference_image_id uuid;
alter table promptchamp.round_entries add constraint assigned_reference_event
 foreign key(reference_image_id,event_id) references promptchamp.reference_pool_images(id,event_id);
create unique index unique_round_reference on promptchamp.round_entries(round_id,reference_image_id)
 where reference_image_id is not null and is_current;
