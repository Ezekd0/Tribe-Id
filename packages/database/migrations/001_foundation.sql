CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL, email_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
  settings jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tribe_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tribe_id uuid NOT NULL REFERENCES tribes(id),
  user_id uuid NOT NULL REFERENCES users(id), member_number text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','administrator','owner')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','revoked')),
  joined_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tribe_id, user_id), UNIQUE (tribe_id, member_number), UNIQUE (id, tribe_id)
);
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tribe_id uuid NOT NULL REFERENCES tribes(id),
  uploaded_by uuid NOT NULL REFERENCES users(id), storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id, tribe_id)
);
CREATE TABLE profiles (
  membership_id uuid PRIMARY KEY, tribe_id uuid NOT NULL, display_name text NOT NULL,
  bio text NOT NULL DEFAULT '', phone text, date_of_birth date, location text, occupation text,
  avatar_asset_id uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, tribe_id) REFERENCES tribe_memberships(id, tribe_id),
  FOREIGN KEY (avatar_asset_id, tribe_id) REFERENCES assets(id, tribe_id)
);
CREATE TABLE id_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), membership_id uuid NOT NULL, tribe_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','revoked','expired')),
  verification_token_hash text NOT NULL UNIQUE, issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz, revoked_at timestamptz,
  CHECK (expires_at IS NULL OR expires_at > issued_at),
  FOREIGN KEY (membership_id, tribe_id) REFERENCES tribe_memberships(id, tribe_id)
);
CREATE UNIQUE INDEX one_issued_card_per_member ON id_cards (membership_id) WHERE status = 'issued';
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz, CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tribe_id uuid NOT NULL REFERENCES tribes(id),
  author_membership_id uuid NOT NULL, title text NOT NULL, body text NOT NULL,
  category text NOT NULL CHECK (category IN ('important','event','general')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'published' OR published_at IS NOT NULL),
  FOREIGN KEY (author_membership_id, tribe_id) REFERENCES tribe_memberships(id, tribe_id)
);
CREATE INDEX announcements_feed_idx ON announcements(tribe_id, status, published_at DESC);
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tribe_id uuid NOT NULL REFERENCES tribes(id),
  title text NOT NULL, description text NOT NULL DEFAULT '', location text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, timezone text NOT NULL DEFAULT 'Africa/Lagos',
  capacity integer CHECK (capacity > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled','completed')),
  CHECK (ends_at > starts_at), UNIQUE (id, tribe_id)
);
CREATE INDEX events_upcoming_idx ON events(tribe_id, status, starts_at);
CREATE TABLE event_registrations (
  event_id uuid NOT NULL, membership_id uuid NOT NULL, tribe_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','cancelled','attended')),
  registered_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (event_id, membership_id),
  FOREIGN KEY (event_id, tribe_id) REFERENCES events(id, tribe_id),
  FOREIGN KEY (membership_id, tribe_id) REFERENCES tribe_memberships(id, tribe_id)
);
CREATE TABLE member_settings (
  membership_id uuid PRIMARY KEY REFERENCES tribe_memberships(id),
  email_notifications boolean NOT NULL DEFAULT true, profile_visibility text NOT NULL DEFAULT 'private'
    CHECK (profile_visibility IN ('private','tribe')), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE skills (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
CREATE TABLE member_skills (
  membership_id uuid NOT NULL REFERENCES tribe_memberships(id), skill_id uuid NOT NULL REFERENCES skills(id),
  PRIMARY KEY (membership_id, skill_id)
);
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tribe_id uuid NOT NULL REFERENCES tribes(id),
  name text NOT NULL, UNIQUE (tribe_id, name), UNIQUE (id, tribe_id)
);
CREATE TABLE team_memberships (
  team_id uuid NOT NULL, membership_id uuid NOT NULL, tribe_id uuid NOT NULL, PRIMARY KEY (team_id, membership_id),
  FOREIGN KEY (team_id, tribe_id) REFERENCES teams(id, tribe_id),
  FOREIGN KEY (membership_id, tribe_id) REFERENCES tribe_memberships(id, tribe_id)
);
CREATE TABLE achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tribe_id uuid NOT NULL REFERENCES tribes(id),
  name text NOT NULL, description text NOT NULL, UNIQUE (id, tribe_id)
);
CREATE TABLE member_achievements (
  achievement_id uuid NOT NULL, membership_id uuid NOT NULL, tribe_id uuid NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (achievement_id, membership_id),
  FOREIGN KEY (achievement_id, tribe_id) REFERENCES achievements(id, tribe_id),
  FOREIGN KEY (membership_id, tribe_id) REFERENCES tribe_memberships(id, tribe_id)
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), membership_id uuid NOT NULL REFERENCES tribe_memberships(id),
  title text NOT NULL, body text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON notifications(membership_id, created_at DESC);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tribe_id uuid NOT NULL REFERENCES tribes(id),
  actor_user_id uuid REFERENCES users(id), action text NOT NULL, resource_type text NOT NULL,
  resource_id uuid, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tribe_idx ON audit_logs(tribe_id, created_at DESC);
