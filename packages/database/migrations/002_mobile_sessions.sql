CREATE TABLE device_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 device_name text NOT NULL CHECK (length(device_name) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
 revoked_at timestamptz, CHECK (expires_at > created_at)
);
CREATE INDEX device_sessions_user_idx ON device_sessions(user_id);
CREATE TABLE refresh_tokens (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64), session_id uuid NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), consumed_at timestamptz
);
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens(session_id);
CREATE TABLE access_tokens (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64), session_id uuid NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes', CHECK(expires_at>created_at)
);
CREATE INDEX access_tokens_session_idx ON access_tokens(session_id);
CREATE TABLE request_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL, count integer NOT NULL CHECK(count>0));
