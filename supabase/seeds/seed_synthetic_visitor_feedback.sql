-- Seed up to 500 clearly labeled test feedback entries for the dashboard.
-- Uses registered visitors when available; on an empty local database it
-- creates synthetic visitor names in feedback only (no visitor accounts).
-- Safe to rerun; existing numbered seed entries are preserved.
-- Run only against a local/test Supabase project.

BEGIN;

WITH name_data AS (
  SELECT
    ARRAY['Aira', 'Bea', 'Carlo', 'Daphne', 'Elijah', 'Hannah', 'Jasmine', 'Luis', 'Mara', 'Sofia']::text[] AS first_names,
    ARRAY['Aguilar', 'Bautista', 'Cruz', 'Flores', 'Garcia', 'Mendoza', 'Reyes', 'Santos', 'Torres', 'Villanueva']::text[] AS last_names
),
visitor_pool AS MATERIALIZED (
  SELECT
    visitor.id AS visitor_id,
    visitor.full_name AS visitor_name,
    visitor.email AS visitor_email,
    to_jsonb(visitor)->>'library_id' AS assigned_library_id,
    row_number() OVER (ORDER BY random()) AS visitor_number,
    count(*) OVER () AS visitor_count
  FROM public.visitors AS visitor
),
visitor_stats AS (
  SELECT count(*) AS visitor_count FROM visitor_pool
),
randomized_libraries AS MATERIALIZED (
  SELECT
    library.id,
    row_number() OVER (ORDER BY random()) AS library_number,
    count(*) OVER () AS library_count
  FROM public.libraries AS library
),
feedback_topics (topic_number, category, message) AS (
  VALUES
    (1, 'Book collection', 'I would appreciate more titles and updated editions in this subject area.'),
    (2, 'Facilities', 'The reading area is helpful. A few more comfortable seats would make longer visits easier.'),
    (3, 'Staff assistance', 'The staff helped me find what I needed. Thank you for the welcoming service.'),
    (4, 'Digital services', 'The online catalog is useful. Clearer filters would make it easier to find related books.'),
    (5, 'Library hours', 'It would be helpful to have the library open a little later on selected days.'),
    (6, 'General', 'I had a good experience during my visit and was able to find useful resources.')
),
feedback_sequence AS MATERIALIZED (
  SELECT
    sequence.test_number,
    floor(random() * 6)::integer + 1 AS topic_number,
    now() - random() * interval '180 days' AS created_at
  FROM generate_series(1, 500) AS sequence(test_number)
),
generated_feedback AS MATERIALIZED (
  SELECT
    sequence.test_number,
    visitor.visitor_id,
    coalesce(
      visitor.visitor_name,
      name_data.first_names[1 + mod(sequence.test_number - 1, array_length(name_data.first_names, 1))]
        || ' ' || name_data.last_names[1 + mod(sequence.test_number * 7 - 1, array_length(name_data.last_names, 1))]
    ) AS visitor_name,
    coalesce(visitor.visitor_email, format('test-visitor+%s@example.test', lpad(sequence.test_number::text, 4, '0'))) AS visitor_email,
    coalesce(assigned_library.id, fallback_library.id) AS library_id,
    topic.category,
    format('Test data #%s - Visitor feedback', lpad(sequence.test_number::text, 4, '0')) AS subject,
    topic.message,
    CASE sequence.test_number % 5
      WHEN 0 THEN 'answered'
      WHEN 1 THEN 'in_review'
      ELSE 'new'
    END AS status,
    sequence.created_at
  FROM feedback_sequence AS sequence
  CROSS JOIN visitor_stats
  CROSS JOIN name_data
  LEFT JOIN visitor_pool AS visitor
    ON visitor.visitor_number = mod(sequence.test_number - 1, nullif(visitor_stats.visitor_count, 0)) + 1
  LEFT JOIN public.libraries AS assigned_library
    ON assigned_library.id::text = visitor.assigned_library_id
  LEFT JOIN randomized_libraries AS fallback_library
    ON fallback_library.library_number = mod(sequence.test_number - 1, nullif(fallback_library.library_count, 0)) + 1
  JOIN feedback_topics AS topic ON topic.topic_number = sequence.topic_number
)
INSERT INTO public.visitor_feedback (
  visitor_id,
  library_id,
  visitor_name,
  visitor_email,
  category,
  subject,
  message,
  status,
  admin_reply,
  replied_by,
  replied_at,
  created_at
)
SELECT
  generated.visitor_id,
  generated.library_id,
  generated.visitor_name,
  generated.visitor_email,
  generated.category,
  generated.subject,
  generated.message,
  generated.status,
  CASE WHEN generated.status = 'answered'
    THEN 'Thank you for sharing this feedback. We have noted it for the branch team.'
    ELSE NULL
  END,
  CASE WHEN generated.status = 'answered' THEN 'Test data' ELSE NULL END,
  CASE WHEN generated.status = 'answered' THEN least(now(), generated.created_at + interval '1 day') ELSE NULL END,
  generated.created_at
FROM generated_feedback AS generated
WHERE NOT EXISTS (
  SELECT 1
  FROM public.visitor_feedback AS existing
  WHERE existing.subject = generated.subject
);

COMMIT;
