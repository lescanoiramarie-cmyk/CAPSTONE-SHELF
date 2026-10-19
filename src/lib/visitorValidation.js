export function validateVisitorFullName(value) {
  const name = String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');

  if (!name) {
    return 'Please enter your first and last name.';
  }

  if (!/^[\p{L}\p{M} .\u0027\u2018\u2019\u2010-\u2015-]+$/u.test(name)) {
    return 'Use letters, spaces, apostrophes, periods, or hyphens only.';
  }

  const nameParts = name.split(' ');
  if (
    nameParts.length < 2 ||
    nameParts.some((part, index) => {
      const letterCount = (part.match(/\p{L}/gu) || []).length;
      const isMiddleInitial =
        index > 0 &&
        index < nameParts.length - 1 &&
        /^\p{L}\p{M}*\.?$/u.test(part);

      return letterCount < 2 && !isMiddleInitial;
    })
  ) {
    return 'Enter your first and last name; middle initials are allowed.';
  }

  return '';
}
