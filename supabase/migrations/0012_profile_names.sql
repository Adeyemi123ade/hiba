-- HPD-26 (owner request, 18 Nov 2026): registration collects first name and surname.
-- Run in the Supabase SQL Editor. Does not depend on 0009 to 0011. Safe to run more than once.

alter table public.profiles
  add column if not exists first_name text check (char_length(first_name) between 1 and 60),
  add column if not exists last_name text check (char_length(last_name) between 1 and 60);

-- Cleans a name sent at sign-up: no control characters, single spaces, at most 60 characters.
create or replace function public.clean_person_name(raw text) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(raw, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), 60), '')
$$;

-- New account: keep the terms record (from 0003) and also save the names.
-- Email sign-up sends first_name and last_name. Google sends given_name and family_name.
-- The first name also becomes the starting "What should I call you?" answer.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  first_n text := public.clean_person_name(coalesce(new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'given_name'));
  last_n  text := public.clean_person_name(coalesce(new.raw_user_meta_data->>'last_name', new.raw_user_meta_data->>'family_name'));
begin
  insert into public.profiles (id, terms_accepted_at, terms_version, first_name, last_name, preferred_name)
  values (
    new.id,
    case when new.raw_user_meta_data ? 'terms_version' then now() end,
    left(new.raw_user_meta_data->>'terms_version', 20),
    first_n,
    last_n,
    first_n
  )
  on conflict (id) do nothing;
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- People who signed up before this change: fill in names Google already gave us. Never overwrite.
update public.profiles p
set first_name = coalesce(p.first_name, public.clean_person_name(coalesce(u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'given_name'))),
    last_name  = coalesce(p.last_name,  public.clean_person_name(coalesce(u.raw_user_meta_data->>'last_name',  u.raw_user_meta_data->>'family_name')))
from auth.users u
where u.id = p.id and (p.first_name is null or p.last_name is null);
