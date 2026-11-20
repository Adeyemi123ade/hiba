-- Starts Hiba's background publisher: every 15 seconds the database calls the "publisher"
-- Edge Function, which posts scheduled LinkedIn posts and their follow-up comments when due.
-- Run ONCE in the Supabase SQL Editor, after migration 0017 and after deploying "publisher".
--
-- Before running, replace the two values marked <...>:
--   <PROJECT_REF>       your project's ref (Settings > General), e.g. dyqmzgebcbalboecncjv
--   <PUBLISHER_SECRET>  the same long random value you set as the PUBLISHER_SECRET function secret
-- Running it again replaces the job and the stored secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The secret is kept in Supabase Vault, never in the job text.
do $$
begin
  perform vault.update_secret(id, '<PUBLISHER_SECRET>') from vault.secrets where name = 'publisher_secret';
  if not found then
    perform vault.create_secret('<PUBLISHER_SECRET>', 'publisher_secret', 'Hiba publisher: shared secret');
  end if;
end $$;

select cron.unschedule('hiba-publisher') where exists (select 1 from cron.job where jobname = 'hiba-publisher');

select cron.schedule(
  'hiba-publisher',
  '15 seconds',
  $job$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/publisher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-publisher-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publisher_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);

-- To stop the publisher:   select cron.unschedule('hiba-publisher');
-- To see recent runs:      select * from cron.job_run_details order by start_time desc limit 20;
