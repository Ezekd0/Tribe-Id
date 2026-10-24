export const PRODUCT_NAME = 'Trueda Tribe ID';
export type TribeRole = 'member' | 'administrator' | 'owner';
export type MembershipStatus = 'pending' | 'active' | 'suspended' | 'revoked';
export type IDCardStatus = 'issued' | 'revoked' | 'expired';
export interface ApiError { error: { code: string; message: string; requestId: string; refreshUnconsumed?: true } }
export interface AuthTokenPair { accessToken: string; refreshToken: string; expiresIn: number }
export interface MfaChallenge { challengeToken: string; enrollmentRequired: boolean }
export type AuthLoginResponse = AuthTokenPair | MfaChallenge;
export interface MfaSetupResponse { secret: string; otpAuthUrl: string }
export interface MfaVerificationResponse extends AuthTokenPair { recoveryCodes?: string[] }
export interface AuthDeviceView { id: string; deviceName: string; createdAt: string; expiresAt: string }
export interface DeviceSessionsResponse { currentSessionId: string; devices: AuthDeviceView[] }
export interface MembershipStatusResponse { memberships: { id: string; tribeId: string; tribeName: string; status: MembershipStatus }[] }
export function isAuthTokenPair(value: unknown): value is AuthTokenPair {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<AuthTokenPair>;
  return typeof v.accessToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v.accessToken)
    && typeof v.refreshToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v.refreshToken)
    && typeof v.expiresIn === 'number' && Number.isFinite(v.expiresIn) && v.expiresIn > 0;
}
export function isMfaChallenge(value: unknown): value is MfaChallenge {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<MfaChallenge>;
  return typeof v.challengeToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v.challengeToken) && typeof v.enrollmentRequired === 'boolean';
}
export function isMfaVerificationResponse(value: unknown): value is MfaVerificationResponse {
  if (!isAuthTokenPair(value)) return false;
  const codes = (value as Partial<MfaVerificationResponse>).recoveryCodes;
  return codes === undefined || (Array.isArray(codes) && codes.every(code => typeof code === 'string' && /^[a-f0-9]{32}$/.test(code)));
}
export interface HealthResponse { product: 'Trueda Tribe ID'; status: 'ok' }
export interface TribeMembership { id: string; tribeId: string; userId: string; memberNumber: string; role: TribeRole; status: MembershipStatus; joinedAt: string | null }
export interface MemberProfile { displayName: string; bio: string; occupation: string | null; location: string | null; avatarAssetId: string | null }

export interface MemberIdentity {
  membershipId: string; tribeId: string; tribeName: string; memberNumber: string;
  role: TribeRole; status: MembershipStatus; joinedAt: string | null;
  displayName: string; avatarUrl: string | null;
}
export interface ProfileView {
  bio: string; email: string; phone: string | null; dateOfBirth: string | null;
  location: string | null; occupation: string | null;
  skills: string[]; teams: string[];
  achievements: { id: string; name: string; description: string; awardedAt: string }[];
}
/** Approved self-service boundary. Identity, email, membership and roles are excluded. */
export interface ProfileUpdateRequest {
  bio?: string;
  phone?: string | null;
  location?: string | null;
  occupation?: string | null;
}
export interface IDCardView { id: string; status: IDCardStatus; issuedAt: string; expiresAt: string | null }
export interface CardProofResponse { proof: string; expiresAt: string }
export interface CardVerificationRequest { proof: string }
export interface CardVerificationResponse { displayName: string; memberNumber: string; status: 'issued'; expiresAt: string }
export interface AnnouncementView { id: string; title: string; body: string; category: 'important' | 'event' | 'general'; publishedAt: string }
export interface EventView {
  id: string; title: string; location: string; startsAt: string; endsAt: string; timezone: string;
  registrationStatus: 'registered' | 'cancelled' | 'attended' | null;
}
export interface EventDraftRequest {
  title: string; description: string; location: string; startsAt: string; endsAt: string;
  timezone: string; capacity: number | null;
}
export type EventUpdateRequest = Partial<EventDraftRequest>;
export interface ManagedEventView extends EventDraftRequest { id: string; status: 'draft' | 'published' | 'cancelled' | 'completed' }
export interface ManagedEventsResponse { events: ManagedEventView[] }
export interface AdminContext { tribeId: string; tribeName: string; membershipId: string; role: 'administrator' | 'owner' }
export interface AdminMember { membershipId: string; displayName: string; memberNumber: string; role: TribeRole; status: MembershipStatus; emailVerified: boolean; joinedAt: string | null }
export interface AdminInvitation { id: string; email: string; memberNumber: string; expiresAt: string; consumedAt: string | null; revokedAt: string | null }
export interface ManagedAnnouncement {
  id: string; tribeId: string; authorMembershipId: string; title: string; body: string;
  category: AnnouncementView['category']; status: 'draft' | 'published' | 'archived'; publishedAt: string | null; createdAt: string;
}
export interface AnnouncementDraftRequest { title: string; body: string; category: AnnouncementView['category'] }
export type AnnouncementUpdateRequest = Partial<AnnouncementDraftRequest>;
export interface MemberPreferences { emailNotifications: boolean; pushNotifications: boolean; profileVisibility: 'private' | 'tribe' }
export type MemberPreferencesUpdate = Partial<MemberPreferences>;
export interface NotificationInboxItem { id: string; title: string; body: string; readAt: string | null; createdAt: string; source?: { type: 'announcement' | 'event'; id: string } }
export interface NotificationInboxResponse { notifications: NotificationInboxItem[] }
export type PortraitMimeType = 'image/png' | 'image/jpeg' | 'image/webp';
export interface PortraitUploadRequest { mimeType: PortraitMimeType; sizeBytes: number; consent: true }
export interface PortraitUploadResponse { assetId: string; uploadUrl: string; expiresAt: string; headers: { 'Content-Type': PortraitMimeType } }
export interface PortraitResponse { assetId: string | null; url: string | null; expiresAt: string | null }
export interface SharedMemberProfile {
  displayName: string; avatarUrl: string | null; bio: string; location: string | null; occupation: string | null;
  skills: string[]; teams: string[]; achievements: ProfileView['achievements'];
}
export interface MemberView {
  identity: MemberIdentity; profile: ProfileView | null; card: IDCardView | null;
  announcements: AnnouncementView[]; events: EventView[];
}
export interface SessionView { memberships: { tribeId: string; tribeName: string }[] }

// A review acknowledgement is not fulfillment of an export or deletion request.
export type PrivacyRequestType = 'export' | 'deletion';
export interface PrivacyRequestCreateRequest { type: PrivacyRequestType }
export interface PrivacyRequestView { id: string; type: PrivacyRequestType; status: 'pending' | 'reviewed'; createdAt: string; reviewedAt: string | null }
export interface PrivacyRequestListResponse { requests: PrivacyRequestView[] }
export interface ManagedPrivacyRequestView extends PrivacyRequestView { membershipId: string; displayName: string; memberNumber: string }
export interface ManagedPrivacyRequestsResponse { requests: ManagedPrivacyRequestView[] }

// Current authenticated session determines ownership; registration never echoes a token.
export interface PushDeviceRegistrationRequest { provider: 'expo'; platform: 'android' | 'ios'; token: string }
