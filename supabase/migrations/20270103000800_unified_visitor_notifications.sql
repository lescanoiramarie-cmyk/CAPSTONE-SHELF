-- Version: 20270103000800. Unified visitor notifications table.
-- Consolidates fine reminders, community book request notifications, and other visitor-facing alerts.

BEGIN;

-- Unified visitor notifications table
CREATE TABLE IF NOT EXISTS public.visitor_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id text NOT NULL REFERENCES public.visitors(id) ON DELETE CASCADE,
    notification_type text NOT NULL
        CHECK (notification_type IN (
            'fine_reminder',
            'community_request_pending',
            'community_request_approved',
            'community_request_rejected',
            'community_due_soon',
            'community_due_today',
            'community_overdue',
            'announcement'
        )),
    title text NOT NULL,
    message text NOT NULL,
    reference_id uuid,
    reference_type text CHECK (reference_type IN ('borrow_request', 'community_book_request', 'announcement')),
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);

ALTER TABLE public.visitor_notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Visitors can only see their own notifications
DROP POLICY IF EXISTS "Visitors read their own notifications" ON public.visitor_notifications;
CREATE POLICY "Visitors read their own notifications"
    ON public.visitor_notifications FOR SELECT TO authenticated
    USING (visitor_id = auth.uid()::text OR visitor_id IN (
        SELECT id FROM public.visitors WHERE auth_user_id = auth.uid()
    ));

-- Policy: Visitors can update their own notifications (mark as read)
DROP POLICY IF EXISTS "Visitors update their own notifications" ON public.visitor_notifications;
CREATE POLICY "Visitors update their own notifications"
    ON public.visitor_notifications FOR UPDATE TO authenticated
    USING (visitor_id = auth.uid()::text OR visitor_id IN (
        SELECT id FROM public.visitors WHERE auth_user_id = auth.uid()
    ))
    WITH CHECK (visitor_id = auth.uid()::text OR visitor_id IN (
        SELECT id FROM public.visitors WHERE auth_user_id = auth.uid()
    ));

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS visitor_notifications_visitor_id_created_at_idx
    ON public.visitor_notifications (visitor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS visitor_notifications_unread_idx
    ON public.visitor_notifications (visitor_id, created_at DESC)
    WHERE read_at IS NULL;

-- Function to get visitor notifications
CREATE OR REPLACE FUNCTION public.get_visitor_notifications(
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0,
    p_unread_only boolean DEFAULT false
)
RETURNS SETOF public.visitor_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_visitor_id text;
    v_query text;
BEGIN
    -- Resolve the current visitor's SHELF visitor ID
    -- First check if auth.uid() is a visitor ID (text)
    v_visitor_id := auth.uid()::text;

    -- If auth.uid() is a UUID, it's an auth_user_id; look up the visitor
    IF v_visitor_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_visitor_id
        FROM public.visitors
        WHERE auth_user_id = auth.uid()
        LIMIT 1;

        IF v_visitor_id IS NULL THEN
            RETURN QUERY SELECT * FROM public.visitor_notifications WHERE false;
        END IF;
    END IF;

    -- Build and execute the query
    v_query := 'SELECT * FROM public.visitor_notifications WHERE visitor_id = $1';

    IF p_unread_only THEN
        v_query := v_query || ' AND read_at IS NULL';
    END IF;

    v_query := v_query || ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';

    RETURN QUERY EXECUTE v_query USING v_visitor_id, p_limit, p_offset;
END;
$function$;

-- Function to mark a notification as read
CREATE OR REPLACE FUNCTION public.mark_visitor_notification_read(
    p_notification_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_visitor_id text;
    v_updated integer;
BEGIN
    -- Resolve the current visitor's SHELF visitor ID
    v_visitor_id := auth.uid()::text;

    IF v_visitor_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_visitor_id
        FROM public.visitors
        WHERE auth_user_id = auth.uid()
        LIMIT 1;

        IF v_visitor_id IS NULL THEN
            RAISE EXCEPTION 'Visitor profile not found.';
        END IF;
    END IF;

    -- Update the notification
    UPDATE public.visitor_notifications
    SET read_at = COALESCE(read_at, now())
    WHERE id = p_notification_id
        AND visitor_id = v_visitor_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Notification not found or access denied.';
    END IF;
END;
$function$;

-- Function to mark all notifications as read
CREATE OR REPLACE FUNCTION public.mark_all_visitor_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_visitor_id text;
    v_updated integer;
BEGIN
    -- Resolve the current visitor's SHELF visitor ID
    v_visitor_id := auth.uid()::text;

    IF v_visitor_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_visitor_id
        FROM public.visitors
        WHERE auth_user_id = auth.uid()
        LIMIT 1;

        IF v_visitor_id IS NULL THEN
            RAISE EXCEPTION 'Visitor profile not found.';
        END IF;
    END IF;

    -- Update all unread notifications
    UPDATE public.visitor_notifications
    SET read_at = now()
    WHERE visitor_id = v_visitor_id
        AND read_at IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RETURN v_updated;
END;
$function$;

-- Function to create a notification (for internal use by other functions/triggers)
CREATE OR REPLACE FUNCTION public.create_visitor_notification(
    p_visitor_id text,
    p_notification_type text,
    p_title text,
    p_message text,
    p_reference_id uuid DEFAULT NULL,
    p_reference_type text DEFAULT NULL,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_notification_id uuid;
BEGIN
    INSERT INTO public.visitor_notifications (
        visitor_id,
        notification_type,
        title,
        message,
        reference_id,
        reference_type,
        expires_at
    ) VALUES (
        p_visitor_id,
        p_notification_type,
        p_title,
        p_message,
        p_reference_id,
        p_reference_type,
        p_expires_at
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$function$;

-- Grant permissions
REVOKE ALL ON public.visitor_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.visitor_notifications TO authenticated;
GRANT SELECT, UPDATE ON public.visitor_notifications TO service_role;

REVOKE ALL ON FUNCTION public.get_visitor_notifications(integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visitor_notifications(integer, integer, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_visitor_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_visitor_notification_read(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_all_visitor_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_visitor_notifications_read() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_visitor_notification(text, text, text, text, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_visitor_notification(text, text, text, text, uuid, text, timestamptz) TO authenticated, service_role;

-- Migrate existing fine reminder notifications from due_date_notifications
INSERT INTO public.visitor_notifications (
    visitor_id,
    notification_type,
    title,
    message,
    reference_id,
    reference_type,
    created_at,
    read_at
)
SELECT
    visitor_id,
    'fine_reminder',
    'Outstanding fine reminder',
    'Your library sent an email reminder about your confirmed outstanding fine. Review your borrowing activity for the book and current balance.',
    borrow_request_id,
    'borrow_request',
    sent_at,
    NULL
FROM public.due_date_notifications
WHERE notification_type = 'fine_reminder'
ON CONFLICT DO NOTHING;

-- Migrate community book request notifications (pending requests for book owners)
INSERT INTO public.visitor_notifications (
    visitor_id,
    notification_type,
    title,
    message,
    reference_id,
    reference_type,
    created_at,
    read_at
)
SELECT
    cb.owner_visitor_id,
    'community_request_pending',
    'New community book request',
    cb.requester_name || ' requested "' || cb.book_title || '"',
    cb.id::uuid,
    'community_book_request',
    cb.request_date,
    NULL
FROM public.community_book_requests cb
WHERE cb.status = 'pending'
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;