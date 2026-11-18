-- Add coordinates verification tracking for library locations
-- Addresses BatStateU JPLPC Malvar Campus location error (was pointing to Darasa, Tanauan)
-- CORRECTED COORDINATES (verified against OpenStreetMap, Wikipedia, PhilAtlas):
--   BatStateU JPLPC Malvar Campus: 14.04482, 121.15677 (G. Leviste St., Poblacion, Malvar, Batangas)
--   Previous incorrect: 14.0672, 121.1597 (Darasa, Tanauan - ~2.5km away)
-- Allows marking coordinates as verified by owner/admin

ALTER TABLE public.libraries
ADD COLUMN IF NOT EXISTS coordinates_verified boolean DEFAULT false;

COMMENT ON COLUMN public.libraries.coordinates_verified IS
'Indicates whether the lat/lng coordinates have been verified by the library owner or authorized administrator. Default false means coordinates need verification. BatStateU JPLPC Malvar Campus corrected to 14.04482, 121.15677 per authoritative sources.';

-- Postflight assertion
DO $$
DECLARE
  v_has_column boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'libraries'
      AND column_name = 'coordinates_verified'
  ) INTO v_has_column;

  IF NOT v_has_column THEN
    RAISE EXCEPTION 'Postflight failed: coordinates_verified column not added to libraries table';
  END IF;
END $$;

-- Verification procedure for owner:
-- 1. Run in Supabase Dashboard SQL editor:
--    UPDATE public.libraries
--    SET lat = 14.04482, lng = 121.15677, coordinates_verified = true
--    WHERE id = '277829af-1475-47ae-9e26-4b64c68f54f4';
-- 2. Verify in LibraryMap component shows correct location
-- 3. Cross-reference with Google Maps / OpenStreetMap