-- Phase 2 (owner's master prompt, sections 10 and 11): follow-up comments for a LinkedIn post.
-- Hiba writes them; the person reviews, edits, reorders, chooses and approves them. Once the post
-- is live, Hiba posts the approved ones to LinkedIn one by one (owner decision, 19 Nov 2026).
-- Run in the Supabase SQL Editor. Does not depend on 0009 to 0013. Safe to run more than once.

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Deleting the post deletes its comments too, so nothing is left behind.
  post_id uuid not null references public.posts (id) on delete cascade,
  position int not null check (position between 1 and 50),
  body text not null check (char_length(body) between 1 and 1250),
  -- false = the person chose not to use this comment.
  included boolean not null default true,
  -- draft -> approved (by the person) -> publishing (claimed by Hiba) -> published, or failed.
  status text not null default 'draft' check (status in ('draft', 'approved', 'publishing', 'published', 'failed')),
  external_id text check (char_length(external_id) <= 300),
  published_at timestamptz,
  failure_reason text check (char_length(failure_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists post_comments_post_position_idx on public.post_comments (post_id, position);
create index if not exists post_comments_user_published_idx on public.post_comments (user_id, published_at);

-- Status rules. Posted comments are history: their text can never change. Editing an approved
-- comment sends it back for approval. The LinkedIn id and time are only kept when it is posted.
create or replace function public.post_comments_check_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status <> old.status and not (
       (old.status = 'draft' and new.status = 'approved')
    or (old.status = 'approved' and new.status in ('draft', 'publishing'))
    or (old.status = 'publishing' and new.status in ('published', 'failed', 'approved'))
    or (old.status = 'failed' and new.status in ('approved', 'draft'))
  ) then
    raise exception 'A comment cannot move from % to %', old.status, new.status using errcode = 'check_violation';
  end if;
  if old.status in ('publishing', 'published') and new.body <> old.body then
    raise exception 'A posted comment cannot be changed' using errcode = 'check_violation';
  end if;
  if old.status = 'approved' and new.status = 'approved' and new.body <> old.body then
    new.status := 'draft';
  end if;
  if new.status = 'published' and old.status <> 'published' then
    new.published_at := now();
    new.failure_reason := null;
  else
    new.external_id := old.external_id;
    new.published_at := old.published_at;
  end if;
  if new.status <> 'failed' and new.status <> 'published' then
    new.failure_reason := null;
  end if;
  return new;
end $$;

drop trigger if exists post_comments_check_status on public.post_comments;
create trigger post_comments_check_status before update on public.post_comments
  for each row execute function public.post_comments_check_status();

drop trigger if exists post_comments_set_updated_at on public.post_comments;
create trigger post_comments_set_updated_at before update on public.post_comments
  for each row execute function public.set_updated_at();

-- A comment must belong to a post owned by the same person, and a post has at most 10 comments.
create or replace function public.post_comments_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.posts p where p.id = new.post_id and p.user_id = new.user_id) then
    raise exception 'post does not belong to this user';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.post_comments c where c.post_id = new.post_id) >= 10 then
    raise exception 'a post can have at most 10 follow-up comments' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists post_comments_check on public.post_comments;
create trigger post_comments_check before insert or update of post_id, user_id on public.post_comments
  for each row execute function public.post_comments_check();

alter table public.post_comments enable row level security;

drop policy if exists "post_comments_select_own" on public.post_comments;
create policy "post_comments_select_own" on public.post_comments
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "post_comments_insert_own" on public.post_comments;
create policy "post_comments_insert_own" on public.post_comments
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "post_comments_update_own" on public.post_comments;
create policy "post_comments_update_own" on public.post_comments
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "post_comments_delete_own" on public.post_comments;
create policy "post_comments_delete_own" on public.post_comments
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Least privilege: only these columns can change, and the status rules above decide how.
-- A new comment always starts as a draft.
revoke all on public.post_comments from anon;
revoke update, truncate, references, trigger on public.post_comments from authenticated;
grant select, insert, delete on public.post_comments to authenticated;
grant update (body, position, included, status, external_id, failure_reason) on public.post_comments to authenticated;

create or replace function public.post_comments_new_is_draft() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.status := 'draft';
  new.external_id := null;
  new.published_at := null;
  new.failure_reason := null;
  return new;
end $$;

drop trigger if exists post_comments_new_is_draft on public.post_comments;
create trigger post_comments_new_is_draft before insert on public.post_comments
  for each row execute function public.post_comments_new_is_draft();
