-- Download my data by email (HPD-159). Owner decisions, 24 Nov 2026:
--   * The copy goes to the person's own sign-in email only, never to another address.
--   * The email holds a private link that works for 7 days. After that the file is deleted.
--
-- The app builds the ZIP and uploads it to the private bucket below, in the person's own folder.
-- The send-my-data function checks the email, makes the 7-day link, emails it and records it here.
--
-- Run in the Supabase SQL Editor after 0023. Safe to run more than once.

-- Private bucket, one folder per person. 50 MB is the largest file the Supabase free plan accepts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('data-exports', 'data-exports', false, 52428800, array['application/zip'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- People may add files to, and remove files from, their own folder only. They never need to read
-- them back: the link in the email is made by the function.
drop policy if exists "data_exports_insert_own" on storage.objects;
create policy "data_exports_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'data-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "data_exports_select_own" on storage.objects;
create policy "data_exports_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'data-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "data_exports_delete_own" on storage.objects;
create policy "data_exports_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'data-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- One row per emailed copy: used for the daily limit and to delete files once their link expires.
-- Only the send-my-data function (service role) reads or writes it.
create table if not exists public.data_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  removed_at timestamptz
);
create index if not exists data_exports_user_created_idx on public.data_exports (user_id, created_at desc);
create index if not exists data_exports_expires_idx on public.data_exports (expires_at) where removed_at is null;

alter table public.data_exports enable row level security;
-- No policies: the app cannot read or change it.
revoke all on public.data_exports from anon, authenticated;
