-- PostgREST cannot disambiguate the text and uuid overloads from JSON input.
-- Keep the text signature used by the client and remove the stale uuid version.
drop function if exists public.toggle_attendance(text, uuid);

notify pgrst, 'reload schema';
