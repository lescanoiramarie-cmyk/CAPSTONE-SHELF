BEGIN;

-- Drop the wrapper first because it depends on the private helper. The
-- transaction ensures both functions are restored if any statement fails.
DROP FUNCTION public.get_visitor_borrow_requests(uuid);
DROP FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid);

CREATE FUNCTION shelf_private.get_visitor_borrow_requests_unchecked (
  p_visitor_id uuid
)
RETURNS TABLE (
  id text,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  status text,
  request_date timestamp with time zone,
  pickup_deadline timestamp with time zone,
  queue_position integer,
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text,
  fine_rate_snapshot integer,
  fine_review_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    br.id::text,
    br.book_id::text,
    br.book_title::text,
    br.visitor_id::text,
    br.visitor_name::text,
    br.status::text,
    br.request_date,
    br.pickup_deadline,
    br.queue_position,
    br.borrow_date,
    br.due_date,
    br.return_date,
    br.fine_amount::numeric,
    br.confirmed_by::text,
    br.return_confirmed_by::text,
    br.fine_rate_snapshot,
    (
      COALESCE(br.fine_review_required, false)
      OR (
        COALESCE(br.fine_amount, 0) <> 0
        AND (
          br.status <> 'returned'
          OR br.fine_rate_snapshot IS NULL
          OR br.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
      OR (
        br.status IN ('borrowed', 'returned')
        AND (
          br.fine_rate_snapshot IS NULL
          OR br.fine_rate_snapshot NOT IN (10, 15, 20)
        )
      )
    ) AS fine_review_required
  FROM public.borrow_requests AS br
  JOIN public.visitors AS v ON v.id = br.visitor_id
  WHERE v.auth_user_id = p_visitor_id
  ORDER BY br.request_date DESC;
END;
$function$;

ALTER FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid)
  TO postgres;
REVOKE ALL ON FUNCTION shelf_private.get_visitor_borrow_requests_unchecked(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_visitor_borrow_requests (
  p_visitor_id uuid
)
RETURNS TABLE (
  id text,
  book_id text,
  book_title text,
  visitor_id text,
  visitor_name text,
  status text,
  request_date timestamp with time zone,
  pickup_deadline timestamp with time zone,
  queue_position integer,
  borrow_date timestamp with time zone,
  due_date timestamp with time zone,
  return_date timestamp with time zone,
  fine_amount numeric,
  confirmed_by text,
  return_confirmed_by text,
  fine_rate_snapshot integer,
  fine_review_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_visitor_id THEN
    RAISE EXCEPTION 'The authenticated visitor account could not be verified.';
  END IF;

  RETURN QUERY
  SELECT *
  FROM shelf_private.get_visitor_borrow_requests_unchecked(p_visitor_id);
END;
$function$;

ALTER FUNCTION public.get_visitor_borrow_requests(uuid)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_visitor_borrow_requests(uuid)
  TO authenticated, postgres, service_role;
REVOKE ALL ON FUNCTION public.get_visitor_borrow_requests(uuid)
  FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
COMMIT;