-- Save for later (HPD-171). Owner decisions, 25 Nov 2026:
--   * An idea can be kept for later instead of drafted straight away. Saved ideas show in Posts > Saved ideas.
--   * Once posts are drafted from a saved idea, it leaves the saved list by itself.
--   * A saved idea can be deleted for good, as long as no posts were made from it.
--
-- Run in the Supabase SQL Editor after 0024. Safe to run more than once.

alter table public.ideas add column if not exists saved_at timestamptz;
create index if not exists ideas_saved_idx on public.ideas (user_id, saved_at desc) where saved_at is not null;

-- The database sets the time: the app can only say "save it" (any value) or not (null).
create or replace function public.ideas_saved_at_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.saved_at is not null then
    new.saved_at := now();
  end if;
  return new;
end $$;

drop trigger if exists ideas_saved_at_rules on public.ideas;
create trigger ideas_saved_at_rules before insert on public.ideas
  for each row execute function public.ideas_saved_at_rules();

-- Posts drafted from an idea: it is no longer "for later". People cannot change ideas themselves
-- (0004), so this runs with the database's own rights and touches only that one idea.
create or replace function public.ideas_unsave_on_draft() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.ideas set saved_at = null
  where id = new.idea_id and user_id = new.user_id and saved_at is not null;
  return new;
end $$;
revoke all on function public.ideas_unsave_on_draft() from public, anon, authenticated;

drop trigger if exists posts_unsave_idea on public.posts;
create trigger posts_unsave_idea after insert on public.posts
  for each row execute function public.ideas_unsave_on_draft();

-- Delete one of your own saved ideas, only while no posts come from it. Returns true when deleted.
create or replace function public.delete_saved_idea(p_idea uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  removed int;
begin
  delete from public.ideas i
  where i.id = p_idea
    and i.user_id = (select auth.uid())
    and i.saved_at is not null
    and not exists (select 1 from public.posts p where p.idea_id = i.id);
  get diagnostics removed = row_count;
  return removed > 0;
end $$;
revoke all on function public.delete_saved_idea(uuid) from public, anon;
grant execute on function public.delete_saved_idea(uuid) to authenticated;
