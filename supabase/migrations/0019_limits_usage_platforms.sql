-- Owner decisions, 21 Nov 2026:
--   1. Daily limits per person (rolling 24 hours), different for free and paid plans.
--   2. A record of every AI request (tokens and estimated cost) so real costs can be measured.
--   3. Drafts are written for LinkedIn only unless the person picks other platforms.
--   4. No AI image generation: its request log is removed. Images already in the library stay.
--   5. The background publisher may claim more posts and comments per run (it now sends them in parallel).
-- Run in the Supabase SQL Editor after 0018. Safe to run more than once.

-- ---------- 4. image generation is gone ----------
drop table if exists public.image_requests;

-- ---------- 3. which platforms to write for ----------
alter table public.profiles
  add column if not exists draft_platforms text[] not null default '{linkedin}';
alter table public.profiles drop constraint if exists profiles_draft_platforms_check;
alter table public.profiles add constraint profiles_draft_platforms_check
  check (cardinality(draft_platforms) between 1 and 3 and draft_platforms <@ array['linkedin', 'x', 'substack']);

-- ---------- 1. plans and limits ----------
-- Who is on a paid plan. No row means the free plan. Only the owner (service role / SQL Editor) writes here.
create table if not exists public.user_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  updated_at timestamptz not null default now()
);
alter table public.user_plans enable row level security;
drop policy if exists "user_plans_select_own" on public.user_plans;
create policy "user_plans_select_own" on public.user_plans
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.user_plans from anon, authenticated;
grant select on public.user_plans to authenticated;

-- How many of each action a plan allows in 24 hours. Change the numbers here at any time.
create table if not exists public.usage_limits (
  plan text not null check (plan in ('free', 'pro')),
  operation text not null check (operation in ('draft', 'rewrite', 'angles', 'comments', 'comment_rewrite', 'voice')),
  per_day int not null check (per_day >= 0),
  primary key (plan, operation)
);
alter table public.usage_limits enable row level security;
drop policy if exists "usage_limits_read" on public.usage_limits;
create policy "usage_limits_read" on public.usage_limits for select to authenticated using (true);
revoke all on public.usage_limits from anon, authenticated;
grant select on public.usage_limits to authenticated;

-- Existing numbers are kept if this file is run again, so changes made later are not undone.
insert into public.usage_limits (plan, operation, per_day) values
  ('free', 'draft', 5), ('free', 'rewrite', 10), ('free', 'angles', 5),
  ('free', 'comments', 2), ('free', 'comment_rewrite', 10), ('free', 'voice', 10),
  ('pro', 'draft', 20), ('pro', 'rewrite', 40), ('pro', 'angles', 20),
  ('pro', 'comments', 10), ('pro', 'comment_rewrite', 40), ('pro', 'voice', 20)
on conflict (plan, operation) do nothing;

-- ---------- 2. AI usage record ----------
-- One row per action (which may include a retry). Only successful actions count toward the limits.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  operation text not null check (operation in ('draft', 'rewrite', 'angles', 'comments', 'comment_rewrite', 'voice')),
  ok boolean not null,
  model text check (char_length(model) <= 60),
  calls int not null default 0 check (calls between 0 and 20),
  input_tokens int not null default 0 check (input_tokens >= 0),
  cached_tokens int not null default 0 check (cached_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  audio_seconds numeric(8, 1) check (audio_seconds >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  idea_id uuid,
  post_id uuid,
  -- Internal diagnosis only (never shown in the app, and people cannot read this column).
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_op_created_idx on public.ai_usage (user_id, operation, created_at desc);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "ai_usage_insert_own" on public.ai_usage;
create policy "ai_usage_insert_own" on public.ai_usage
  for insert to authenticated with check ((select auth.uid()) = user_id);
-- The record can be added to, never changed or wiped from the app. People see only what counts
-- toward their limits, not the internal error text or costs.
revoke all on public.ai_usage from anon, authenticated;
grant insert on public.ai_usage to authenticated;
grant select (id, user_id, operation, ok, created_at) on public.ai_usage to authenticated;

-- What the signed-in person has left today, per action, and when the next one frees up.
create or replace function public.my_allowances()
returns table (operation text, used int, per_day int, next_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with my_plan as (
    select coalesce((select p.plan from public.user_plans p where p.user_id = (select auth.uid())), 'free') as plan
  ), recent as (
    select a.operation, a.created_at from public.ai_usage a
     where a.user_id = (select auth.uid()) and a.ok and a.created_at > now() - interval '24 hours'
  )
  select l.operation,
         (select count(*)::int from recent r where r.operation = l.operation),
         l.per_day,
         case when (select count(*) from recent r where r.operation = l.operation) >= l.per_day then
           (select r.created_at + interval '24 hours' from recent r where r.operation = l.operation
             order by r.created_at desc offset greatest(l.per_day - 1, 0) limit 1)
         end
    from public.usage_limits l join my_plan m on m.plan = l.plan;
$$;
revoke all on function public.my_allowances() from public, anon;
grant execute on function public.my_allowances() to authenticated;

-- ---------- 6. follow-up comments are always posted by the server ----------
-- People cannot set due times themselves (0017). This function is the one way to queue them:
-- it only queues approved, ticked comments of a post that is live on LinkedIn, owned by the caller
-- (or for the publisher, which uses the service role). Gaps: 15 to 60 seconds, never the same twice in a row.
create or replace function public.post_comments_protect_due() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce((select auth.role()), '') = 'authenticated'
     and coalesce(current_setting('hiba.queueing_comments', true), '') <> 'on' then
    -- Taking approval back (or editing, which sends it back to draft) stops the automatic post.
    new.due_at := case when tg_op = 'UPDATE' and new.status in ('approved', 'publishing') then old.due_at else null end;
  end if;
  return new;
end $$;

create or replace function public.queue_post_comments(p_post_id uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status text;
  v_external text;
  v_at timestamptz;
  v_gap int;
  v_last int := 0;
  v_count int := 0;
  r record;
begin
  select user_id, status, external_id into v_owner, v_status, v_external from public.posts where id = p_post_id;
  if v_owner is null then return 0; end if;
  if coalesce((select auth.role()), '') <> 'service_role' and v_owner is distinct from (select auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_status <> 'published' or v_external is null then return 0; end if;

  -- Carry on after any comment of this post that is already waiting.
  select greatest(now(), coalesce(max(due_at), now())) into v_at
    from public.post_comments where post_id = p_post_id and status in ('approved', 'publishing') and due_at is not null;

  perform set_config('hiba.queueing_comments', 'on', true);
  for r in
    select id from public.post_comments
     where post_id = p_post_id and status = 'approved' and included and due_at is null
     order by position
     for update
  loop
    v_gap := 15 + floor(random() * 46)::int;
    if v_gap = v_last then v_gap := case when v_gap >= 59 then v_gap - 2 else v_gap + 2 end; end if;
    v_last := v_gap;
    v_at := v_at + make_interval(secs => v_gap);
    update public.post_comments set due_at = v_at where id = r.id;
    v_count := v_count + 1;
  end loop;
  perform set_config('hiba.queueing_comments', '', true);
  return v_count;
end $$;
revoke all on function public.queue_post_comments(uuid) from public, anon;
grant execute on function public.queue_post_comments(uuid) to authenticated, service_role;

-- ---------- 5. bigger publisher batches ----------
create or replace function public.claim_due_posts(max_posts int default 5)
returns setof public.posts
language sql security definer set search_path = '' as $$
  update public.posts p
     set publish_lock = now(), publish_attempts = p.publish_attempts + 1
   where p.id in (
     select id from public.posts
      where status = 'scheduled' and scheduled_for is not null and scheduled_for <= now() and publish_lock is null
      order by scheduled_for
      limit greatest(1, least(max_posts, 60))
      for update skip locked)
  returning p.*;
$$;

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
      limit greatest(1, least(max_comments, 120))
      for update skip locked)
  returning c.*;
$$;

revoke all on function public.claim_due_posts(int) from public, anon, authenticated;
revoke all on function public.claim_due_comments(int) from public, anon, authenticated;
grant execute on function public.claim_due_posts(int) to service_role;
grant execute on function public.claim_due_comments(int) to service_role;
