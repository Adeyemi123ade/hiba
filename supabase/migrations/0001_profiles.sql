-- Hiba: profiles + onboarding answers. Run in Supabase SQL editor (or `supabase db push`).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  preferred_name text check (char_length(preferred_name) <= 60),
  onboarding jsonb not null default '{}'::jsonb check (pg_column_size(onboarding) < 20000),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users can only read/write their own row. No delete policy (row is removed with the auth user).
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
