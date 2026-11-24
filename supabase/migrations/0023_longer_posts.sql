-- Longer drafts (HPD-164). Owner decision, 24 Nov 2026: Substack drafts may be up to 3000 words,
-- which can be 18000 to 21000 characters. Posts and their saved versions were capped at 20000
-- characters (0004, 0006); the cap becomes 30000.
--
-- Run in the Supabase SQL Editor after 0022. Safe to run more than once.

-- Remove the old body-length checks, whatever they are called.
do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname from pg_constraint
    where contype = 'c' and conrelid in ('public.posts'::regclass, 'public.post_versions'::regclass)
      and pg_get_constraintdef(oid) ilike '%char_length(body)%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.posts add constraint posts_body_check check (char_length(body) <= 30000);
alter table public.post_versions add constraint post_versions_body_check check (char_length(body) <= 30000);
