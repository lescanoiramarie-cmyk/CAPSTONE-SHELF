export function getMajorActionConfirmation(button) {
  if (
    !button ||
    button.disabled ||
    button.closest('[data-confirmation-dialog]') ||
    button.hasAttribute('data-faq-suggestion')
  ) {
    return '';
  }

  const label = (
    button.getAttribute('aria-label') ||
    button.textContent ||
    button.title ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedLabel = label.toLowerCase();
  const path = window.location.pathname;
  const isAdminModule = path.startsWith('/subadmin') || path === '/superadmin';

  const customMessage = button.getAttribute('data-confirm-message');
  if (customMessage) return customMessage;
  if (button.hasAttribute('data-confirm-borrow')) {
    return 'Are you sure you want to submit this borrow request?';
  }
  if (button.hasAttribute('data-confirm-return')) {
    return 'Are you sure you want to confirm this book return?';
  }
  if (button.hasAttribute('data-confirm-borrowing')) {
    return 'Are you sure you want to confirm this book borrowing?';
  }

  if (
    !normalizedLabel ||
    /\b(qr|image|download|upload|scan|close|cancel)\b/.test(
      normalizedLabel
    )
  ) {
    return '';
  }

  if (/\b(log out|logout|sign out)\b/.test(normalizedLabel)) {
    return 'Are you sure you want to sign out?';
  }

  if (/\b(return|returning)\b/.test(normalizedLabel) && /\b(confirm|complete|mark|process|return)\b/.test(normalizedLabel)) {
    return 'Are you sure you want to confirm this book return?';
  }

  if (/\b(borrow|borrowing|reserve|reservation)\b/.test(normalizedLabel) && /\b(confirm|complete|mark|process|request|borrow|reserve)\b/.test(normalizedLabel)) {
    return normalizedLabel.includes('request')
      ? 'Are you sure you want to submit this borrow request?'
      : 'Are you sure you want to confirm this book borrowing?';
  }

  if (isAdminModule && /\b(delete|remove|disable|enable|archive)\b/.test(normalizedLabel)) {
    if (/\b(delete|remove)\b/.test(normalizedLabel)) {
      return 'Are you sure you want to delete this item?';
    }
    if (/\b(disable|enable)\b/.test(normalizedLabel)) {
      return `Are you sure you want to ${/\bdisable\b/.test(normalizedLabel) ? 'disable' : 'enable'} this account?`;
    }
  }

  return '';
}
