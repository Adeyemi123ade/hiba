alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text check (char_length(terms_version) <= 20);

-- Record acceptance at sign-up using the SERVER clock when the client says terms were accepted.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, terms_accepted_at, terms_version)
  values (
    new.id,
    case when new.raw_user_meta_data ? 'terms_version' then now() end,
    left(new.raw_user_meta_data->>'terms_version', 20)
  )
  on conflict (id) do nothing;
  return new;
end $$;
