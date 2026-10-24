-- Approved C10: retain approval history while membership exists, and for 365 days after exit.
-- Current membership_verifications remains the mutable current-approval projection.
ALTER TABLE tribe_memberships ADD COLUMN exited_at timestamptz;
-- Prior exit time cannot be reconstructed reliably; conservatively start legacy retention now.
UPDATE tribe_memberships SET exited_at=clock_timestamp() WHERE status='revoked';
CREATE INDEX memberships_retention_exit_idx ON tribe_memberships(exited_at) WHERE status='revoked';
CREATE TABLE membership_verification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL,
  tribe_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  event_type text NOT NULL CHECK(event_type IN ('approved','state_changed')),
  membership_status text NOT NULL CHECK(membership_status IN ('pending','active','suspended','revoked')),
  evidence_reference text CHECK(length(evidence_reference) BETWEEN 1 AND 500),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(membership_id,tribe_id) REFERENCES tribe_memberships(id,tribe_id),
  CHECK ((event_type='approved' AND evidence_reference IS NOT NULL AND membership_status='active')
    OR (event_type='state_changed' AND evidence_reference IS NULL))
);
CREATE INDEX verification_history_member_time_idx ON membership_verification_history(membership_id,recorded_at,id);
INSERT INTO membership_verification_history(membership_id,tribe_id,actor_user_id,event_type,membership_status,evidence_reference,recorded_at)
SELECT v.membership_id,m.tribe_id,v.verified_by,'approved','active',v.evidence_reference,v.verified_at
FROM membership_verifications v JOIN tribe_memberships m ON m.id=v.membership_id;
CREATE FUNCTION reject_verification_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Membership verification history is append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER verification_history_no_update BEFORE UPDATE ON membership_verification_history
FOR EACH ROW EXECUTE FUNCTION reject_verification_history_update();
-- Runtime must have SELECT/INSERT only on this table. DELETE belongs to the dedicated retention role.
