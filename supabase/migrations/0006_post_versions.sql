-- HPD-50: keep every version of a post, so regenerating never silently overwrites earlier text.
-- Run in the Supabase SQL editor after 0005.

create table if not exists public.post_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  title text check (char_length(title) <= 200),
  body text not null check (char_length(body) <= 20000),
  -- 'ai' = written by Hiba, 'edit' = the person's own edited text saved before it was replaced.
  source text not null default 'ai' check (source in ('ai', 'edit')),
  -- What the person asked Hiba to change, when the version came from "Write it again".
  guidance text check (char_length(guidance) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists post_versions_post_created_idx on public.post_versions (post_id, created_at desc);

-- A version must belong to a post owned by the same person.
create or replace function public.post_versions_check_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.posts p where p.id = new.post_id and p.user_id = new.user_id) then
    raise exception 'post does not belong to this user';
  end if;
  return new;
end $$;

drop trigger if exists post_versions_check_owner on public.post_versions;
create trigger post_versions_check_owner before insert on public.post_versions
  for each row execute function public.post_versions_check_owner();

alter table public.post_versions enable row level security;

drop policy if exists "post_versions_select_own" on public.post_versions;
create policy "post_versions_select_own" on public.post_versions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "post_versions_insert_own" on public.post_versions;
create policy "post_versions_insert_own" on public.post_versions
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Versions are history: they can be added and read, never changed or deleted by the app.
revoke all on public.post_versions from anon;
revoke update, delete, truncate, references, trigger on public.post_versions from authenticated;

-- Keep the first version of drafts that already exist, so they have history too.
insert into public.post_versions (user_id, post_id, title, body, source, created_at)
select p.user_id, p.id, p.title, p.body, 'ai', p.created_at
from public.posts p
where p.body <> ''
  and not exists (select 1 from public.post_versions v where v.post_id = p.id);
