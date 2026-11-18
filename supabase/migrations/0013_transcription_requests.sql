-- Voice transcription (owner request, 18 Nov 2026): a usage log so each person can only send a
-- limited number of recordings per hour to the transcription service. No audio or text is stored.
-- Run in the Supabase SQL Editor. Does not depend on 0009 to 0012. Safe to run more than once.

create table if not exists public.transcription_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists transcription_requests_user_created_idx
  on public.transcription_requests (user_id, created_at desc);

alter table public.transcription_requests enable row level security;

drop policy if exists "transcription_requests_select_own" on public.transcription_requests;
create policy "transcription_requests_select_own" on public.transcription_requests
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "transcription_requests_insert_own" on public.transcription_requests;
create policy "transcription_requests_insert_own" on public.transcription_requests
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- The log can be added to and counted, never changed or wiped by the app.
revoke all on public.transcription_requests from anon;
revoke update, delete, truncate, references, trigger on public.transcription_requests from authenticated;
