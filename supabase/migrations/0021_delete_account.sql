-- Delete my account (HPD-157). Owner decision, 22 Nov 2026: anyone can delete their own account
-- from Settings, and once deleted everything goes.
--
-- Every table holding a person's data references auth.users with "on delete cascade"
-- (0001 to 0019), so deleting the sign-in account removes all their rows in one step.
-- Storage files cannot be deleted with SQL; the app deletes them through the storage API first.
--
-- Run in the Supabase SQL Editor after 0020. Safe to run more than once.

-- A count of deletions with no personal data: only when it happened.
create table if not exists public.account_deletions (
  id bigint generated always as identity primary key,
  deleted_at timestamptz not null default now()
);
alter table public.account_deletions enable row level security;
-- No policies: nobody can read or write it from the app. The owner reads it in the dashboard.
revoke all on public.account_deletions from anon, authenticated;

-- Deletes the account of whoever calls it. Never takes a user id, so nobody can delete someone else.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.account_deletions default values;
  delete from auth.users where id = me;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
