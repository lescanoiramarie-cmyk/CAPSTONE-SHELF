CREATE OR REPLACE FUNCTION public.release_copy_and_promote (
  p_book_id text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
                                                                                        DECLARE
                                                                                          v_next public.borrow_requests%ROWTYPE;
                                                                                          BEGIN
                                                                                            UPDATE public.books
                                                                                                 SET available_copies = available_copies + 1
                                                                                                    WHERE id::TEXT = p_book_id;

                                                                                                      SELECT *
                                                                                                          INTO v_next
                                                                                                              FROM public.borrow_requests
                                                                                                                 WHERE book_id::TEXT = p_book_id
                                                                                                                      AND status = 'queued'
                                                                                                                         ORDER BY queue_position ASC
                                                                                                                            LIMIT 1;

                                                                                                                              IF v_next.id IS NOT NULL THEN
                                                                                                                                  UPDATE public.borrow_requests
                                                                                                                                         SET status = 'ready_for_pickup',
                                                                                                                                                    pickup_deadline = pg_catalog.now() + INTERVAL '24 hours',
                                                                                                                                                               queue_position = NULL
                                                                                                                                                                    WHERE id = v_next.id;

                                                                                                                                                                        UPDATE public.books
                                                                                                                                                                               SET available_copies = available_copies - 1
                                                                                                                                                                                    WHERE id::TEXT = p_book_id;

                                                                                                                                                                                        UPDATE public.borrow_requests AS request
                                                                                                                                                                                               SET queue_position = queued.row_number
                                                                                                                                                                                                     FROM (
                                                                                                                                                                                                             SELECT id,
                                                                                                                                                                                                                            pg_catalog.row_number() OVER (ORDER BY queue_position ASC) AS row_number
                                                                                                                                                                                                                                      FROM public.borrow_requests
                                                                                                                                                                                                                                               WHERE book_id::TEXT = p_book_id
                                                                                                                                                                                                                                                          AND status = 'queued'
                                                                                                                                                                                                                                                                ) AS queued
                                                                                                                                                                                                                                                                     WHERE request.id = queued.id;
                                                                                                                                                                                                                                                                       END IF;
                                                                                                                                                                                                                                                                       END;
                                                                                                                                                                                                                                                                       $function$;

CREATE OR REPLACE FUNCTION public.release_copy_and_promote (
  p_book_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
                                                                                                                                                                                                                                                                         BEGIN
                                                                                                                                                                                                                                                                           PERFORM public.release_copy_and_promote(p_book_id::TEXT);
                                                                                                                                                                                                                                                                           END;
                                                                                                                                                                                                                                                                           $function$;

GRANT EXECUTE ON FUNCTION "public"."release_copy_and_promote"(text) TO "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."release_copy_and_promote"(uuid) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."release_copy_and_promote"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."release_copy_and_promote"(uuid) FROM PUBLIC;
