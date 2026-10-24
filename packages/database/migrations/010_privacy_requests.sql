-- Member requests and administrator review acknowledgements only. No fulfillment or deletion.
CREATE TABLE member_privacy_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 membership_id uuid NOT NULL,
 tribe_id uuid NOT NULL REFERENCES tribes(id),
 request_type text NOT NULL CHECK(request_type IN ('export','deletion')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reviewed_at timestamptz,
 reviewed_by_user_id uuid REFERENCES users(id),
 FOREIGN KEY(membership_id,tribe_id) REFERENCES tribe_memberships(id,tribe_id),
 CHECK((reviewed_at IS NULL)=(reviewed_by_user_id IS NULL)),
 CHECK(reviewed_at IS NULL OR reviewed_at>=created_at)
);
CREATE UNIQUE INDEX privacy_requests_pending_type ON member_privacy_requests(membership_id,request_type) WHERE reviewed_at IS NULL;
CREATE INDEX privacy_requests_member_history ON member_privacy_requests(membership_id,created_at DESC,id DESC);
CREATE INDEX privacy_requests_tribe_history ON member_privacy_requests(tribe_id,created_at DESC,id DESC);
CREATE INDEX privacy_requests_pending_review ON member_privacy_requests(tribe_id,created_at DESC,id DESC) WHERE reviewed_at IS NULL;
