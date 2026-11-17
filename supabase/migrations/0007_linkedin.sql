-- H08: LinkedIn connection and publishing (HPD-63, 64, 65, 110; HPD-71 "post now").
-- Run in the Supabase SQL editor after 0006.

-- One LinkedIn connection per person. The access token is stored ENCRYPTED by the server
-- function with TOKEN_ENCRYPTION_KEY (a function secret). The database and the browser only
-- ever hold ciphertext, which is useless without that key.
create table if not exists public.linkedin_connections (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  member_id text not null check (char_length(member_id) between 1 and 100),
  name text check (char_length(name) <= 200),
  picture text check (char_length(picture) <= 2000),
  access_token_enc text not null check (char_length(access_token_enc) <= 8000),
  scope text check (char_length(scope) <= 500),
  expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists linkedin_connections_set_updated_at on public.linkedin_connections;
create trigger linkedin_connections_set_updated_at before update on public.linkedin_connections
  for each row execute function public.set_updated_at();

-- Short-lived values that prove a LinkedIn approval was started by this person (stops
-- someone tricking a signed-in person into connecting the wrong account).
create table if not exists public.linkedin_oauth_states (
  nonce text primary key check (char_length(nonce) between 20 and 100),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  origin text not null check (char_length(origin) <= 200),
  created_at timestamptz not null default now()
);

-- Where a post went once published (for "View on LinkedIn").
alter table public.posts add column if not exists external_id text check (char_length(external_id) <= 200);
alter table public.posts add column if not exists external_url text check (char_length(external_url) <= 500);

alter table public.linkedin_connections enable row level security;
alter table public.linkedin_oauth_states enable row level security;

drop policy if exists "linkedin_connections_select_own" on public.linkedin_connections;
create policy "linkedin_connections_select_own" on public.linkedin_connections
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "linkedin_connections_insert_own" on public.linkedin_connections;
create policy "linkedin_connections_insert_own" on public.linkedin_connections
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "linkedin_connections_update_own" on public.linkedin_connections;
create policy "linkedin_connections_update_own" on public.linkedin_connections
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "linkedin_connections_delete_own" on public.linkedin_connections;
create policy "linkedin_connections_delete_own" on public.linkedin_connections
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "linkedin_oauth_states_select_own" on public.linkedin_oauth_states;
create policy "linkedin_oauth_states_select_own" on public.linkedin_oauth_states
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "linkedin_oauth_states_insert_own" on public.linkedin_oauth_states;
create policy "linkedin_oauth_states_insert_own" on public.linkedin_oauth_states
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "linkedin_oauth_states_delete_own" on public.linkedin_oauth_states;
create policy "linkedin_oauth_states_delete_own" on public.linkedin_oauth_states
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.linkedin_connections, public.linkedin_oauth_states from anon;
revoke truncate, references, trigger on public.linkedin_connections from authenticated;
revoke update, truncate, references, trigger on public.linkedin_oauth_states from authenticated;
