-- Informational notifications are separate from mandatory authentication mail.
CREATE TABLE notification_events (
 id uuid PRIMARY KEY, tribe_id uuid NOT NULL REFERENCES tribes(id),
 kind text NOT NULL CHECK(kind IN ('announcement.published','event.published','event.updated','event.cancelled','registration.registered','registration.cancelled')),
 resource_type text NOT NULL CHECK(resource_type IN ('announcement','event')),resource_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(resource_type=CASE WHEN kind='announcement.published' THEN 'announcement' ELSE 'event' END)
);
ALTER TABLE notifications ADD COLUMN source_event_id uuid REFERENCES notification_events(id),
 ADD COLUMN source_type text CHECK(source_type IN ('announcement','event')),ADD COLUMN source_id uuid,
 ADD CONSTRAINT notifications_source_pair CHECK((source_type IS NULL)=(source_id IS NULL)),
 ADD CONSTRAINT notifications_source_required CHECK(source_event_id IS NULL OR source_type IS NOT NULL),
 ADD CONSTRAINT notifications_event_recipient UNIQUE(source_event_id,membership_id),
 ADD CONSTRAINT notifications_id_recipient UNIQUE(id,membership_id);
CREATE TABLE notification_delivery_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),notification_id uuid NOT NULL,membership_id uuid NOT NULL,
 tribe_id uuid NOT NULL REFERENCES tribes(id),channel text NOT NULL CHECK(channel IN ('email','push')),
 payload_ciphertext text,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','submitted','delivered','suppressed','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,lease_until timestamptz,submitted_reference text,
 last_error text CHECK(last_error IN ('transport','payload','recipient_unavailable','consent_withdrawn')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(notification_id,membership_id) REFERENCES notifications(id,membership_id),
 UNIQUE(notification_id,channel),
 CHECK((status='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (status<>'leased' AND lease_token IS NULL AND lease_until IS NULL)),
 CHECK(status NOT IN ('pending','leased') OR payload_ciphertext IS NOT NULL),
 CHECK(status NOT IN ('delivered','suppressed','failed') OR payload_ciphertext IS NULL)
);
CREATE INDEX notification_delivery_pending ON notification_delivery_jobs(next_attempt_at,created_at) WHERE status IN ('pending','leased');
