-- Version: 20261003000100. Schedule daily due-date reminder emails.
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'shelf-due-date-notifications';

select cron.schedule(
  'shelf-due-date-notifications',
  '0 0 * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'shelf_supabase_url'
      ) || '/functions/v1/send-due-date-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-due-notification-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'due_notification_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $$
);
