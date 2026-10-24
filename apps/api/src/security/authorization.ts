export type Role = 'member' | 'administrator' | 'owner';
export interface MembershipContext { userId: string; tribeId: string; role: Role; status: 'pending' | 'active' | 'suspended' | 'revoked' }
export type Permission = 'member:read' | 'profile:update' | 'event:register' | 'tribe:manage' | 'roles:manage';
// Context must come from a server-side session and database lookup, never request JSON or headers.
export function can(context: MembershipContext | null, permission: Permission, resource: { tribeId: string; userId?: string }): boolean {
  if (!context || context.status !== 'active' || context.tribeId !== resource.tribeId) return false;
  switch (permission) {
    case 'member:read': case 'event:register': return true;
    case 'profile:update': return resource.userId === context.userId;
    case 'tribe:manage': return context.role === 'administrator' || context.role === 'owner';
    case 'roles:manage': return context.role === 'owner';
    default: return false;
  }
}
