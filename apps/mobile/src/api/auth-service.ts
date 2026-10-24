import { timedFetch } from './transport';
import { isTokens, type SessionCore, type Tokens } from '../auth/session-core';
import { ApiFailure, type ApiClient } from './client';
import { isMfaChallenge, isMfaVerificationResponse } from '@trueda-tribe-id/contracts';
import type { MfaChallenge, AuthLoginResponse, MfaSetupResponse, DeviceSessionsResponse, MembershipStatusResponse } from '@trueda-tribe-id/contracts';
export type { MfaChallenge, AuthDeviceView as DeviceView } from '@trueda-tribe-id/contracts';
export type LoginResult = AuthLoginResponse;
export class AuthService {
    constructor(private baseUrl: string, private session: SessionCore, private api: ApiClient, private request: typeof fetch = fetch) {
        this.request = timedFetch(request);
    }
    private async publicPost<T>(path: string, body: Record<string, string>): Promise<T> {
        let response: Response;
        try {
            response = await this.request(this.baseUrl.replace(/\/$/, '') + '/api/v1/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        }
        catch {
            throw new ApiFailure(0, 'The response could not be confirmed. Check your connection.');
        }
        if (!response.ok) {
            let code = '';
            try {
                code = (await response.json() as {
                    error?: {
                        code?: string;
                    };
                }).error?.code ?? '';
            }
            catch {
            }
            throw new ApiFailure(response.status, code === 'EXISTING_ACCOUNT' ? 'Sign in to accept this invitation with your existing account.' : response.status === 401 ? 'Check your credentials, verification status or authenticator code.' : response.status === 429 ? 'Too many attempts. Try again later.' : response.status === 503 ? 'Authentication is temporarily unavailable.' : code === 'PASSWORD_POLICY' ? 'Use a non-repetitive password of 15–128 characters.' : 'This request could not be completed. Check the token and try again.');
        }
        return response.status === 204 ? undefined as T : await response.json() as T;
    }
    async login(email: string, password: string) {
        const result = await this.publicPost<unknown>('login', { email: email.trim(), password, deviceName: 'Trueda mobile' });
        if (isTokens(result)) {
            await this.session.accept(result);
            return null;
        }
        if (!isMfaChallenge(result))
            throw new ApiFailure(502, 'Invalid authentication response.');
        return result;
    }
    enroll(invitationToken: string, password: string, displayName: string) {
        return this.publicPost<void>('enroll', { invitationToken: invitationToken.trim(), password, displayName: displayName.trim() });
    }
    verify(token: string) {
        return this.publicPost<void>('verification/confirm', { token: token.trim() });
    }
    resend(email: string) {
        return this.publicPost<void>('verification/request', { email: email.trim() });
    }
    recover(email: string) {
        return this.publicPost<void>('recovery/request', { email: email.trim() });
    }
    reset(token: string, newPassword: string) {
        return this.publicPost<void>('recovery/confirm', { token: token.trim(), newPassword });
    }
    setup(challengeToken: string) {
        return this.publicPost<MfaSetupResponse>('mfa/setup', { challengeToken });
    }
    async mfa(challengeToken: string, code: string) {
        const value = await this.publicPost<unknown>('mfa/verify', { challengeToken, code: code.trim() });
        if (!isMfaVerificationResponse(value))
            throw new ApiFailure(502, 'Invalid authentication response.');
        await this.session.accept(value);
        return value.recoveryCodes ?? [];
    }
    async mfaRecover(challengeToken: string, recoveryCode: string) {
        const result = await this.publicPost<unknown>('mfa/recover', { challengeToken, recoveryCode: recoveryCode.trim() });
        if (!isMfaChallenge(result)) throw new ApiFailure(502, 'Invalid authentication response.');
        return result;
    }
    confirmEmail(token: string) {
        return this.publicPost<void>('email/change/confirm', { token: token.trim() });
    }
    memberships() {
        return this.api.get<MembershipStatusResponse>('/api/v1/auth/memberships');
    }
    acceptInvitation(invitationToken: string, displayName: string) {
        return this.api.post<void>('/api/v1/auth/invitations/accept', { invitationToken: invitationToken.trim(), displayName });
    }
    devices() {
        return this.api.get<DeviceSessionsResponse>('/api/v1/auth/devices');
    }
    async revokeDevice(id: string, current: boolean) {
        await this.api.delete<void>('/api/v1/auth/devices/' + id);
        if (current)
            await this.session.clear();
    }
    async logoutAll() {
        await this.api.post<void>('/api/v1/auth/logout-all');
        await this.session.clear();
    }
    async changePassword(currentPassword: string, newPassword: string) {
        await this.api.post<void>('/api/v1/auth/password/change', { currentPassword, newPassword });
        await this.session.clear();
    }
    changeEmail(currentPassword: string, email: string) {
        return this.api.post<void>('/api/v1/auth/email/change/request', { currentPassword, email: email.trim() });
    }
}
