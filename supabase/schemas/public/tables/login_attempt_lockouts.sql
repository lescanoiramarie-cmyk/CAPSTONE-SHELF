CREATE TABLE "public"."login_attempt_lockouts" (
  "normalized_email" text                     NOT NULL,
  "failed_attempts"  integer                  NOT NULL DEFAULT 0,
  "locked_until"     timestamp with time zone,
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "login_attempt_lockouts_failed_attempts_check" CHECK ((failed_attempts >= 0)),
  CONSTRAINT "login_attempt_lockouts_pkey" PRIMARY KEY (normalized_email)
);

ALTER TABLE "public"."login_attempt_lockouts"
  ENABLE ROW LEVEL SECURITY;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."login_attempt_lockouts" TO "postgres", "service_role";
