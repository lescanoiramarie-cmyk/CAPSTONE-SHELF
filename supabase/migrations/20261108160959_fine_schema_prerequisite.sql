BEGIN;

-- Supply the fine schema consumed by the November 8 dashboard migration.
-- Existing objects are validated fail-closed; this migration does not alter
-- historical migrations or rewrite existing fine-payment ledger rows.
DO $fine_schema_prerequisite$
DECLARE
  v_borrow_oid       oid;
  v_fine_oid         oid;
  v_staff_oid        oid;
  v_owner_oid        oid;
  v_relkind          "char";
  v_relowner         oid;
  v_created_fine     boolean := false;
  v_added_paid       boolean := false;
  v_col              record;
  v_constraint       record;
  v_index            record;
  v_index_oid        oid;
  v_index_table_oid  oid;
  v_index_method     text;
  v_index_unique     boolean;
  v_index_valid      boolean;
  v_index_ready      boolean;
  v_index_live       boolean;
  v_index_keys       text[];
  v_index_include    text[];
  v_index_options    smallint[];
  v_index_predicate  text;
  v_expected_predicate text;
  v_constraint_names text[];
  v_constraint_count bigint;
  v_policy_count     bigint;
  v_expr             text;
  v_borrow_status_type text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION
      'Fine schema prerequisite requires current_user=postgres; found %',
      current_user;
  END IF;

  v_owner_oid := 'postgres'::regrole::oid;
  v_borrow_oid := pg_catalog.to_regclass('public.borrow_requests')::oid;
  v_staff_oid := pg_catalog.to_regclass('public.staff_profiles')::oid;

  IF v_borrow_oid IS NULL OR v_staff_oid IS NULL THEN
    RAISE EXCEPTION
      'Required relations public.borrow_requests and public.staff_profiles must exist';
  END IF;

  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
    INTO v_borrow_status_type
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = v_borrow_oid
    AND a.attname = 'status'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_borrow_status_type IS DISTINCT FROM 'text'
     AND v_borrow_status_type NOT LIKE 'character varying%' THEN
    RAISE EXCEPTION
      'public.borrow_requests.status has unsupported type % for the canonical dashboard index',
      v_borrow_status_type;
  END IF;

  SELECT c.relkind, c.relowner
    INTO v_relkind, v_relowner
  FROM pg_catalog.pg_class AS c
  WHERE c.oid = v_borrow_oid;

  IF v_relkind <> 'r' OR v_relowner <> v_owner_oid THEN
    RAISE EXCEPTION
      'public.borrow_requests must be a postgres-owned ordinary table';
  END IF;

  -- Create the ledger exactly as the December 24 canonical migration does.
  v_fine_oid := pg_catalog.to_regclass('public.fine_payments')::oid;
  IF v_fine_oid IS NULL THEN
    CREATE TABLE public.fine_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      borrow_request_id text NOT NULL,
      amount numeric NOT NULL CHECK (amount > 0),
      payment_method text NOT NULL
        CHECK (payment_method IN ('cash', 'bank_transfer', 'other')),
      reference_number text,
      note text,
      received_by uuid NOT NULL
        REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
      received_by_name text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    );
    v_fine_oid := pg_catalog.to_regclass('public.fine_payments')::oid;
    v_created_fine := true;
    ALTER TABLE public.fine_payments ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.fine_payments FROM PUBLIC, anon, authenticated;
  END IF;

  SELECT c.relkind, c.relowner
    INTO v_relkind, v_relowner
  FROM pg_catalog.pg_class AS c
  WHERE c.oid = v_fine_oid;

  IF v_relkind <> 'r' OR v_relowner <> v_owner_oid THEN
    RAISE EXCEPTION
      'public.fine_payments must be a postgres-owned ordinary table';
  END IF;

  -- Exact canonical columns, order, types, nullability, and defaults.
  IF (
    SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attnum)
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = v_fine_oid AND a.attnum > 0 AND NOT a.attisdropped
  ) IS DISTINCT FROM ARRAY[
    'id', 'borrow_request_id', 'amount', 'payment_method',
    'reference_number', 'note', 'received_by', 'received_by_name',
    'received_at'
  ]::text[] THEN
    RAISE EXCEPTION
      'public.fine_payments has a missing, extra, or misordered column';
  END IF;

  FOR v_col IN
    SELECT * FROM (VALUES
      ('id',                'uuid',                     true,  'gen_random_uuid()'),
      ('borrow_request_id', 'text',                     true,  NULL::text),
      ('amount',            'numeric',                  true,  NULL::text),
      ('payment_method',    'text',                     true,  NULL::text),
      ('reference_number',  'text',                     false, NULL::text),
      ('note',              'text',                     false, NULL::text),
      ('received_by',       'uuid',                     true,  NULL::text),
      ('received_by_name',  'text',                     true,  NULL::text),
      ('received_at',       'timestamp with time zone', true,  'now()')
    ) AS expected(column_name, type_name, not_null, default_expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS a
      LEFT JOIN pg_catalog.pg_attrdef AS d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = v_fine_oid
        AND a.attname = v_col.column_name
        AND a.attnum > 0 AND NOT a.attisdropped
        AND pg_catalog.format_type(a.atttypid, a.atttypmod) = v_col.type_name
        AND a.attnotnull = v_col.not_null
        AND pg_catalog.pg_get_expr(d.adbin, d.adrelid)
              IS NOT DISTINCT FROM v_col.default_expr
    ) THEN
      RAISE EXCEPTION
        'public.fine_payments.% differs from the canonical column definition',
        v_col.column_name;
    END IF;
  END LOOP;

  -- Exact constraint inventory and shape for the canonical ledger.
  SELECT pg_catalog.array_agg(c.conname::text ORDER BY c.conname)
    INTO v_constraint_names
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = v_fine_oid;

  IF v_constraint_names IS DISTINCT FROM ARRAY[
    'fine_payments_amount_check',
    'fine_payments_payment_method_check',
    'fine_payments_pkey',
    'fine_payments_received_by_fkey'
  ]::text[] THEN
    RAISE EXCEPTION
      'public.fine_payments has missing, duplicate, or unexpected constraints: %',
      v_constraint_names;
  END IF;

  FOR v_constraint IN
    SELECT c.*, pg_catalog.pg_get_expr(c.conbin, c.conrelid) AS expression
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = v_fine_oid
  LOOP
    IF NOT v_constraint.convalidated
       OR v_constraint.condeferrable OR v_constraint.condeferred THEN
      RAISE EXCEPTION
        'Constraint % has unexpected validation or deferrability',
        v_constraint.conname;
    END IF;

    IF v_constraint.conname = 'fine_payments_pkey' THEN
      IF v_constraint.contype <> 'p'
         OR v_constraint.conkey IS DISTINCT FROM ARRAY[
              (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute AS a
               WHERE a.attrelid = v_fine_oid AND a.attname = 'id')
            ]::smallint[] THEN
        RAISE EXCEPTION 'fine_payments primary key is not exactly (id)';
      END IF;
    ELSIF v_constraint.conname = 'fine_payments_amount_check' THEN
      v_expr := pg_catalog.regexp_replace(
        pg_catalog.lower(v_constraint.expression), '[[:space:]]', '', 'g'
      );
      IF v_constraint.contype <> 'c'
         OR v_constraint.conkey IS DISTINCT FROM ARRAY[
              (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute AS a
               WHERE a.attrelid = v_fine_oid AND a.attname = 'amount')
            ]::smallint[]
         OR v_expr NOT IN ('(amount>(0)::numeric)', '(amount>0)') THEN
        RAISE EXCEPTION 'fine_payments amount check is not canonical';
      END IF;
    ELSIF v_constraint.conname = 'fine_payments_payment_method_check' THEN
      v_expr := pg_catalog.regexp_replace(
        pg_catalog.lower(v_constraint.expression), '[[:space:]]', '', 'g'
      );
      IF v_constraint.contype <> 'c'
         OR v_constraint.conkey IS DISTINCT FROM ARRAY[
              (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute AS a
               WHERE a.attrelid = v_fine_oid AND a.attname = 'payment_method')
            ]::smallint[]
         OR v_expr <> '(payment_method=any(array[''cash''::text,''bank_transfer''::text,''other''::text]))' THEN
        RAISE EXCEPTION 'fine_payments payment-method check is not canonical';
      END IF;
    ELSIF v_constraint.conname = 'fine_payments_received_by_fkey' THEN
      IF v_constraint.contype <> 'f'
         OR v_constraint.confrelid <> v_staff_oid
         OR v_constraint.conkey IS DISTINCT FROM ARRAY[
              (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute AS a
               WHERE a.attrelid = v_fine_oid AND a.attname = 'received_by')
            ]::smallint[]
         OR v_constraint.confkey IS DISTINCT FROM ARRAY[
              (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute AS a
               WHERE a.attrelid = v_staff_oid AND a.attname = 'id')
            ]::smallint[]
         OR v_constraint.confdeltype <> 'r'
         OR v_constraint.confupdtype <> 'a'
         OR v_constraint.confmatchtype <> 's' THEN
        RAISE EXCEPTION
          'fine_payments received_by FK must reference staff_profiles(id) ON DELETE RESTRICT';
      END IF;
    END IF;
  END LOOP;

  IF NOT v_created_fine THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS c
      WHERE c.oid = v_fine_oid AND c.relrowsecurity AND NOT c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'Existing fine_payments RLS state is noncanonical';
    END IF;

    SELECT count(*) INTO v_policy_count
    FROM pg_catalog.pg_policy AS p WHERE p.polrelid = v_fine_oid;
    IF v_policy_count <> 0 THEN
      RAISE EXCEPTION 'Existing fine_payments has unexpected RLS policies';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT c.relacl FROM pg_catalog.pg_class AS c WHERE c.oid = v_fine_oid),
          pg_catalog.acldefault('r', v_owner_oid)
        )
      ) AS acl
      WHERE acl.grantee IN (
        0, 'anon'::regrole::oid, 'authenticated'::regrole::oid
      )
        AND acl.privilege_type IN (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        )
    ) THEN
      RAISE EXCEPTION
        'Existing fine_payments has direct PUBLIC/anon/authenticated privileges';
    END IF;
  END IF;

  -- Add absent fine fields with the canonical types/defaults. PostgreSQL
  -- applies constant NOT NULL defaults to pre-existing rows.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_borrow_oid AND attname = 'fine_paid_amount'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = v_borrow_oid
        AND conname = 'borrow_requests_fine_paid_amount_check'
    ) THEN
      RAISE EXCEPTION 'Conflicting fine_paid_amount constraint exists';
    END IF;

    -- Do not guess that an existing ledger is complete or authoritative.
    -- If it contains records, aggregate reconciliation requires a separate,
    -- reviewed procedure; this prerequisite leaves all records untouched.
    IF NOT v_created_fine AND EXISTS (SELECT 1 FROM public.fine_payments) THEN
      RAISE EXCEPTION
        'fine_paid_amount is absent while fine_payments is populated; reconcile payment history separately';
    END IF;

    ALTER TABLE public.borrow_requests
      ADD COLUMN fine_paid_amount numeric NOT NULL DEFAULT 0
      CONSTRAINT borrow_requests_fine_paid_amount_check
      CHECK (fine_paid_amount >= 0);
    v_added_paid := true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_borrow_oid AND attname = 'fine_review_required'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    ALTER TABLE public.borrow_requests
      ADD COLUMN fine_review_required boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_borrow_oid AND attname = 'fine_review_resolved_at'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    ALTER TABLE public.borrow_requests
      ADD COLUMN fine_review_resolved_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_borrow_oid AND attname = 'fine_review_note'
      AND attnum > 0 AND NOT attisdropped
  ) THEN
    ALTER TABLE public.borrow_requests
      ADD COLUMN fine_review_note text;
  END IF;

  FOR v_col IN
    SELECT * FROM (VALUES
      ('fine_paid_amount', 'numeric', true, '0'::text),
      ('fine_review_required', 'boolean', true, 'false'::text),
      ('fine_review_resolved_at', 'timestamp with time zone', false, NULL::text),
      ('fine_review_note', 'text', false, NULL::text)
    ) AS expected(column_name, type_name, not_null, default_expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS a
      LEFT JOIN pg_catalog.pg_attrdef AS d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = v_borrow_oid
        AND a.attname = v_col.column_name
        AND a.attnum > 0 AND NOT a.attisdropped
        AND pg_catalog.format_type(a.atttypid, a.atttypmod) = v_col.type_name
        AND a.attnotnull = v_col.not_null
        AND pg_catalog.pg_get_expr(d.adbin, d.adrelid)
              IS NOT DISTINCT FROM v_col.default_expr
    ) THEN
      RAISE EXCEPTION
        'borrow_requests.% differs from its canonical column definition',
        v_col.column_name;
    END IF;
  END LOOP;

  SELECT count(*), count(*) FILTER (WHERE c.convalidated)
    INTO v_constraint_count, v_policy_count
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = v_borrow_oid
    AND c.conname = 'borrow_requests_fine_paid_amount_check';

  SELECT count(*) INTO v_constraint_count
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = v_borrow_oid
    AND c.contype = 'c'
    AND position('fine_paid_amount' IN pg_catalog.pg_get_constraintdef(c.oid)) > 0;

  IF v_constraint_count <> 1 OR v_policy_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = v_borrow_oid
      AND c.conname = 'borrow_requests_fine_paid_amount_check'
      AND c.contype = 'c'
      AND NOT c.condeferrable AND NOT c.condeferred
      AND c.conkey IS NOT DISTINCT FROM ARRAY[
        (SELECT a.attnum::smallint FROM pg_catalog.pg_attribute AS a
         WHERE a.attrelid = v_borrow_oid AND a.attname = 'fine_paid_amount')
      ]::smallint[]
      AND pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_expr(c.conbin, c.conrelid)),
        '[[:space:]]', '', 'g'
      ) IN ('(fine_paid_amount>=0)', '(fine_paid_amount>=(0)::numeric)')
  ) THEN
    RAISE EXCEPTION
      'fine_paid_amount check is missing, duplicated, unvalidated, or noncanonical';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = v_borrow_oid
      AND c.conname <> 'borrow_requests_fine_paid_amount_check'
      AND (
        position('fine_review_required' IN pg_catalog.pg_get_constraintdef(c.oid)) > 0
        OR position('fine_review_resolved_at' IN pg_catalog.pg_get_constraintdef(c.oid)) > 0
        OR position('fine_review_note' IN pg_catalog.pg_get_constraintdef(c.oid)) > 0
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected constraint references a fine-review column';
  END IF;

  -- Detect same-named indexes that the historical IF NOT EXISTS clauses
  -- would otherwise silently skip. Key/include order, direction, predicate,
  -- access method, uniqueness, and validity are checked from catalogs.
  FOR v_index IN
    SELECT * FROM (VALUES
      ('borrow_requests_fine_dashboard_status_book_due_idx',
       'public.borrow_requests'::regclass::oid,
       ARRAY['status','due_date','book_id']::text[],
       ARRAY['fine_amount','fine_paid_amount','fine_rate_snapshot',
             'fine_review_required','fine_review_resolved_at','visitor_id']::text[],
       ARRAY[0,0,0]::smallint[],
       '(status = ANY (ARRAY[''borrowed''::text, ''returned''::text]))'::text),
      ('books_library_id_book_id_idx', 'public.books'::regclass::oid,
       ARRAY['library_id','id']::text[], ARRAY[]::text[],
       ARRAY[0,0]::smallint[], NULL::text),
      ('fine_payments_request_received_idx', v_fine_oid,
       ARRAY['borrow_request_id','received_at']::text[], ARRAY[]::text[],
       ARRAY[0,3]::smallint[], NULL::text)
    ) AS expected(index_name, table_oid, key_columns, include_columns,
                  key_options, predicate)
  LOOP
    SELECT c.oid INTO v_index_oid
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_index.index_name;

    IF v_index_oid IS NOT NULL THEN
      SELECT i.indrelid, am.amname, i.indisunique, i.indisvalid,
             i.indisready, i.indislive,
             pg_catalog.regexp_replace(
               pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred, i.indrelid)),
               '[[:space:]]', '', 'g'
             )
        INTO v_index_table_oid, v_index_method, v_index_unique, v_index_valid,
             v_index_ready, v_index_live, v_index_predicate
      FROM pg_catalog.pg_index AS i
      JOIN pg_catalog.pg_class AS ic ON ic.oid = i.indexrelid
      JOIN pg_catalog.pg_am AS am ON am.oid = ic.relam
      WHERE i.indexrelid = v_index_oid;

      IF NOT FOUND OR v_index_table_oid <> v_index.table_oid
         OR v_index_method <> 'btree' OR v_index_unique
         OR NOT v_index_valid OR NOT v_index_ready OR NOT v_index_live THEN
        RAISE EXCEPTION
          'Same-named index % has the wrong table, method, uniqueness, or validity',
          v_index.index_name;
      END IF;

      SELECT
        pg_catalog.array_agg(
          COALESCE(a.attname::text, '<expression>') ORDER BY k.ord
        ) FILTER (WHERE k.ord <= i.indnkeyatts),
        pg_catalog.array_agg(
          COALESCE(a.attname::text, '<expression>') ORDER BY k.ord
        ) FILTER (WHERE k.ord > i.indnkeyatts),
        pg_catalog.array_agg(o.option::smallint ORDER BY o.ord)
          FILTER (WHERE o.ord <= i.indnkeyatts)
      INTO v_index_keys, v_index_include, v_index_options
      FROM pg_catalog.pg_index AS i
      CROSS JOIN LATERAL pg_catalog.unnest(i.indkey)
        WITH ORDINALITY AS k(attnum, ord)
      LEFT JOIN pg_catalog.pg_attribute AS a
        ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      LEFT JOIN LATERAL pg_catalog.unnest(i.indoption)
        WITH ORDINALITY AS o(option, ord) ON o.ord = k.ord
      WHERE i.indexrelid = v_index_oid
      GROUP BY i.indnkeyatts;

      v_expected_predicate := CASE
        WHEN v_index.predicate IS NULL THEN NULL
        -- PostgreSQL renders the same `status IN ('borrowed', 'returned')`
        -- predicate differently when status is varchar instead of text. The
        -- production schema uses varchar(50); validate that exact catalog
        -- rendering while retaining the text rendering used by clean replay.
        WHEN v_index.index_name = 'borrow_requests_fine_dashboard_status_book_due_idx'
             AND v_borrow_status_type LIKE 'character varying%' THEN
          '(status=any(array[''borrowed''::character varying,''returned''::character varying]))'
        ELSE pg_catalog.regexp_replace(
          pg_catalog.lower(v_index.predicate), '[[:space:]]', '', 'g'
        )
      END;

      IF v_index_keys IS DISTINCT FROM v_index.key_columns
         OR COALESCE(v_index_include, ARRAY[]::text[])
              IS DISTINCT FROM v_index.include_columns
         OR v_index_options IS DISTINCT FROM v_index.key_options
         OR v_index_predicate IS DISTINCT FROM v_expected_predicate THEN
        RAISE EXCEPTION
          'Same-named index % has noncanonical keys, INCLUDE columns, ordering, or predicate',
          v_index.index_name;
      END IF;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', v_fine_oid, 'SELECT')
     OR has_table_privilege('authenticated', v_fine_oid, 'SELECT')
     OR has_table_privilege('anon', v_fine_oid, 'INSERT')
     OR has_table_privilege('authenticated', v_fine_oid, 'INSERT')
     OR has_table_privilege('anon', v_fine_oid, 'UPDATE')
     OR has_table_privilege('authenticated', v_fine_oid, 'UPDATE')
     OR has_table_privilege('anon', v_fine_oid, 'DELETE')
     OR has_table_privilege('authenticated', v_fine_oid, 'DELETE')
     OR has_table_privilege('anon', v_fine_oid, 'TRUNCATE')
     OR has_table_privilege('authenticated', v_fine_oid, 'TRUNCATE')
     OR has_table_privilege('anon', v_fine_oid, 'REFERENCES')
     OR has_table_privilege('authenticated', v_fine_oid, 'REFERENCES')
     OR has_table_privilege('anon', v_fine_oid, 'TRIGGER')
     OR has_table_privilege('authenticated', v_fine_oid, 'TRIGGER') THEN
    RAISE EXCEPTION
      'anon or authenticated has effective direct access to fine_payments';
  END IF;
END
$fine_schema_prerequisite$;

COMMIT;