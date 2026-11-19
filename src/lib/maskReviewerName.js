/**
 * Reviewer name masking utility for SHELF ILMS.
 * Masks reader names for privacy while confirming real visitor reviews.
 * Example: 'Kyle Morcilla' -> 'K*** M.', 'John' -> 'J***'
 */

export function maskReviewerName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return 'Verified Reader';
  }

  const trimmed = fullName.trim();
  if (!trimmed || trimmed.toLowerCase() === 'verified reader') {
    return 'Verified Reader';
  }

  // Already masked format: e.g., 'K*** M.' or 'J***'
  if (/^[A-Z]\*{3}(\s[A-Z]\.)?$/i.test(trimmed)) {
    return trimmed;
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return 'Verified Reader';
  }

  const firstInitial = parts[0].charAt(0).toUpperCase();

  if (parts.length === 1) {
    return `${firstInitial}***`;
  }

  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${firstInitial}*** ${lastInitial}.`;
}
