ALTER TABLE users ADD COLUMN account_status text NOT NULL DEFAULT 'enabled' CHECK(account_status IN ('enabled','disabled'));
ALTER TABLE users ADD COLUMN credential_version integer NOT NULL DEFAULT 1 CHECK(credential_version>0);
ALTER TABLE users ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE device_sessions ADD COLUMN credential_version integer NOT NULL DEFAULT 1 CHECK(credential_version>0);
ALTER TABLE device_sessions ADD COLUMN mfa_verified_at timestamptz;
ALTER TABLE account_tokens DROP CONSTRAINT account_tokens_purpose_check;
ALTER TABLE account_tokens ADD CONSTRAINT account_tokens_purpose_check CHECK(purpose IN ('verify_email','reset_password','change_email'));
ALTER TABLE account_tokens ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE account_tokens ADD COLUMN credential_version integer NOT NULL DEFAULT 1 CHECK(credential_version>0);
ALTER TABLE account_tokens ADD COLUMN target_email text CHECK(target_email=lower(target_email));
CREATE INDEX account_tokens_user_purpose ON account_tokens(user_id,purpose);
CREATE INDEX account_tokens_expiry ON account_tokens(expires_at);
CREATE TABLE member_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tribe_id uuid NOT NULL REFERENCES tribes(id),
 email text NOT NULL CHECK(email=lower(email)), member_number text NOT NULL CHECK(length(member_number) BETWEEN 1 AND 100),
 invited_by uuid NOT NULL REFERENCES users(id), token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 consumed_at timestamptz, revoked_at timestamptz, CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX invitations_open_email ON member_invitations(tribe_id,email) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX invitations_open_number ON member_invitations(tribe_id,member_number) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitations_expiry ON member_invitations(expires_at);
CREATE TABLE membership_verifications (
 membership_id uuid PRIMARY KEY REFERENCES tribe_memberships(id), verified_by uuid NOT NULL REFERENCES users(id),
 provider text NOT NULL CHECK(provider='administrator'), evidence_reference text NOT NULL CHECK(length(evidence_reference) BETWEEN 1 AND 500),
 verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 tribe_id uuid REFERENCES tribes(id), action text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('success','denied')),
 request_id text NOT NULL, subject_key text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_events_user_time ON auth_security_events(user_id,created_at DESC);
CREATE INDEX auth_events_time ON auth_security_events(created_at);
CREATE TABLE auth_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload_ciphertext text,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 delivered_at timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at>created_at)
);
CREATE INDEX auth_outbox_pending ON auth_outbox(next_attempt_at) WHERE delivered_at IS NULL;
CREATE TABLE auth_challenges (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 credential_version integer NOT NULL CHECK(credential_version>0), device_name text NOT NULL CHECK(length(device_name) BETWEEN 1 AND 100),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes', attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 consumed_at timestamptz, setup_ciphertext text
);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TABLE user_mfa (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 secret_ciphertext text NOT NULL, last_step bigint NOT NULL DEFAULT -1, enrolled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mfa_recovery_codes (
 user_id uuid NOT NULL REFERENCES user_mfa(user_id) ON DELETE CASCADE,
 code_hash text NOT NULL UNIQUE CHECK(length(code_hash)=64), consumed_at timestamptz, PRIMARY KEY(user_id,code_hash)
);
