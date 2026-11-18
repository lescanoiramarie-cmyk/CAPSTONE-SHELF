export const FINE_PAYMENT_ANALYTICS_RPC = 'get_fine_payment_analytics';

export const FINE_PAYMENT_ANALYTICS_FIELDS = Object.freeze([
  'report_kind',
  'period_month',
  'branch_id',
  'branch_name',
  'fines_assessed',
  'fines_collected',
  'outstanding_balance',
  'paid_request_count',
  'partially_paid_request_count',
  'unpaid_request_count',
  'cash_collected',
  'bank_transfer_collected',
  'other_collected',
]);

export function buildFinePaymentAnalyticsArgs(libraryId) {
  return { p_library_id: libraryId ? String(libraryId) : null };
}

export function sanitizeFinePaymentAnalyticsRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => Object.fromEntries(
    FINE_PAYMENT_ANALYTICS_FIELDS
      .filter((field) => Object.hasOwn(row || {}, field))
      .map((field) => [field, row[field]])
  ));
}