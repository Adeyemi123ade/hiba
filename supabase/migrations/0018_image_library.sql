-- H07 image library and image generation (HPD-58, 59, 61, 62, 108, 109).
-- Run in the Supabase SQL Editor after 0017. Safe to run more than once.
--
-- Every image the person uploads or has Hiba generate is kept in their Images library, in their own
-- private folder (bucket post-images, from 0008). Posts point at library images (posts.images, 0016).
-- Taking an image off a post keeps it in the library; deleting it from the library removes the file.

create table if not exists public.images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null unique
    check (path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  source text not null default 'upload' check (source in ('upload', 'generated')),
  -- What the person asked for, for generated images.
  prompt text check (char_length(prompt) <= 1000),
  -- Description for people using screen readers; copied onto a post when the image is added.
  alt text check (char_length(alt) <= 300),
  width int check (width between 1 and 10000),
  height int check (height between 1 and 10000),
  bytes int check (bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  -- The file must be in the owner's own folder.
  constraint images_path_owner check (split_part(path, '/', 1) = user_id::text)
);
create index if not exists images_user_created_idx on public.images (user_id, created_at desc);

alter table public.images enable row level security;
drop policy if exists "images_select_own" on public.images;
create policy "images_select_own" on public.images
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "images_insert_own" on public.images;
create policy "images_insert_own" on public.images
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "images_update_own" on public.images;
create policy "images_update_own" on public.images
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "images_delete_own" on public.images;
create policy "images_delete_own" on public.images
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Least privilege: only the description can change after saving.
revoke all on public.images from anon;
revoke update, truncate, references, trigger on public.images from authenticated;
grant select, insert, delete on public.images to authenticated;
grant update (alt) on public.images to authenticated;

-- Rate limit for image generation (each one costs money): a log people cannot edit or wipe.
create table if not exists public.image_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists image_requests_user_created_idx on public.image_requests (user_id, created_at desc);
alter table public.image_requests enable row level security;
drop policy if exists "image_requests_select_own" on public.image_requests;
create policy "image_requests_select_own" on public.image_requests
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "image_requests_insert_own" on public.image_requests;
create policy "image_requests_insert_own" on public.image_requests
  for insert to authenticated with check ((select auth.uid()) = user_id);
revoke all on public.image_requests from anon;
revoke update, delete, truncate, references, trigger on public.image_requests from authenticated;
grant select, insert on public.image_requests to authenticated;

-- Images already on posts become library images.
insert into public.images (user_id, path, source, alt)
select distinct on (e ->> 'path') p.user_id, e ->> 'path', 'upload', nullif(e ->> 'alt', '')
  from public.posts p, jsonb_array_elements(p.images) e
 where split_part(e ->> 'path', '/', 1) = p.user_id::text
on conflict (path) do nothing;
