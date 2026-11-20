-- H09 scheduling and automatic publishing, H10 failure handling (HPD-67, 69, 70, 72, 74, 112, 113).
-- Run in the Supabase SQL Editor after 0016. Safe to run more than once.
-- Then run supabase/sql/publisher_cron.sql once to start the background publisher.
--
-- How it works
--   * The person schedules an approved LinkedIn post: status 'scheduled' with a time (scheduled_for).
--   * Every 15 seconds the database calls the "publisher" Edge Function. It claims posts that are due
--     (publish_lock), publishes them as their owner, and records each try in publish_attempts.
--   * When a scheduled post goes live, its approved follow-up comments get due times (due_at)
--     15 to 60 seconds apart, and the publisher posts them one by one. No page needs to be open.
--   * Nothing is ever posted twice: a post or comment is claimed before LinkedIn is called, and if
--     Hiba cannot tell whether LinkedIn accepted it, it is marked failed (never retried by itself).

alter table public.posts add column if not exists publish_lock timestamptz;
alter table public.posts add column if not exists publish_attempts int not null default 0;
alter table public.post_comments add column if not exists due_at timestamptz;

create index if not exists posts_due_idx on public.posts (scheduled_for) where status = 'scheduled';
create index if not exists post_comments_due_idx on public.post_comments (due_at) where status = 'approved' and due_at is not null;

-- ---------- scheduling rules ----------
-- The person can schedule, move and cancel; only the publisher (service role) can claim a post.
create or replace function public.posts_schedule_rules() returns trigger
language plpgsql set search_path = '' as $$
declare
  is_person boolean := coalesce((select auth.role()), '') = 'authenticated';
begin
  if is_person then
    -- Only the publisher sets these.
    new.publish_lock := case when tg_op = 'UPDATE' then old.publish_lock else null end;
    new.publish_attempts := case when tg_op = 'UPDATE' then old.publish_attempts else 0 end;
    -- While Hiba is posting it, the person cannot move or cancel it.
    if tg_op = 'UPDATE' and old.publish_lock is not null and old.status = 'scheduled'
       and (new.status is distinct from old.status or new.scheduled_for is distinct from old.scheduled_for) then
      raise exception 'Hiba is posting this right now' using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'scheduled' and new.scheduled_for is not null then
    if new.platform <> 'linkedin' then
      raise exception 'Only LinkedIn posts can be scheduled' using errcode = 'check_violation';
    end if;
    if is_person and (tg_op = 'INSERT' or new.scheduled_for is distinct from old.scheduled_for
                      or old.status <> 'scheduled') then
      if new.scheduled_for < now() + interval '2 minutes' then
        -- The app asks for 5 minutes; 2 here leaves room for a slow connection or clock.
        raise exception 'Choose a time a few minutes from now' using errcode = 'check_violation';
      end if;
      if new.scheduled_for > now() + interval '365 days' then
        raise exception 'Choose a time within the next year' using errcode = 'check_violation';
      end if;
      -- A new time is a fresh start.
      new.publish_attempts := 0;
    end if;
  end if;

  -- Leaving 'scheduled' releases the claim. Back to approved or draft clears the time.
  if new.status <> 'scheduled' then
    new.publish_lock := null;
    if new.status in ('draft', 'needs_review', 'approved') then
      new.scheduled_for := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists posts_schedule_rules on public.posts;
create trigger posts_schedule_rules before insert or update on public.posts
  for each row execute function public.posts_schedule_rules();

-- Only the publisher may set due times on comments.
create or replace function public.post_comments_protect_due() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce((select auth.role()), '') = 'authenticated' then
    -- Taking approval back (or editing, which sends it back to draft) stops the automatic post.
    new.due_at := case when tg_op = 'UPDATE' and new.status in ('approved', 'publishing') then old.due_at else null end;
  end if;
  return new;
end $$;

drop trigger if exists post_comments_protect_due on public.post_comments;
create trigger post_comments_protect_due before insert or update on public.post_comments
  for each row execute function public.post_comments_protect_due();

-- ---------- publish attempts (history and support) ----------
create table if not exists public.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  comment_id uuid references public.post_comments (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- published, retry (nothing was posted; tried again later), failed, unconfirmed (check LinkedIn)
  outcome text check (outcome in ('published', 'retry', 'failed', 'unconfirmed')),
  detail text check (char_length(detail) <= 500)
);
create index if not exists publish_attempts_post_idx on public.publish_attempts (post_id, started_at desc);

alter table public.publish_attempts enable row level security;
drop policy if exists "publish_attempts_select_own" on public.publish_attempts;
create policy "publish_attempts_select_own" on public.publish_attempts
  for select to authenticated using ((select auth.uid()) = user_id);
-- People can read their own history; only the publisher writes it.
revoke all on public.publish_attempts from anon, authenticated;
grant select on public.publish_attempts to authenticated;

-- ---------- claims, used only by the publisher (service role) ----------
-- Due posts, oldest first. Skips rows another run is already handling.
create or replace function public.claim_due_posts(max_posts int default 5)
returns setof public.posts
language sql security definer set search_path = '' as $$
  update public.posts p
     set publish_lock = now(), publish_attempts = p.publish_attempts + 1
   where p.id in (
     select id from public.posts
      where status = 'scheduled' and scheduled_for is not null and scheduled_for <= now() and publish_lock is null
      order by scheduled_for
      limit greatest(1, least(max_posts, 20))
      for update skip locked)
  returning p.*;
$$;

-- The next due comment of each post (never two of the same post at once, so the gaps hold).
create or replace function public.claim_due_comments(max_comments int default 10)
returns setof public.post_comments
language sql security definer set search_path = '' as $$
  update public.post_comments c
     set status = 'publishing'
   where c.id in (
     select c1.id from public.post_comments c1
      where c1.status = 'approved' and c1.included and c1.due_at is not null and c1.due_at <= now()
        and not exists (
          select 1 from public.post_comments c2
           where c2.post_id = c1.post_id and c2.id <> c1.id and c2.included
             and (c2.status = 'publishing' or (c2.status = 'approved' and c2.position < c1.position)))
      order by c1.due_at
      limit greatest(1, least(max_comments, 50))
      for update skip locked)
  returning c.*;
$$;

revoke all on function public.claim_due_posts(int) from public, anon, authenticated;
revoke all on function public.claim_due_comments(int) from public, anon, authenticated;
grant execute on function public.claim_due_posts(int) to service_role;
grant execute on function public.claim_due_comments(int) to service_role;
