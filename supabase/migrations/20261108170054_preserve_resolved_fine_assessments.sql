BEGIN;

-- A manually resolved/waived amount must keep its stored assessment even when
-- the book currently has a valid rate. Patch the automatic RPCs accordingly.
DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  v_definition := pg_get_functiondef('public.get_fine_payment_dashboard(text)'::regprocedure);
  v_updated := replace(
    v_definition,
    'CASE WHEN br.fine_rate_snapshot BETWEEN 1 AND 100 THEN br.fine_rate_snapshot',
    'CASE WHEN br.fine_review_resolved_at IS NOT NULL THEN NULL WHEN br.fine_rate_snapshot BETWEEN 1 AND 100 THEN br.fine_rate_snapshot'
  );
  v_updated := replace(
    v_updated,
    'CASE WHEN c.effective_rate BETWEEN 1 AND 100 THEN false',
    'CASE WHEN c.fine_review_resolved_at IS NOT NULL THEN false WHEN c.effective_rate BETWEEN 1 AND 100 THEN false'
  );
  IF v_updated = v_definition
     OR position('br.fine_review_resolved_at IS NOT NULL THEN NULL' IN v_updated) = 0
     OR position('c.fine_review_resolved_at IS NOT NULL THEN false' IN v_updated) = 0 THEN
    RAISE EXCEPTION 'Could not apply resolved fine handling to the dashboard RPC.';
  END IF;
  EXECUTE v_updated;

  v_definition := pg_get_functiondef('public.get_fine_payment_alert_targets(text)'::regprocedure);
  v_updated := replace(
    v_definition,
    'br.fine_rate_snapshot, br.fine_review_required, b.fine_rate,',
    'br.fine_rate_snapshot, br.fine_review_required, br.fine_review_resolved_at, b.fine_rate,'
  );
  v_updated := replace(
    v_updated,
    'CASE WHEN br.fine_rate_snapshot BETWEEN 1 AND 100 THEN br.fine_rate_snapshot',
    'CASE WHEN br.fine_review_resolved_at IS NOT NULL THEN NULL WHEN br.fine_rate_snapshot BETWEEN 1 AND 100 THEN br.fine_rate_snapshot'
  );
  v_updated := replace(
    v_updated,
    'CASE WHEN c.effective_rate IS NOT NULL THEN false',
    'CASE WHEN c.fine_review_resolved_at IS NOT NULL THEN false WHEN c.effective_rate IS NOT NULL THEN false'
  );
  IF v_updated = v_definition
     OR position('br.fine_review_resolved_at IS NOT NULL THEN NULL' IN v_updated) = 0
     OR position('c.fine_review_resolved_at IS NOT NULL THEN false' IN v_updated) = 0 THEN
    RAISE EXCEPTION 'Could not apply resolved fine handling to the alert RPC.';
  END IF;
  EXECUTE v_updated;

  v_definition := pg_get_functiondef(
    'public.record_fine_payment(text,numeric,text,text,text)'::regprocedure
  );
  v_updated := replace(
    v_definition,
    'v_effective_rate := CASE
    WHEN v_request.fine_rate_snapshot BETWEEN 1 AND 100 THEN v_request.fine_rate_snapshot',
    'v_effective_rate := CASE
    WHEN v_request.fine_review_resolved_at IS NOT NULL THEN NULL
    WHEN v_request.fine_rate_snapshot BETWEEN 1 AND 100 THEN v_request.fine_rate_snapshot'
  );
  v_updated := replace(
    v_updated,
    'IF v_effective_rate IS NULL AND (COALESCE(v_request.fine_review_required, false)',
    'IF v_effective_rate IS NULL AND v_request.fine_review_resolved_at IS NULL AND (COALESCE(v_request.fine_review_required, false)'
  );
  IF v_updated = v_definition
     OR position('v_request.fine_review_resolved_at IS NOT NULL THEN NULL' IN v_updated) = 0 THEN
    RAISE EXCEPTION 'Could not apply resolved fine handling to the payment RPC.';
  END IF;
  EXECUTE v_updated;
END;
$migration$;

COMMIT;
