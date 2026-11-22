export const VISITOR_REGISTRATION_TYPES = Object.freeze({
  INSTITUTIONAL: 'institutional',
  COMMUNITY: 'community',
});

export function normalizeVisitorRegistrationType(value) {
  const type = String(value || '').trim().toLowerCase();
  return Object.values(VISITOR_REGISTRATION_TYPES).includes(type)
    ? type
    : null;
}

export function isValidVisitorEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function validateVisitorRegistrationEmail(email, registrationType, libraryDomain, visitorAccessMode = 'institutional') {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const type = normalizeVisitorRegistrationType(registrationType);

  if (!isValidVisitorEmail(normalizedEmail)) {
    return 'Please enter a valid email address.';
  }
  if (!type) {
    return 'Select a valid visitor registration type.';
  }
  if (visitorAccessMode === 'public' && type === VISITOR_REGISTRATION_TYPES.INSTITUTIONAL) {
    return 'This public library uses open registration. Select Public / Community Visitor.';
  }
  if (type === VISITOR_REGISTRATION_TYPES.COMMUNITY) return '';

  const emailDomain = normalizedEmail.split('@')[1];
  const allowedDomain = String(libraryDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/\.+$/, '');

  if (!allowedDomain) {
    return 'The selected partner library does not have an institutional email domain configured.';
  }
  if (
    emailDomain === 'gmail.com' ||
    (emailDomain !== allowedDomain && !emailDomain.endsWith(`.${allowedDomain}`))
  ) {
    return `Use an email address belonging to the selected partner library domain (@${allowedDomain}).`;
  }
  return '';
}
