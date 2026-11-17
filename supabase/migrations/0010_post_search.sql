-- HPD-55 / HPD-56: the Posts library and search.
-- Run in the Supabase SQL Editor after 0008 (it does not depend on 0009). Safe to run more than once.

-- Fast "contains these words" search on post text and the original idea.
create extension if not exists pg_trgm with schema extensions;

create index if not exists posts_body_trgm_idx on public.posts using gin (body extensions.gin_trgm_ops);
create index if not exists posts_title_trgm_idx on public.posts using gin (title extensions.gin_trgm_ops);
create index if not exists ideas_body_trgm_idx on public.ideas using gin (body extensions.gin_trgm_ops);
-- Newest-first paging for one person.
create index if not exists posts_user_updated_idx on public.posts (user_id, updated_at desc, id desc);

-- One page of the person's posts, newest change first.
-- security invoker: it runs as the caller, so Row Level Security still decides what they can see.
create or replace function public.search_posts(
  p_query text default null,          -- words to look for in the post or its idea (optional)
  p_statuses text[] default null,     -- only these statuses (optional)
  p_platform text default null,       -- only this platform (optional)
  p_before_updated timestamptz default null, -- paging: continue after this row
  p_before_id uuid default null,
  p_limit int default 20
)
returns table (
  id uuid, idea_id uuid, platform text, title text, body text, status text,
  scheduled_for timestamptz, failure_reason text, external_url text, image_path text, image_alt text,
  created_at timestamptz, updated_at timestamptz, idea_body text
)
language sql stable security invoker set search_path = ''
as $$
  with q as (
    -- Treat % and _ as plain characters, and ignore anything past 200 characters.
    select case
      when nullif(btrim(p_query), '') is null then null
      else '%' || replace(replace(replace(left(btrim(p_query), 200), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as pattern
  )
  select p.id, p.idea_id, p.platform, p.title, p.body, p.status,
         p.scheduled_for, p.failure_reason, p.external_url, p.image_path, p.image_alt,
         p.created_at, p.updated_at, i.body
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
