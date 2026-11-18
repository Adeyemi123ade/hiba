-- HPD-57: archive, restore and permanent delete (owner policy, 18 Nov 2026).
--   Archive: any post. Hidden from normal views. Can be restored at any time.
--   Delete permanently: only archived posts. Removes the post, all its versions and its image
--   (the app removes the image file first). If no other post comes from the same idea, the idea
--   and its angles are deleted too. Nothing is kept behind.
-- Run in the Supabase SQL Editor after 0010. Safe to run more than once.

-- What a post was before it was archived, so restoring puts it back exactly as it was.
alter table public.posts add column if not exists archived_from text
  check (archived_from in ('draft', 'needs_review', 'approved', 'published', 'failed'));
alter table public.posts add column if not exists archived_at timestamptz;

-- Status rules (replaces the 0005 version). Changes from 0005:
--   * a scheduled post can be archived; its scheduled time is cancelled and it comes back as approved;
--   * restoring always returns the post to what it was before, whatever status the app asks for;
--   * a failed post keeps its failure reason while archived.
create or replace function public.posts_check_status_change() returns trigger
language plpgsql set search_path = '' as $$
declare
  allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  -- Restore: the database decides the status, so nobody can "restore" a draft as published.
  if old.status = 'archived' then
    new.status := coalesce(old.archived_from, 'draft');
    new.archived_from := null;
    new.archived_at := null;
    return new;
  end if;

  allowed := case old.status
    when 'draft'        then new.status in ('needs_review', 'approved', 'archived')
    when 'needs_review' then new.status in ('draft', 'approved', 'archived')
    when 'approved'     then new.status in ('draft', 'scheduled', 'published', 'archived')
    when 'scheduled'    then new.status in ('approved', 'published', 'failed', 'archived')
    when 'failed'       then new.status in ('approved', 'scheduled', 'archived')
    when 'published'    then new.status in ('archived')
    else false
  end;
  if not allowed then
    raise exception 'A post cannot move from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'archived' then
    new.archived_from := case old.status when 'scheduled' then 'approved' else old.status end;
    new.archived_at := now();
    new.scheduled_for := null;
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status not in ('failed', 'archived') then
    new.failure_reason := null;
  end if;
  return new;
end $$;

-- The archive fields can only be changed by the status rules above, never sent directly.
create or replace function public.posts_protect_archive_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then
    new.archived_from := old.archived_from;
    new.archived_at := old.archived_at;
  end if;
  return new;
end $$;

drop trigger if exists posts_protect_archive_fields on public.posts;
create trigger posts_protect_archive_fields before update on public.posts
  for each row execute function public.posts_protect_archive_fields();

-- A new post can never arrive already archived or with archive details.
create or replace function public.posts_check_initial_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status not in ('draft', 'needs_review') then
    raise exception 'A new post must start as a draft' using errcode = 'check_violation';
  end if;
  new.archived_from := null;
  new.archived_at := null;
  return new;
end $$;

-- Permanent delete: only your own posts, and only once they are archived.
grant delete on public.posts to authenticated;
drop policy if exists "posts_delete_own_archived" on public.posts;
create policy "posts_delete_own_archived" on public.posts
  for delete to authenticated
  using ((select auth.uid()) = user_id and status = 'archived');

-- When the last post from an idea is deleted, delete the idea too (its angles go with it),
-- so no copy of the person's words is left behind. Runs with owner rights because people
-- cannot delete ideas directly; it only ever touches the idea of the post just deleted.
create or replace function public.posts_delete_orphan_idea() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.posts p where p.idea_id = old.idea_id) then
    delete from public.ideas i where i.id = old.idea_id and i.user_id = old.user_id;
  end if;
  return null;
end $$;

revoke all on function public.posts_delete_orphan_idea() from public, anon, authenticated;

drop trigger if exists posts_delete_orphan_idea on public.posts;
create trigger posts_delete_orphan_idea after delete on public.posts
  for each row execute function public.posts_delete_orphan_idea();

-- The Posts page also needs to know what an archived post was, and when it was archived.
drop function if exists public.search_posts(text, text[], text, timestamptz, uuid, int);
create function public.search_posts(
  p_query text default null,
  p_statuses text[] default null,
  p_platform text default null,
  p_before_updated timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 20
)
returns table (
  id uuid, idea_id uuid, platform text, title text, body text, status text,
  scheduled_for timestamptz, failure_reason text, external_url text, image_path text, image_alt text,
  created_at timestamptz, updated_at timestamptz, idea_body text, archived_from text, archived_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  with q as (
    select case
      when nullif(btrim(p_query), '') is null then null
      else '%' || replace(replace(replace(left(btrim(p_query), 200), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as pattern
  )
  select p.id, p.idea_id, p.platform, p.title, p.body, p.status,
         p.scheduled_for, p.failure_reason, p.external_url, p.image_path, p.image_alt,
         p.created_at, p.updated_at, i.body, p.archived_from, p.archived_at
  from public.posts p
  join public.ideas i on i.id = p.idea_id
  cross join q
  where p.user_id = (select auth.uid())
    and (p_statuses is null or p.status = any (p_statuses))
    and (p_platform is null or p.platform = p_platform)
    and (q.pattern is null
         or p.body ilike q.pattern
         or p.title ilike q.pattern
         or i.body ilike q.pattern)
    and (p_before_updated is null or (p.updated_at, p.id) < (p_before_updated, p_before_id))
  order by p.updated_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

revoke all on function public.search_posts(text, text[], text, timestamptz, uuid, int) from public, anon;
grant execute on function public.search_posts(text, text[], text, timestamptz, uuid, int) to authenticated;
