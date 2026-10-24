-- Live user membership/MFA checks run on every protected request; avoid full membership scans.
CREATE INDEX memberships_user_status_idx ON tribe_memberships(user_id,status);
CREATE INDEX privileged_memberships_user_idx ON tribe_memberships(user_id) WHERE status='active' AND role IN ('administrator','owner');
CREATE INDEX auth_challenges_user_idx ON auth_challenges(user_id);
CREATE INDEX auth_events_request_idx ON auth_security_events(request_id);
