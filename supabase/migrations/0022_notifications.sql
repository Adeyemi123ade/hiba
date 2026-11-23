-- In-app notifications (HPD-73, HPD-114, HPD-79). Owner decisions, 23 Nov 2026:
--   * In the app only, no email.
--   * Drafts ready for review and Post published can be switched off in Settings.
--   * Publishing failed and Reconnect LinkedIn are always on.
-- The database creates them itself (triggers on posts), so scheduled posts that go out while
-- the person is away still produce one.
--
-- Run in the Supabase SQL Editor after 0021. Safe to run more than once.

-- Which optional notifications the person wants. Missing keys count as on.
alter table public.profiles
  add column if not exists notify jsonb not null default '{"review": true, "published": true}'::jsonb;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('review', 'published', 'failed', 'reconnect')),
  idea_id uuid references public.ideas (id) on delete cascade,
  post_id uuid references public.posts (id) on delete cascade,
  message text not null check (char_length(message) <= 600),
  -- One notification per event: a second trigger run for the same event does nothing.
  event_key text not null check (char_length(event_key) <= 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, event_key)
);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- The app may only read them and mark them read. Only the triggers below create them.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Adds one notification, unless it is switched off or already there. Keeps 90 days.
create or replace function public.add_notification(
  p_user uuid, p_kind text, p_idea uuid, p_post uuid, p_message text, p_key text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  wants boolean := true;
begin
  if p_kind in ('review', 'published') then
    select coalesce((notify ->> p_kind)::boolean, true) into wants from public.profiles where id = p_user;
    if not coalesce(wants, true) then return; end if;
  end if;
  insert into public.notifications (user_id, kind, idea_id, post_id, message, event_key)
  values (p_user, p_kind, p_idea, p_post, left(p_message, 600), left(p_key, 200))
  on conflict (user_id, event_key) do nothing;
  delete from public.notifications where user_id = p_user and created_at < now() - interval '90 days';
end $$;
revoke all on function public.add_notification(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;

-- New drafts: one "ready for review" per idea, however many platforms it was written for.
create or replace function public.notify_new_drafts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('draft', 'needs_review') then
    perform public.add_notification(new.user_id, 'review', new.idea_id, null,
      'Your new drafts are ready for review.', 'review:' || new.idea_id);
  end if;
  return null;
end $$;
drop trigger if exists notify_new_drafts on public.posts;
create trigger notify_new_drafts after insert on public.posts
  for each row execute function public.notify_new_drafts();

-- Published, failed, or LinkedIn needs reconnecting.
create or replace function public.notify_post_outcome() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  reason text := coalesce(new.failure_reason, '');
begin
  if new.status = old.status then return null; end if;
  if new.status = 'published' then
    perform public.add_notification(new.user_id, 'published', new.idea_id, new.id,
      'Your post is live on LinkedIn.', 'published:' || new.id);
  elsif new.status = 'failed' then
    if reason ilike '%reconnect%' or reason ilike '%refused your connection%' or reason ilike '%not connected%' then
      perform public.add_notification(new.user_id, 'reconnect', new.idea_id, new.id,
        'LinkedIn needs to be reconnected. Reconnect it in Settings, then schedule the post again.',
        'reconnect:' || new.id || ':' || coalesce(new.publish_attempts, 0));
    else
      perform public.add_notification(new.user_id, 'failed', new.idea_id, new.id,
        'A scheduled post was not published. ' || coalesce(nullif(reason, ''), 'Open it to try again.'),
        'failed:' || new.id || ':' || coalesce(new.publish_attempts, 0));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists notify_post_outcome on public.posts;
create trigger notify_post_outcome after update of status on public.posts
  for each row execute function public.notify_post_outcome();
