-- Every new auth user automatically gets a profile row, so onboarding only ever UPDATES it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill users that existed before this trigger.
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- Least privilege: signed-out visitors get nothing, signed-in users can only read/insert/update (RLS limits to own row).
revoke all on public.profiles from anon;
revoke delete, truncate, references, trigger on public.profiles from authenticated;
