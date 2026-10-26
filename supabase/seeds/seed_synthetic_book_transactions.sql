-- Seed 1,000 to 1,500 clearly labeled historical book transactions per
-- library/month pair across the most recent 12 calendar months. Each pair has
-- a deterministic target in that range. Existing visitor accounts are rotated
-- through generated transactions; books belong to the branch receiving them.
-- Safe to rerun: deterministic UUIDs and conflict handling prevent duplicates.
-- These rows change dashboard/report totals. Use local/disposable data unless
-- a project owner explicitly approves inserting test records into live data.

BEGIN;
SET LOCAL statement_timeout = '0';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.visitors) THEN
    RAISE EXCEPTION 'Seed aborted: register visitor records before creating test transactions.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.libraries) THEN
    RAISE EXCEPTION 'Seed aborted: at least one library branch is required.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.libraries AS library
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.books AS book
      WHERE book.library_id = library.id
        AND book.book_type = 'library'
    )
  ) THEN
    RAISE EXCEPTION 'Seed aborted: every library needs at least one library book so its transactions can be attributed to that branch.';
  END IF;
END;
$$;

WITH library_pool AS MATERIALIZED (
  SELECT library.id
  FROM public.libraries AS library
), visitor_pool AS MATERIALIZED (
  SELECT
    visitor.id,
    visitor.full_name,
    row_number() OVER (ORDER BY visitor.id) AS visitor_number,
    count(*) OVER () AS visitor_count
  FROM public.visitors AS visitor
), library_books AS MATERIALIZED (
  SELECT
    book.id,
    book.title,
    book.library_id,
    row_number() OVER (PARTITION BY book.library_id ORDER BY book.id) AS book_number,
    count(*) OVER (PARTITION BY book.library_id) AS book_count
  FROM public.books AS book
  WHERE book.book_type = 'library'
    AND book.library_id IS NOT NULL
), months AS MATERIALIZED (
  SELECT generate_series(
    date_trunc('month', current_date)::date - interval '11 months',
    date_trunc('month', current_date)::date,
    interval '1 month'
  )::date AS month_start
), branch_month_targets AS MATERIALIZED (
  SELECT
    library.id AS library_id,
    months.month_start,
    1000 + mod(
      abs(hashtext(format('%s|%s', library.id, months.month_start))::bigint),
      501
    )::integer AS target_rows
  FROM library_pool AS library
  CROSS JOIN months
), branch_month_rows AS MATERIALIZED (
  SELECT
    target.library_id,
    target.month_start,
    sequence.row_number AS sequence_number
  FROM branch_month_targets AS target
  CROSS JOIN LATERAL generate_series(1, target.target_rows) AS sequence(row_number)
), ordered_rows AS MATERIALIZED (
  SELECT
    row_number() OVER (
      ORDER BY branch_month.month_start, branch_month.library_id, branch_month.sequence_number
    ) AS transaction_number,
    branch_month.library_id,
    branch_month.month_start,
    branch_month.sequence_number
  FROM branch_month_rows AS branch_month
), generated AS (
  SELECT
    format('%s-%s-%s-%s-%s',
      substr(seed_hash.value, 1, 8),
      substr(seed_hash.value, 9, 4),
      substr(seed_hash.value, 13, 4),
      substr(seed_hash.value, 17, 4),
      substr(seed_hash.value, 21, 12)
    ) AS id,
    book.id AS book_id,
    book.title AS book_title,
    visitor.id AS visitor_id,
    visitor.full_name AS visitor_name,
    'returned'::text AS status,
    transaction_dates.request_date,
    transaction_dates.borrow_date,
    transaction_dates.borrow_date + interval '14 days' AS due_date,
    least(
      transaction_dates.borrow_date + ((ordered.sequence_number % 12) + 1) * interval '1 day',
      now()
    ) AS return_date,
    CASE WHEN ordered.sequence_number % 7 = 0 THEN 25.00 ELSE 0.00 END AS fine_amount
  FROM ordered_rows AS ordered
  CROSS JOIN LATERAL (
    SELECT md5(format('%s|%s|%s', ordered.library_id, ordered.month_start, ordered.sequence_number)) AS value
  ) AS seed_hash
  JOIN visitor_pool AS visitor
    ON visitor.visitor_number = mod(ordered.transaction_number - 1, visitor.visitor_count) + 1
  JOIN library_books AS book
    ON book.library_id = ordered.library_id
   AND book.book_number = mod(ordered.sequence_number - 1, book.book_count) + 1
  CROSS JOIN LATERAL (
    SELECT
      least(
        ordered.month_start::timestamp
        + mod(ordered.sequence_number * 13, greatest(
            1,
            least(
              (ordered.month_start + interval '1 month' - interval '1 day')::date,
              current_date - 1
            ) - ordered.month_start + 1
          )) * interval '1 day'
        + mod(ordered.sequence_number * 37, 12) * interval '1 hour',
        now()
      ) AS request_date
  ) AS requested
  CROSS JOIN LATERAL (
    SELECT requested.request_date,
      least(requested.request_date + interval '1 day' + mod(ordered.sequence_number * 5, 12) * interval '1 hour', now()) AS borrow_date
  ) AS transaction_dates
)
INSERT INTO public.borrow_requests (
  id,
  book_id,
  book_title,
  visitor_id,
  visitor_name,
  status,
  request_date,
  borrow_date,
  due_date,
  return_date,
  fine_amount,
  confirmed_by,
  return_confirmed_by
)
SELECT
  (jsonb_populate_record(
    NULL::public.borrow_requests,
    jsonb_build_object('id', generated.id)
  )).id,
  generated.book_id,
  generated.book_title,
  generated.visitor_id,
  generated.visitor_name,
  generated.status,
  generated.request_date,
  generated.borrow_date,
  generated.due_date,
  generated.return_date,
  generated.fine_amount,
  'Test data seed',
  'Test data seed'
FROM generated
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Confirm the per-branch, per-month distribution of seeded transactions.
SELECT
  library.name AS library,
  to_char(date_trunc('month', request.request_date), 'YYYY-MM') AS transaction_month,
  count(*) AS transaction_count
FROM public.borrow_requests AS request
JOIN public.books AS book ON book.id = request.book_id
JOIN public.libraries AS library ON library.id = book.library_id
WHERE request.confirmed_by = 'Test data seed'
  AND request.return_confirmed_by = 'Test data seed'
  AND request.request_date >= date_trunc('month', current_date) - interval '11 months'
GROUP BY library.name, date_trunc('month', request.request_date)
ORDER BY date_trunc('month', request.request_date), library.name;
