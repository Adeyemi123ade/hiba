-- HPD-49: different angles for one idea (personal story, practical lesson, and so on).
-- Run in the Supabase SQL Editor after 0008. Safe to run more than once.

create table if not exists public.angles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Every angle belongs to the idea it came from. Deleting the idea deletes its angles.
  idea_id uuid not null references public.ideas (id) on delete cascade,
  kind text not null check (kind in (
    'personal_story', 'practical_lesson', 'common_mistake', 'opinion',
    'beginners_guide', 'professional_insight', 'audience_question', 'motivational'
  )),
  title text not null check (char_length(title) between 1 and 120),
  summary text not null check (char_length(summary) between 1 and 400),
  -- suggested: new from Hiba. saved: kept for later. chosen: the drafts were written from it.
  -- discarded: hidden, can be brought back.
  status text not null default 'suggested' check (status in ('suggested', 'saved', 'chosen', 'discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists angles_idea_created_idx on public.angles (idea_id, created_at);

drop trigger if exists angles_set_updated_at on public.angles;
create trigger angles_set_updated_at before update on public.angles
  for each row execute function public.set_updated_at();

-- An angle must belong to an idea owned by the same person.
create or replace function public.angles_check_idea_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.ideas i where i.id = new.idea_id and i.user_id = new.user_id) then
    raise exception 'idea does not belong to this user';
  end if;
  return new;
end $$;

drop trigger if exists angles_check_idea_owner on public.angles;
create trigger angles_check_idea_owner before insert on public.angles
  for each row execute function public.angles_check_idea_owner();

alter table public.angles enable row level security;

drop policy if exists "angles_select_own" on public.angles;
create policy "angles_select_own" on public.angles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "angles_insert_own" on public.angles;
create policy "angles_insert_own" on public.angles
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "angles_update_own" on public.angles;
create policy "angles_update_own" on public.angles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Least privilege: the app may only change an angle's status. Text and links are fixed once written.
revoke all on public.angles from anon;
revoke update, delete, truncate, references, trigger on public.angles from authenticated;
grant select, insert on public.angles to authenticated;
grant update (status) on public.angles to authenticated;
