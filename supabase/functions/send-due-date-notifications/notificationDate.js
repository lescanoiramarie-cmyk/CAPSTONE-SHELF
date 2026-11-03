export const NOTIFICATION_TIME_ZONE = "Asia/Manila";

const manilaDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NOTIFICATION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getNotificationDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = Object.fromEntries(
    manilaDateFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, partValue]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateKeyToUtcDay(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function getCalendarDaysUntil(dueDate, now = new Date()) {
  const dueKey = getNotificationDateKey(dueDate);
  const todayKey = getNotificationDateKey(now);
  if (!dueKey || !todayKey) return null;

  return dateKeyToUtcDay(dueKey) - dateKeyToUtcDay(todayKey);
}

export function getDueDateNotificationType(dueDate, now = new Date()) {
  const dueTime = new Date(dueDate).getTime();
  if (!Number.isFinite(dueTime) || !Number.isFinite(now.getTime())) {
    return null;
  }

  if (now.getTime() > dueTime) return "overdue";

  const daysUntilDue = getCalendarDaysUntil(dueDate, now);
  if (daysUntilDue === 2) return "due_soon";
  if (daysUntilDue === 0) return "due_today";
  return null;
}

export function formatNotificationDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  return date.toLocaleDateString("en-PH", {
    timeZone: NOTIFICATION_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
