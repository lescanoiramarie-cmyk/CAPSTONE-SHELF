ALTER TABLE public.due_date_notifications
  DROP CONSTRAINT IF EXISTS due_date_notifications_type_check;

ALTER TABLE public.due_date_notifications
  DROP CONSTRAINT IF EXISTS due_date_notifications_notification_type_check;

ALTER TABLE public.due_date_notifications
  ADD CONSTRAINT due_date_notifications_type_check
  CHECK (notification_type IN ('due_soon', 'due_today', 'overdue', 'follow_up', 'fine_reminder'));

NOTIFY pgrst, 'reload schema';
