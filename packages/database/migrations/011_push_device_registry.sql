CREATE TABLE push_device_registrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL UNIQUE REFERENCES device_sessions(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider='expo'),platform text NOT NULL CHECK(platform IN ('android','ios')),
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),token_ciphertext text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
-- Every logout/revoke path already revokes the session. Remove its routing secret too.
CREATE FUNCTION remove_revoked_push_device() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revoked_at IS NOT NULL THEN DELETE FROM push_device_registrations WHERE session_id=NEW.id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER remove_revoked_push_device AFTER UPDATE OF revoked_at ON device_sessions
 FOR EACH ROW WHEN (NEW.revoked_at IS NOT NULL) EXECUTE FUNCTION remove_revoked_push_device();
