-- Voice engine (owner request, 19 Nov 2026): Hiba measures how the person writes and keeps a short
-- description of their voice, so every draft matches their cadence, vocabulary and nuance.
-- Run in the Supabase SQL Editor. Safe to run more than once.

alter table public.profiles
  add column if not exists voice_profile jsonb check (voice_profile is null or pg_column_size(voice_profile) < 20000),
  -- When the description was made and from which texts, so it is refreshed when they change.
  add column if not exists voice_profile_at timestamptz,
  add column if not exists voice_sources_hash text check (char_length(voice_sources_hash) <= 100);
