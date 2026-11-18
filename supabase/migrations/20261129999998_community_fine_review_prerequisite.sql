BEGIN;

-- The November 30 fine-rate migration backfills and updates this field on
-- community_book_requests but omits its ADD COLUMN. Use the same canonical
-- boolean definition as borrow_requests.fine_review_required.
DO $community_fine_review_prerequisite$
DECLARE
  v_relation oid := pg_catalog.to_regclass('public.community_book_requests')::oid;
  v_type text;
  v_not_null boolean;
  v_default text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'Community fine-review prerequisite requires current_user=postgres; found %',
      current_user;
  END IF;

  IF v_relation IS NULL THEN
    RAISE EXCEPTION 'Required relation public.community_book_requests is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = v_relation AND a.attname = 'fine_review_required'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    ALTER TABLE public.community_book_requests
      ADD COLUMN fine_review_required boolean NOT NULL DEFAULT false;
  END IF;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_not_null, v_default
  FROM pg_catalog.pg_attribute AS a
  LEFT JOIN pg_catalog.pg_attrdef AS d
    ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = v_relation AND a.attname = 'fine_review_required'
    AND a.attnum > 0 AND NOT a.attisdropped;

  IF v_type IS DISTINCT FROM 'boolean'
     OR v_not_null IS DISTINCT FROM true
     OR v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION
      'community_book_requests.fine_review_required differs from boolean NOT NULL DEFAULT false';
  END IF;
END
$community_fine_review_prerequisite$;

COMMIT;