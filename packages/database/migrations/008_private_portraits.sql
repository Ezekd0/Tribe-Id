-- Approved C07: private, explicitly consented image uploads; no image bytes in PostgreSQL.
ALTER TABLE assets
  ADD COLUMN upload_key text UNIQUE,
  ADD COLUMN upload_expires_at timestamptz,
  ADD COLUMN source_mime_type text CHECK(source_mime_type IN ('image/png','image/jpeg','image/webp')),
  ADD COLUMN declared_size_bytes bigint CHECK(declared_size_bytes>0 AND declared_size_bytes<=5242880);
CREATE TABLE asset_deletions (
  object_key text PRIMARY KEY,
  not_before timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  last_error text CHECK(last_error IS NULL OR last_error='STORAGE_UNAVAILABLE'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX asset_deletions_due_idx ON asset_deletions(not_before);
CREATE INDEX assets_pending_expiry_idx ON assets(upload_expires_at) WHERE status='pending';
