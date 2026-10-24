-- Approved C08/C09: opt-in informational mail/push and explicit private-profile consent.
-- Legacy default-true flags are not proof of consent; retain their values but require a consent timestamp.
ALTER TABLE member_settings ALTER COLUMN email_notifications SET DEFAULT false;
ALTER TABLE member_settings
  ADD COLUMN informational_email_consent_at timestamptz,
  ADD COLUMN profile_sharing_consent_at timestamptz,
  ADD COLUMN push_notifications boolean NOT NULL DEFAULT false;
