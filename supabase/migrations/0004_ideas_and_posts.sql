-- Hiba: ideas the user captures, and the post drafts made from them.
-- Run in the Supabase SQL editor (or `supabase db push`) after 0001 to 0003.

-- An idea is what the user said or typed. It is saved before any drafting,
-- so a failed draft never loses the user's words.
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  source text not null default 'typed' check (source in ('typed', 'voice')),
  created_at timestamptz not null default now()
);

create index if not exists ideas_user_created_idx on public.ideas (user_id, created_at desc);

-- One draft per platform per idea.
-- status: draft (waiting for the user), approved (ready, not yet scheduled),
-- scheduled (has a time), published, failed.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  idea_id uuid not null references public.ideas (id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'x', 'substack')),
  title text check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 20000),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'scheduled', 'published', 'failed')),
  scheduled_for timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idea_id, platform)
);

create index if not exists posts_user_status_idx on public.posts (user_id, status, scheduled_for);

create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_updated_at();

-- A post must belong to an idea owned by the same user.
create or replace function public.posts_check_idea_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.ideas i where i.id = new.idea_id and i.user_id = new.user_id) then
    raise exception 'idea does not belong to this user';
  end if;
  return new;
end $$;

create trigger posts_check_idea_owner before insert or update of idea_id, user_id on public.posts
  for each row execute function public.posts_check_idea_owner();

-- Every drafting request, used to rate limit the AI function per user.
create table if not exists public.draft_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  idea_id uuid references public.ideas (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists draft_requests_user_created_idx on public.draft_requests (user_id, created_at desc);

-- Row Level Security: each user only ever sees and changes their own rows.
alter table public.ideas enable row level security;
alter table public.posts enable row level security;
alter table public.draft_requests enable row level security;

create policy "ideas_select_own" on public.ideas
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "ideas_insert_own" on public.ideas
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "posts_select_own" on public.posts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "posts_insert_own" on public.posts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "posts_update_own" on public.posts
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "draft_requests_select_own" on public.draft_requests
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "draft_requests_insert_own" on public.draft_requests
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Least privilege: signed-out visitors get nothing; signed-in users cannot delete
-- (so the rate-limit log cannot be wiped) and ideas cannot be edited after saving.
revoke all on public.ideas, public.posts, public.draft_requests from anon;
revoke update, delete, truncate, references, trigger on public.ideas from authenticated;
revoke delete, truncate, references, trigger on public.posts from authenticated;
revoke update, delete, truncate, references, trigger on public.draft_requests from authenticated;
