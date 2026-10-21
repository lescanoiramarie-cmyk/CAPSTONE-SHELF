CREATE OR REPLACE FUNCTION public.scan_attendance (
  p_qr         text,
  p_library_id text
)
  RETURNS TABLE (
    log_id       text,
    visitor_id   text,
    visitor_name text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
    DECLARE
      v_visitor RECORD;
        v_log_id TEXT;
          library_id_type TEXT;
          BEGIN
            SELECT *
                INTO v_visitor
                    FROM public.visitors
                       WHERE qr_code = pg_catalog.btrim(p_qr);

                         IF v_visitor.id IS NULL THEN
                             RAISE EXCEPTION 'QR code not recognized. Please check the pass and try again.';
                               END IF;

                                 SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
                                     INTO library_id_type
                                         FROM pg_catalog.pg_attribute AS attribute
                                            WHERE attribute.attrelid = 'public.attendance_logs'::regclass
                                                 AND attribute.attname = 'library_id'
                                                      AND NOT attribute.attisdropped;

                                                        IF library_id_type IS NULL THEN
                                                            RAISE EXCEPTION 'attendance_logs.library_id column is missing.';
                                                              END IF;

                                                                EXECUTE pg_catalog.format(
                                                                    'INSERT INTO public.attendance_logs (visitor_id, visitor_name, library_id) VALUES ($1, $2, $3::%s) RETURNING id::text',
                                                                        library_id_type
                                                                          )
                                                                              INTO v_log_id
                                                                                  USING v_visitor.id, v_visitor.full_name, p_library_id;

                                                                                    RETURN QUERY
                                                                                      SELECT v_log_id, v_visitor.id::TEXT, v_visitor.full_name::TEXT;
                                                                                      END;
                                                                                      $function$;

GRANT EXECUTE ON FUNCTION "public"."scan_attendance"(text, text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."scan_attendance"(text, text) FROM PUBLIC;
