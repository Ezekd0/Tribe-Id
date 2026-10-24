CREATE INDEX device_sessions_expiry_idx ON device_sessions(expires_at);
CREATE INDEX access_tokens_expiry_idx ON access_tokens(expires_at);
CREATE INDEX request_limits_window_idx ON request_limits(window_start);
