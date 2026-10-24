-- No plaintext tokens or provider error messages are retained.
CREATE TABLE push_delivery_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES notification_delivery_jobs(id),device_id uuid NOT NULL,
 token_hash text NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','attempted','provider_accepted','provider_rejected','retry_scheduled','permanently_failed','provider_handoff','receipt_unknown','suppressed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),receipt_attempts integer NOT NULL DEFAULT 0,
 ticket_id text CHECK(length(ticket_id)<=256),error_code text CHECK(error_code IN ('DeviceNotRegistered','MessageTooBig','MessageRateExceeded','MismatchSenderId','InvalidCredentials','transport','protocol','receipt_expired','unavailable')),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,
 accepted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,device_id),CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX push_delivery_due ON push_delivery_attempts(next_attempt_at) WHERE status IN ('queued','attempted','retry_scheduled','provider_accepted');
