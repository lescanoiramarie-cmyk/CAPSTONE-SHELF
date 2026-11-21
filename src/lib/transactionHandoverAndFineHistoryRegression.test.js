import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

test('Migration 177 provides robust TEXT and UUID signatures for handover functions', () => {
  const migrationPath = path.join(
    REPO_ROOT,
    'supabase/migrations/20270127000000_reconcile_transactions_subscription_and_notifications.sql'
  );
  assert.ok(fs.existsSync(migrationPath), 'Migration 177 must exist');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Verify confirm_pickup(text, text) definition
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.confirm_pickup\(\s*p_request_id\s+text,\s*p_staff_name\s+text\s*\)/i,
    'confirm_pickup(text, text) must be defined'
  );

  // Verify confirm_pickup(uuid, text) compatibility overload
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.confirm_pickup\(\s*p_request_id\s+uuid,\s*p_staff_name\s+text\s*\)/i,
    'confirm_pickup(uuid, text) overload must be defined'
  );

  // Verify confirm_return(text, text) definition
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.confirm_return\(\s*p_request_id\s+text,\s*p_staff_name\s+text\s*\)/i,
    'confirm_return(text, text) must be defined'
  );

  // Verify confirm_return(uuid, text) compatibility overload
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.confirm_return\(\s*p_request_id\s+uuid,\s*p_staff_name\s+text\s*\)/i,
    'confirm_return(uuid, text) overload must be defined'
  );

  // Every public text request ID is validated before it becomes a UUID.
  assert.equal((sql.match(/v_req_id !~\* '[^']+'/gi) || []).length, 2);
  assert.equal((sql.match(/v_request_uuid := v_req_id::uuid/gi) || []).length, 2);
  assert.equal((sql.match(/v_trimmed_id !~\* '[^']+'/gi) || []).length, 3);
  assert.equal((sql.match(/v_uuid := v_trimmed_id::uuid/gi) || []).length, 2);
  assert.equal((sql.match(/v_request_uuid := v_trimmed_id::uuid/gi) || []).length, 1);
  assert.match(sql, /v_request_id_is_uuid boolean[\s\S]*?IF v_request_id_is_uuid THEN[\s\S]*?WHERE br\.id = v_request_uuid[\s\S]*?ELSE[\s\S]*?WHERE br\.id = v_req_id/i, 'handover compares UUID and text request IDs only in matching column-type branches');
  assert.match(sql, /WHERE\s+br\.id\s*=\s*v_request_uuid/i);
  assert.match(sql, /WHERE\s+br\.id\s*=\s*v_req_id/i);
  assert.match(sql, /WHERE\s+request\.id\s*=\s*v_uuid/i);

  // Fail closed on AAL2 and an exact, present JWT role claim on every handover entry point.
  for (const signature of ['confirm_pickup', 'confirm_return']) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${signature}\\([\\s\\S]*?auth\\.jwt\\(\\) ->> 'aal' IS DISTINCT FROM 'aal2'`, 'i'));
  }
  assert.equal((sql.match(/auth\.jwt\(\) -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_staff_role/gi) || []).length, 2);
  assert.equal((sql.match(/auth\.jwt\(\) -> 'app_metadata' ->> 'role' IS DISTINCT FROM v_role/gi) || []).length, 2);
  for (const signature of [
    'confirm_pickup(text, text)', 'confirm_pickup(uuid, text)',
    'confirm_return(text, text)', 'confirm_return(uuid, text)',
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature.replace(/[(), ]/g, (x) => x === '(' ? '\\(' : x === ')' ? '\\)' : x === ',' ? ',\\s*' : '\\s*')} FROM PUBLIC, anon, authenticated, service_role`, 'i'));
  }
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.confirm_pickup_v2\(text, text\) TO authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.confirm_return_v2\(text, text\) TO authenticated/i);

  // Verify record_fine_payment_subadmin_internal updates fine_amount to persist assessed fine
  assert.match(
    sql,
    /fine_amount\s*=\s*GREATEST\(COALESCE\(fine_amount,\s*0\),\s*v_fine_amount\)/i,
    'record_fine_payment_subadmin_internal must persist fine_amount to prevent overdue fine regression'
  );

  // Verify security attributes: search_path and ownership
  assert.match(
    sql,
    /ALTER FUNCTION public\.confirm_pickup\(text,\s*text\)\s+OWNER TO postgres/i,
    'confirm_pickup(text, text) must be owned by postgres'
  );
  assert.match(
    sql,
    /ALTER FUNCTION public\.confirm_return\(text,\s*text\)\s+OWNER TO postgres/i,
    'confirm_return(text, text) must be owned by postgres'
  );
  assert.match(
    sql,
    /ALTER FUNCTION public\.record_fine_payment_subadmin_internal\(text,\s*numeric,\s*text,\s*text,\s*text,\s*uuid\)\s+OWNER TO postgres/i,
    'idempotent internal payment function must be owned by postgres'
  );
});

test('Migration 177 uses a private transaction-safe idempotency receipt and denies the old payment endpoint', () => {
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations/20270127000000_reconcile_transactions_subscription_and_notifications.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE public\.fine_payment_idempotency[\s\S]*?PRIMARY KEY \(received_by, idempotency_key\)/i);
  assert.match(sql, /ALTER TABLE public\.fine_payment_idempotency ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON public\.fine_payment_idempotency FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(sql, /IF v_request_id_is_uuid THEN\s+SELECT br\.\* INTO v_request FROM public\.borrow_requests AS br\s+WHERE br\.id = v_request_uuid FOR UPDATE;\s+ELSE\s+SELECT br\.\* INTO v_request FROM public\.borrow_requests AS br\s+WHERE br\.id = v_trimmed_id FOR UPDATE;/i, 'payment lock uses the catalog-verified matching ID type');
  assert.match(sql, /WHERE receipt\.received_by = v_staff\.id\s+AND receipt\.idempotency_key = p_idempotency_key/i);
  assert.match(sql, /INSERT INTO public\.fine_payment_idempotency/i);
  assert.match(sql, /record_fine_payment_v2\(text, numeric, text, text, text, uuid\)/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.record_fine_payment\(text, numeric, text, text, text\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(sql, /UPDATE public\.borrow_requests[\s\S]*?fine_paid_amount = COALESCE\(fine_paid_amount, 0\) \+ v_amount/i);
  assert.doesNotMatch(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.record_fine_payment_v2'), sql.indexOf('-- ============================================================================\n-- 3.')), /status\s*=\s*'returned'/i);
});

test('Migration 177 return confirmation never lowers or erases an existing fine assessment', () => {
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations/20270127000000_reconcile_transactions_subscription_and_notifications.sql'), 'utf8').replace(/\r\n/g, '\n');
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.confirm_return(\n    p_request_id text');
  const end = sql.indexOf('ALTER FUNCTION public.confirm_return(text, text)', start);
  const definition = sql.slice(start, end);
  assert.ok(start >= 0 && end > start, 'text return function is present');
  assert.match(definition, /v_fine := GREATEST\(COALESCE\(v_req\.fine_amount, 0\), v_overdue_days \* v_effective_fine_rate\)/i);
  assert.match(definition, /fine_amount = GREATEST\(COALESCE\(v_req\.fine_amount, 0\), 0\)/i);
  assert.doesNotMatch(definition, /fine_amount\s*=\s*0\s*,/i);
});

test('Migration 177 fails closed on subadmin terms claims and hides fine alert detail helper', () => {
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations/20270127000000_reconcile_transactions_subscription_and_notifications.sql'), 'utf8');
  const termsStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.accept_subadmin_terms()');
  const termsEnd = sql.indexOf('ALTER FUNCTION public.accept_subadmin_terms()', termsStart);
  const termsDefinition = sql.slice(termsStart, termsEnd);
  assert.ok(termsStart >= 0 && termsEnd > termsStart);
  assert.match(termsDefinition, /auth\.jwt\(\) ->> 'aal' IS DISTINCT FROM 'aal2'/i);
  assert.match(termsDefinition, /v_jwt_role IS DISTINCT FROM staff_row\.role/i);
  assert.doesNotMatch(termsDefinition, /COALESCE/i);

  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_fine_payment_alert_targets_detail_internal\(text\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(sql, /Fine alert detail helper must remain owner-only/i);
  assert.match(sql, /p_payment_method IS NULL OR p_payment_method NOT IN/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION shelf_private\.request_borrow_unchecked\(uuid, text\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(sql, /Unchecked borrow implementation must remain owner-only/i);
});

test('Migration 177 keeps notification creation owner-only and removes current_user as an authorization test', () => {
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations/20270127000000_reconcile_transactions_subscription_and_notifications.sql'), 'utf8').replace(/\r\n/g, '\n');
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_visitor_notification');
  const end = sql.indexOf('-- ============================================================================\n-- 5.', start);
  const definition = sql.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(definition, /current_user/i);
  assert.match(definition, /REVOKE ALL ON FUNCTION public\.create_visitor_notification\([\s\S]*?FROM PUBLIC, anon, authenticated, service_role/i);
  assert.doesNotMatch(definition, /GRANT EXECUTE/i);
});

test('Migration 177 retains the subscription dashboard RPC contract and scoped staff authorization', () => {
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations/20270127000000_reconcile_transactions_subscription_and_notifications.sql'), 'utf8');
  const definition = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.get_library_subscription_dashboard'),
    sql.indexOf('-- ============================================================================\n-- 2. FIX confirm_pickup')
  );
  assert.match(definition, /get_library_subscription_dashboard\(p_library_id text DEFAULT NULL::text\)/i);
  assert.match(definition, /plan_key text[\s\S]*?effective_status text[\s\S]*?history jsonb[\s\S]*?upgrade_requests jsonb/i);
  assert.match(definition, /auth\.jwt\(\) ->> 'aal' IS DISTINCT FROM 'aal2'/i);
  assert.match(definition, /v_jwt_role IS DISTINCT FROM v_staff_role/i);
  assert.match(definition, /v_library_id::uuid/i);
  assert.doesNotMatch(definition, /pg_catalog\.current_date/i);
  assert.match(definition, /WHERE v_target_library IS NULL OR l\.id = v_target_library/i);
  const callers = fs.readFileSync(path.join(REPO_ROOT, 'src/component/SubscriptionManagement.jsx'), 'utf8');
  assert.match(callers, /rpc\('get_library_subscription_dashboard',\s*\{\s*p_library_id:/);
});

test('OPACCatalog and VisitorDashboard fine calculation and badge behavior for paid transactions', () => {
  // Simulate calculateCurrentFine
  function calculateCurrentFine(request) {
    if (!request) return 0;
    const fineStatus = request.fineStatus || request.fine_status;
    if (fineStatus === 'paid') return 0;
    const fineAmount = Number(request.fineAmount ?? request.fine_amount ?? 0);
    const finePaidAmount = Number(request.finePaidAmount ?? request.fine_paid_amount ?? 0);
    if (fineAmount > 0 && finePaidAmount >= fineAmount) return 0;
    if (finePaidAmount > 0 && (request.fineReviewResolvedAt || request.fine_review_resolved_at)) {
      return Math.max(0, fineAmount - finePaidAmount);
    }
    if (request.status === 'returned') {
      return Math.max(0, fineAmount - finePaidAmount);
    }
    // Simulated overdue loan
    const calculatedTotal = request.simulatedCalculatedFine ?? fineAmount;
    return Math.max(0, calculatedTotal - finePaidAmount);
  }

  function getIsFinePaid(request, currentFine) {
    const finePaidAmount = Number(request.finePaidAmount ?? request.fine_paid_amount ?? 0);
    const fineAmount = Number(request.fineAmount ?? request.fine_amount ?? 0);
    return Boolean(
      request.fineStatus === 'paid' ||
      request.fine_status === 'paid' ||
      (finePaidAmount > 0 && (currentFine <= 0 || (fineAmount > 0 && finePaidAmount >= fineAmount)))
    );
  }

  // Case 1: Overdue book with paid fine (Kyle Morcilla scenario)
  const paidOverdueRequest = {
    id: 'REQ-kyle-001',
    status: 'borrowed',
    dueDate: '2026-11-10T00:00:00Z',
    fineAmount: 60,
    finePaidAmount: 60,
  };
  const currentFine1 = calculateCurrentFine(paidOverdueRequest);
  assert.equal(currentFine1, 0, 'Current fine must be 0 when finePaidAmount >= fineAmount');
  assert.equal(
    getIsFinePaid(paidOverdueRequest, currentFine1),
    true,
    'isFinePaid must be true for paid overdue request'
  );

  // Case 2: Returned book with paid fine
  const returnedPaidRequest = {
    id: 'REQ-kyle-002',
    status: 'returned',
    dueDate: '2026-11-05T00:00:00Z',
    returnDate: '2026-11-12T00:00:00Z',
    fineAmount: 140,
    finePaidAmount: 140,
  };
  const currentFine2 = calculateCurrentFine(returnedPaidRequest);
  assert.equal(currentFine2, 0, 'Returned paid loan current fine must be 0');
  assert.equal(
    getIsFinePaid(returnedPaidRequest, currentFine2),
    true,
    'isFinePaid must be true for returned paid book'
  );

  // Case 3: Partial payment
  const partialPaymentRequest = {
    id: 'REQ-partial-001',
    status: 'borrowed',
    fineAmount: 100,
    finePaidAmount: 40,
    simulatedCalculatedFine: 100,
  };
  const currentFine3 = calculateCurrentFine(partialPaymentRequest);
  assert.equal(currentFine3, 60, 'Outstanding fine must reflect remaining balance');
  assert.equal(
    getIsFinePaid(partialPaymentRequest, currentFine3),
    false,
    'isFinePaid must be false when fine is not paid in full'
  );
});
test('forward handover correction uses only existing borrow_requests columns', () => {
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations/20270128000000_fix_handover_existing_columns.sql'), 'utf8');
  assert.match(sql, /confirmed_by\s*=\s*v_staff_name/i);
  assert.doesNotMatch(sql, /pickup_confirmed_by\\s*=|updated_at\\s*=/i);
  assert.match(sql, /record_fine_payment_subadmin_internal[\s\S]*?FOR UPDATE[\s\S]*?fine_paid_amount\s*=\s*COALESCE\(fine_paid_amount, 0\) \+ v_amount/i);
  assert.match(sql, /fine_payment_idempotency[\s\S]*?p_idempotency_key/i);
  assert.match(sql, /auth\.jwt\(\) ->> 'aal' IS DISTINCT FROM 'aal2'/i);
  assert.match(sql, /IS DISTINCT FROM pg_catalog\.lower\(v_staff\.role\)/i);
});

test('Migration 179 supports text IDs without weakening UUID validation or payment idempotency', () => {
  const sql = fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations/20270129000000_support_text_borrow_request_ids.sql'), 'utf8');
  assert.match(sql, /ALTER COLUMN request_id TYPE text USING request_id::text/i);
  assert.match(sql, /v_id_is_uuid AND v_req_id !~\* '[^']*'/i);
  assert.match(sql, /WHERE br\.id::text = v_req_id FOR UPDATE/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.confirm_pickup_v2\(p_request_id text, p_staff_name text\)/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.confirm_return_v2\(p_request_id text, p_staff_name text\)/i);
  assert.match(sql, /v_request_identity := v_trimmed_id::uuid::text/i, 'UUID cast is restricted to a schema-verified UUID column and validated input');
  assert.match(sql, /WHERE br\.id::text = v_request_identity FOR UPDATE/i);
  assert.match(sql, /v_existing_request_id IS DISTINCT FROM v_request_identity/i);
  assert.match(sql, /auth\.jwt\(\) ->> 'aal' IS DISTINCT FROM 'aal2'/i);
  assert.match(sql, /auth\.jwt\(\) -> 'app_metadata' ->> 'role' IS DISTINCT FROM/i);
  assert.match(sql, /Request not found or branch access denied/i);
  assert.match(sql, /same idempotency key|Idempotency key was already used/i);
});
