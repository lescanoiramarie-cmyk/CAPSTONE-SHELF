CREATE TABLE "shelf_private"."visitor_qr_login_rate_limits" (
  "client_hash"       text                     NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "attempt_count"     integer                  NOT NULL,
  CONSTRAINT "visitor_qr_login_rate_limits_attempt_count_check" CHECK ((attempt_count > 0)),
  CONSTRAINT "visitor_qr_login_rate_limits_client_hash_check" CHECK ((client_hash ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "visitor_qr_login_rate_limits_pkey" PRIMARY KEY (client_hash)
);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "shelf_private"."visitor_qr_login_rate_limits" TO "postgres";
