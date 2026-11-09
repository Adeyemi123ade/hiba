-- HPD-54: full status list and server-side rules for status changes.
-- Run in the Supabase SQL editor after 0004.

-- Statuses: draft, needs_review, approved, scheduled, published, failed, archived.
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('draft', 'needs_review', 'approved', 'scheduled', 'published', 'failed', 'archived'));

-- A short, readable reason shown when publishing fails (HPD-54 AC6).
alter table public.posts add column if not exists failure_reason text check (char_length(failure_reason) <= 500);

-- Only these status changes are allowed. Anything else is rejected by the database,
-- whatever the app or a modified browser sends.
create or replace function public.posts_check_status_change() returns trigger
language plpgsql set search_path = '' as $$
declare
  allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;
  allowed := case old.status
    when 'draft'        then new.status in ('needs_review', 'approved', 'archived')
    when 'needs_review' then new.status in ('draft', 'approved', 'archived')
    when 'approved'     then new.status in ('draft', 'scheduled', 'published', 'archived')
    when 'scheduled'    then new.status in ('approved', 'published', 'failed')
    when 'failed'       then new.status in ('approved', 'scheduled', 'archived')
    when 'published'    then new.status in ('archived')
    when 'archived'     then new.status in ('draft')
    else false
  end;
  if not allowed then
    raise exception 'A post cannot move from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status <> 'failed' then
    new.failure_reason := null;
  end if;
  return new;
end $$;

drop trigger if exists posts_check_status_change on public.posts;
create trigger posts_check_status_change before update of status on public.posts
  for each row execute function public.posts_check_status_change();

-- New posts may only start as a draft or waiting for review.
create or replace function public.posts_check_initial_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status not in ('draft', 'needs_review') then
    raise exception 'A new post must start as a draft' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists posts_check_initial_status on public.posts;
create trigger posts_check_initial_status before insert on public.posts
  for each row execute function public.posts_check_initial_status();
