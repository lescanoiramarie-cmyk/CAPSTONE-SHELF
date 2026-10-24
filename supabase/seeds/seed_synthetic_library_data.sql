BEGIN;

WITH name_data AS (
  SELECT
    ARRAY[
      'Aira', 'Althea', 'Andrea', 'Angelo', 'Bea', 'Carlo', 'Celine', 'Daniel',
      'Daphne', 'Elijah', 'Erika', 'Gabriel', 'Hannah', 'Isaac', 'Jasmine',
      'Joshua', 'Katrina', 'Lance', 'Leah', 'Luis', 'Mara', 'Miguel', 'Nina',
      'Paolo', 'Rafael', 'Sofia', 'Therese', 'Tristan', 'Ysabel', 'Zachary'
    ]::text[] AS first_names,
    ARRAY[
      'Aguilar', 'Bautista', 'Castillo', 'Cruz', 'Dela Cruz', 'Flores',
      'Garcia', 'Gonzales', 'Mendoza', 'Navarro', 'Reyes', 'Rivera',
      'Santos', 'Torres', 'Villanueva'
    ]::text[] AS last_names
),
visitor_rows AS (
  SELECT
    library.id AS library_id,
    visitor_number,
    'SYN-' || substr(
      md5(library.id::text || '|shelf-synthetic-visitor|' || visitor_number::text),
      1,
      24
    ) AS visitor_id,
    'shelf-test+' || substr(md5(library.id::text), 1, 8) || '-'
      || lpad(visitor_number::text, 4, '0') || '@example.test' AS email,
    '[TEST] '
      || name_data.first_names[
        1 + (abs(hashtext(library.id::text || '|first|' || visitor_number::text)::bigint)
          % array_length(name_data.first_names, 1))
      ] || ' '
      || name_data.last_names[
        1 + (abs(hashtext(library.id::text || '|last|' || visitor_number::text)::bigint)
          % array_length(name_data.last_names, 1))
      ] AS full_name,
    current_timestamp
      - (abs(hashtext(library.id::text || '|registered|' || visitor_number::text)::bigint) % 365)
        * interval '1 day' AS registered_at
  FROM public.libraries AS library
  CROSS JOIN generate_series(1, 500) AS visitors(visitor_number)
  CROSS JOIN name_data
),
inserted_visitors AS (
  INSERT INTO public.visitors (
    id,
    full_name,
    email,
    library_id,
    registered_at,
    otp_verified,
    qr_code,
    auth_user_id,
    is_active,
    otp_attempts,
    terms_accepted_at
  )
  SELECT
    visitor_id,
    full_name,
    email,
    library_id,
    registered_at,
    false,
    NULL,
    NULL,
    false,
    0,
    NULL
  FROM visitor_rows
  ON CONFLICT (email) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        library_id = EXCLUDED.library_id,
        registered_at = EXCLUDED.registered_at,
        otp_verified = false,
        qr_code = NULL,
        auth_user_id = NULL,
        is_active = false,
        otp_attempts = 0,
        terms_accepted_at = NULL
  RETURNING id, full_name, library_id
),
month_ranges AS (
  SELECT
    month_offset,
    (
      date_trunc('month', current_date)::date
      - ((11 - month_offset) * interval '1 month')
    )::date AS month_start
  FROM generate_series(0, 11) AS months(month_offset)
),
library_months AS (
  SELECT
    library.id AS library_id,
    library.name AS library_name,
    month_ranges.month_offset,
    month_ranges.month_start,
    GREATEST(
      1,
      LEAST(
        (month_ranges.month_start + interval '1 month - 1 day')::date,
        current_date
      ) - month_ranges.month_start + 1
    ) AS available_days
  FROM public.libraries AS library
  CROSS JOIN month_ranges
),
attendance_rows AS (
  SELECT
    library_months.*,
    visit_number,
    ((month_offset * 300 + visit_number - 1) % 500) + 1 AS visitor_number,
    md5(
      library_id::text
      || '|shelf-demo-attendance|'
      || month_start::text
      || '|'
      || visit_number::text
    ) AS seed_key
  FROM library_months
  CROSS JOIN generate_series(1, 300) AS visits(visit_number)
),
attendance_times AS (
  SELECT
    attendance_rows.*,
    LEAST(
      month_start
        + (abs(hashtext(seed_key || '|day')::bigint) % available_days) * interval '1 day'
        + (8 + abs(hashtext(seed_key || '|hour')::bigint) % 10) * interval '1 hour'
        + (abs(hashtext(seed_key || '|minute')::bigint) % 60) * interval '1 minute',
      current_timestamp - interval '1 minute'
    ) AS time_in
  FROM attendance_rows
)
INSERT INTO public.attendance_logs (
  id,
  visitor_id,
  visitor_name,
  library_id,
  time_in,
  checked_out_at
)
SELECT
  attendance_times.seed_key::uuid,
  inserted_visitors.id,
  inserted_visitors.full_name,
  attendance_times.library_id,
  attendance_times.time_in,
  LEAST(
    attendance_times.time_in
      + (2 + abs(hashtext(attendance_times.seed_key || '|duration')::bigint) % 4)
        * interval '1 hour',
    current_timestamp
  )
FROM attendance_times
JOIN inserted_visitors
  ON inserted_visitors.library_id = attendance_times.library_id
 AND inserted_visitors.id = 'SYN-' || substr(
   md5(
     attendance_times.library_id::text
     || '|shelf-synthetic-visitor|'
     || attendance_times.visitor_number::text
   ),
   1,
   24
 )
ON CONFLICT (id) DO UPDATE
  SET visitor_id = EXCLUDED.visitor_id,
      visitor_name = EXCLUDED.visitor_name,
      library_id = EXCLUDED.library_id,
      time_in = EXCLUDED.time_in,
      checked_out_at = EXCLUDED.checked_out_at
  WHERE public.attendance_logs.visitor_id IS DISTINCT FROM EXCLUDED.visitor_id
     OR public.attendance_logs.visitor_name IS DISTINCT FROM EXCLUDED.visitor_name
     OR public.attendance_logs.library_id IS DISTINCT FROM EXCLUDED.library_id
     OR public.attendance_logs.time_in IS DISTINCT FROM EXCLUDED.time_in
     OR public.attendance_logs.checked_out_at IS DISTINCT FROM EXCLUDED.checked_out_at;

COMMIT;

WITH visitor_counts AS (
  SELECT library_id, count(*) AS synthetic_visitors
  FROM public.visitors
  WHERE email LIKE 'shelf-test+%@example.test'
  GROUP BY library_id
),
attendance_counts AS (
  SELECT
    library_id,
    count(*) AS synthetic_attendance_records,
    count(DISTINCT date_trunc('month', time_in)) AS months_covered,
    min(time_in)::date AS earliest_record,
    max(time_in)::date AS latest_record
  FROM public.attendance_logs
  WHERE visitor_name LIKE '[TEST] %'
  GROUP BY library_id
)
SELECT
  library.name AS library_name,
  coalesce(visitor_counts.synthetic_visitors, 0) AS synthetic_visitors,
  coalesce(attendance_counts.synthetic_attendance_records, 0) AS synthetic_attendance_records,
  coalesce(attendance_counts.months_covered, 0) AS months_covered,
  attendance_counts.earliest_record,
  attendance_counts.latest_record
FROM public.libraries AS library
LEFT JOIN visitor_counts ON visitor_counts.library_id = library.id
LEFT JOIN attendance_counts ON attendance_counts.library_id = library.id
ORDER BY library.name;
