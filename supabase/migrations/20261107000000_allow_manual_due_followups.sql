alter table public.due_date_notifications
  drop constraint if exists due_date_notifications_type_check;

alter table public.due_date_notifications
  drop constraint if exists due_date_notifications_notification_type_check;

alter table public.due_date_notifications
  add constraint due_date_notifications_type_check
  check (notification_type in ('due_soon', 'due_today', 'overdue', 'follow_up'));

notify pgrst, 'reload schema';