-- Version: 20261003000000. Log community-book due-date reminders.
create table if not exists public.community_due_date_notifications (
  id uuid primary key default gen_random_uuid(),
  community_request_id text not null,
  visitor_id text not null references public.visitors(id) on delete cascade,
  notification_type text not null
    check (notification_type in ('due_soon', 'due_today', 'overdue')),
  notification_date date not null,
  sent_at timestamptz not null default now(),
  unique (
    community_request_id,
    notification_type,
    notification_date
  )
);

alter table public.community_due_date_notifications
  enable row level security;
