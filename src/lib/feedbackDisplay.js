// Display a short pseudonym for a feedback author in staff-facing views.
export function maskFeedbackName(name) {
  const parts = String(name || '').trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return 'Visitor';
  const first = Array.from(parts[0])[0].toLocaleUpperCase();
  const last = parts.length > 1 ? ` ${Array.from(parts.at(-1))[0].toLocaleUpperCase()}.` : '';
  return `${first}***${last}`;
}

export function canReplyToFeedback(role, libraryId) {
  return (role === 'subadmin' && Boolean(libraryId)) || (role === 'superadmin' && !libraryId);
}
