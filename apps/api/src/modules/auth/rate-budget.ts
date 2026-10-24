const routes = new Set(['login', 'enroll', 'invitations/accept', 'verification/request', 'verification/confirm', 'recovery/request', 'recovery/confirm', 'password/change', 'email/change/request', 'email/change/confirm', 'memberships', 'devices', 'mfa/setup', 'mfa/verify', 'mfa/recover']);
export function rateBudget(path: string) {
    if (path === '/api/v1/auth/logout' || path === '/api/v1/auth/logout-all')
        return { key: 'revoke', max: 100 };
    if (path === '/api/v1/auth/refresh')
        return { key: 'refresh', max: 120 };
    if (!path.startsWith('/api/v1/auth/'))
        return { key: 'api', max: 100 };
    const route = path.slice('/api/v1/auth/'.length);
    const group = routes.has(route) ? route : route.startsWith('devices/') ? 'devices' : 'unknown';
    return { key: 'auth:' + group, max: group === 'login' ? 30 : group === 'recovery/request' ? 10 : group === 'enroll' || group === 'recovery/confirm' ? 20 : 100 };
}
