SELECT cron.schedule_in_database('shelf-due-date-notifications', '0 0 * * *', '
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = ''shelf_supabase_url''
      ) || ''/functions/v1/send-due-date-notifications'',
      headers := jsonb_build_object(
        ''Content-Type'', ''application/json'',
        ''x-due-notification-secret'', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = ''due_notification_secret''
        )
      ),
      body := ''{}''::jsonb
    );
  ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('shelf-expire-pickups', '* * * * *', 'select public.auto_expire_pickups();', 'postgres', NULL, true);
