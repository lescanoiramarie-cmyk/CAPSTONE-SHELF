-- Read-only catalog inspection for the production fine dashboard index.
-- Run in Supabase SQL Editor against the intended project. This script contains
-- no DDL/DML and returns rows for every same-named index in any schema.
WITH target AS (
  SELECT
    ic.oid AS index_oid,
    ins.nspname AS index_schema,
    ic.relname AS index_name,
    ic.relowner AS index_owner_oid,
    pg_catalog.pg_get_userbyid(ic.relowner) AS index_owner,
    tc.oid AS table_oid,
    tns.nspname AS table_schema,
    tc.relname AS table_name,
    i.*,
    am.amname AS access_method
  FROM pg_catalog.pg_class AS ic
  JOIN pg_catalog.pg_namespace AS ins ON ins.oid = ic.relnamespace
  LEFT JOIN pg_catalog.pg_index AS i ON i.indexrelid = ic.oid
  LEFT JOIN pg_catalog.pg_class AS tc ON tc.oid = i.indrelid
  LEFT JOIN pg_catalog.pg_namespace AS tns ON tns.oid = tc.relnamespace
  LEFT JOIN pg_catalog.pg_am AS am ON am.oid = ic.relam
  WHERE ic.relkind IN ('i', 'I')
    AND ic.relname = 'borrow_requests_fine_dashboard_status_book_due_idx'
),
columns AS (
  SELECT
    t.index_oid,
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'position', k.ord,
        'kind', CASE WHEN k.ord <= t.indnkeyatts THEN 'key' ELSE 'include' END,
        'column', a.attname,
        'expression', CASE WHEN k.attnum = 0 THEN pg_catalog.pg_get_indexdef(t.index_oid, k.ord::integer, false) END,
        'indoption', CASE WHEN k.ord <= t.indnkeyatts THEN o.option END,
        'descending', CASE WHEN k.ord <= t.indnkeyatts THEN (o.option & 1) = 1 END,
        'nulls_first', CASE WHEN k.ord <= t.indnkeyatts THEN (o.option & 2) = 2 END,
        'operator_class', CASE WHEN k.ord <= t.indnkeyatts THEN opc_ns.nspname || '.' || opc.opcname END,
        'indcollation_oid', CASE WHEN k.ord <= t.indnkeyatts THEN co.collation_oid END,
        'index_collation', CASE WHEN k.ord <= t.indnkeyatts AND coll.oid <> 0 THEN coll_ns.nspname || '.' || coll.collname END,
        'table_collation_oid', CASE WHEN k.ord <= t.indnkeyatts THEN COALESCE(a.attcollation, 0::oid) END,
        'table_collation', CASE WHEN k.ord <= t.indnkeyatts AND table_coll.oid <> 0 THEN table_coll_ns.nspname || '.' || table_coll.collname END
      ) ORDER BY k.ord
    ) AS ordered_columns
  FROM target AS t
  CROSS JOIN LATERAL pg_catalog.unnest(t.indkey) WITH ORDINALITY AS k(attnum, ord)
  LEFT JOIN pg_catalog.pg_attribute AS a
    ON a.attrelid = t.table_oid AND a.attnum = k.attnum
  LEFT JOIN LATERAL pg_catalog.unnest(t.indoption) WITH ORDINALITY AS o(option, ord)
    ON o.ord = k.ord
  LEFT JOIN LATERAL pg_catalog.unnest(t.indclass) WITH ORDINALITY AS op(opclass_oid, ord)
    ON op.ord = k.ord AND k.ord <= t.indnkeyatts
  LEFT JOIN pg_catalog.pg_opclass AS opc ON opc.oid = op.opclass_oid
  LEFT JOIN pg_catalog.pg_namespace AS opc_ns ON opc_ns.oid = opc.opcnamespace
  LEFT JOIN LATERAL pg_catalog.unnest(t.indcollation) WITH ORDINALITY AS co(collation_oid, ord)
    ON co.ord = k.ord AND k.ord <= t.indnkeyatts
  LEFT JOIN pg_catalog.pg_collation AS coll ON coll.oid = co.collation_oid
  LEFT JOIN pg_catalog.pg_namespace AS coll_ns ON coll_ns.oid = coll.collnamespace
  LEFT JOIN pg_catalog.pg_collation AS table_coll ON table_coll.oid = a.attcollation
  LEFT JOIN pg_catalog.pg_namespace AS table_coll_ns ON table_coll_ns.oid = table_coll.collnamespace
  GROUP BY t.index_oid
)
SELECT
  pg_catalog.current_database() AS connected_database,
  current_user AS connected_role,
  session_user AS session_role,
  t.index_schema,
  t.index_name,
  t.index_owner_oid,
  t.index_owner,
  t.table_schema,
  t.table_name,
  t.access_method,
  t.indisunique,
  t.indisexclusion,
  t.indisvalid,
  t.indisready,
  t.indislive,
  t.indnatts,
  t.indnkeyatts,
  c.ordered_columns,
  pg_catalog.pg_get_indexdef(t.index_oid) AS index_definition,
  pg_catalog.pg_get_expr(t.indpred, t.table_oid) AS predicate,
  pg_catalog.format_type(status_col.atttypid, status_col.atttypmod) AS status_type,
  con.conname AS backing_constraint_name,
  pg_catalog.pg_get_constraintdef(con.oid, false) AS backing_constraint_definition
FROM target AS t
LEFT JOIN columns AS c ON c.index_oid = t.index_oid
LEFT JOIN pg_catalog.pg_attribute AS status_col
  ON status_col.attrelid = t.table_oid
 AND status_col.attname = 'status'
 AND status_col.attnum > 0
 AND NOT status_col.attisdropped
LEFT JOIN pg_catalog.pg_constraint AS con ON con.conindid = t.index_oid
ORDER BY t.index_schema, t.index_name;
