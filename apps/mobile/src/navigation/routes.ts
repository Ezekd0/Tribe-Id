export const memberRoutes = ['hub', 'id-card', 'announcements', 'profile'] as const;
export type MemberRoute = typeof memberRoutes[number] | 'settings' | 'events' | 'notifications';
export const routeLabels: Record<MemberRoute, string> = { hub: 'Home', 'id-card': 'My ID Card', announcements: 'Announcement', profile: 'My Profile', settings:'Account Settings', events:'Upcoming Events',notifications:'Notification inbox' };
export function isMemberRoute(value: string): value is MemberRoute { return value==='notifications'||value==='settings'||value==='events'||memberRoutes.some(route => route === value); }

export const drawerRoutes: readonly MemberRoute[] = ['hub', 'profile', 'announcements', 'id-card'];
