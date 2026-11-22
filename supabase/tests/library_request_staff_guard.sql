-- Run only in a disposable database or inside a transaction that is rolled back.
DO $test$
DECLARE
  v_library uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_second_staff uuid := gen_random_uuid();
  v_visitor_uid uuid := gen_random_uuid();
  v_visitor text;
  v_book text := 'guard-test-' || gen_random_uuid()::text;
  v_message text;
  v_result public.borrow_requests%ROWTYPE;
BEGIN
  INSERT INTO public.libraries (id, name) VALUES (v_library, 'Request guard test');
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_staff, NULL, '{}'::jsonb, '{}'::jsonb),
         (v_second_staff, NULL, '{}'::jsonb, '{}'::jsonb),
         (v_visitor_uid, NULL, '{}'::jsonb, '{}'::jsonb);
  INSERT INTO public.staff_profiles (id, email, full_name, role, library_id, is_active)
  VALUES (v_staff, v_staff::text || '@example.invalid', 'Guard staff', 'subadmin', v_library, false),
         (v_second_staff, v_second_staff::text || '@example.invalid', 'Second staff', 'subadmin', v_library, false);
  INSERT INTO public.visitors (auth_user_id, full_name, email, otp_verified, is_active, library_id)
  VALUES (v_visitor_uid, 'Guard visitor', v_visitor_uid::text || '@example.invalid', true, true, v_library)
  RETURNING id INTO v_visitor;
  INSERT INTO public.books (id, title, author, library_id, available_copies, total_copies, fine_rate)
  VALUES (v_book, 'Guard test', 'Test author', v_library, 1, 1, 10);
  PERFORM set_config('request.jwt.claim.sub', v_visitor_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visitor_uid, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'visitor'))::text, true);

  BEGIN
    PERFORM public.request_borrow_v2(v_book);
    RAISE EXCEPTION 'FAIL: inactive branch accepted a borrow';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'Borrowing and reservations are temporarily unavailable%' THEN RAISE; END IF;
  END;
  IF (SELECT available_copies FROM public.books WHERE id = v_book) <> 1 OR
     EXISTS (SELECT 1 FROM public.borrow_requests WHERE book_id = v_book) THEN
    RAISE EXCEPTION 'FAIL: rejected borrow changed inventory or created a request';
  END IF;

  UPDATE public.books SET available_copies = 0 WHERE id = v_book;
  BEGIN
    PERFORM public.request_borrow_v2(v_book);
    RAISE EXCEPTION 'FAIL: inactive branch accepted a waitlist request';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'Borrowing and reservations are temporarily unavailable%' THEN RAISE; END IF;
  END;
  UPDATE public.books SET available_copies = 1 WHERE id = v_book;

  BEGIN
    PERFORM public.reserve_book_for_date_v1(v_book, CURRENT_DATE + 10);
    RAISE EXCEPTION 'FAIL: inactive branch accepted a scheduled reservation';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'Borrowing and reservations are temporarily unavailable%' THEN RAISE; END IF;
  END;

  -- A second active sub-admin keeps the branch operational. No subscription row
  -- is needed; this is also the state after the subscription is terminated.
  DELETE FROM public.library_subscriptions WHERE library_id = v_library;
  UPDATE public.staff_profiles SET is_active = true WHERE id = v_second_staff;
  SELECT * INTO v_result FROM public.request_borrow_v2(v_book);
  IF v_result.status <> 'ready_for_pickup' THEN RAISE EXCEPTION 'FAIL: active branch rejected borrowing'; END IF;
  DELETE FROM public.borrow_requests WHERE book_id = v_book;
  UPDATE public.books SET available_copies = 1 WHERE id = v_book;
  SELECT * INTO v_result FROM public.reserve_book_for_date_v1(v_book, CURRENT_DATE + 10);
  IF v_result.status <> 'scheduled' THEN RAISE EXCEPTION 'FAIL: active branch rejected reservation'; END IF;
  DELETE FROM public.borrow_requests WHERE book_id = v_book;
  UPDATE public.books SET available_copies = 0 WHERE id = v_book;
  SELECT * INTO v_result FROM public.request_borrow_v2(v_book);
  IF v_result.status <> 'queued' THEN RAISE EXCEPTION 'FAIL: active branch rejected waitlist'; END IF;
  RAISE NOTICE 'PASS: borrow and reservation guard, rollback, active staff and no subscription';
END;
$test$;
