CREATE TABLE "public"."password_reset_codes" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "email"        text                     NOT NULL,
  "auth_user_id" uuid                     NOT NULL,
  "account_kind" text                     NOT NULL,
  "code_hash"    text                     NOT NULL,
  "expires_at"   timestamp with time zone NOT NULL,
  "attempts"     integer                  NOT NULL DEFAULT 0,
  "consumed_at"  timestamp with time zone,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "password_reset_codes_account_kind_check" CHECK ((account_kind = ANY (ARRAY['visitor'::text, 'staff'::text]))),
  CONSTRAINT "password_reset_codes_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "password_reset_codes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."password_reset_codes"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX password_reset_codes_email_idx ON public.password_reset_codes USING btree (lower(email), created_at DESC);

CREATE INDEX password_reset_codes_user_idx ON public.password_reset_codes USING btree (auth_user_id, created_at DESC);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."password_reset_codes" TO "postgres", "service_role";
