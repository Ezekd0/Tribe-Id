import {useDevicePush} from '../features/push/context';
import type {MemberRoute} from './routes';
import type {MemberService,HubView} from '../api/member-service';
import {HubScreen} from '../features/tribe/HubScreen';
import {IDCardScreen} from '../features/tribe-id/IDCardScreen';
import {ProfileScreen} from '../features/profile/ProfileScreen';
import {AnnouncementsScreen} from '../features/announcements/AnnouncementsScreen';
import {EventsScreen} from '../features/events/EventsScreen';
import {InboxScreen} from '../features/notifications/InboxScreen';
import {SettingsScreen} from '../features/settings/SettingsScreen';
export function MemberContent({route,view,service,navigate,onExpired,onLogout,onSecurity,onMemberChanged}:{onMemberChanged?:()=>void;route:MemberRoute;view:HubView;service:MemberService;navigate:(route:MemberRoute)=>void;onExpired:()=>void;onLogout:()=>void;onSecurity?:()=>void}) {
 const {receivedVersion}=useDevicePush();
 const props={service,tribeId:view.identity.tribeId,onExpired};
 switch(route) {
  case 'hub':return <HubScreen key={view.identity.tribeId} view={view} navigate={navigate} service={service} onExpired={onExpired} onEvents={()=>navigate('events')}/>;
  case 'id-card':return <IDCardScreen key={view.identity.tribeId} {...props}/>;
  case 'profile':return <ProfileScreen key={view.identity.tribeId} {...props} {...(onMemberChanged?{onMemberChanged}:{})} onSettings={()=>navigate('settings')} onLogout={onLogout}/>;
  case 'announcements':return <AnnouncementsScreen key={view.identity.tribeId} {...props}/>;
  case 'events':return <EventsScreen key={view.identity.tribeId} {...props} onHome={()=>navigate('hub')}/>;
  case 'notifications':return <InboxScreen key={view.identity.tribeId+':'+receivedVersion} {...props} onBack={()=>navigate('settings')} onOpen={type=>navigate(type==='event'?'events':'announcements')}/>;
  case 'settings':return <SettingsScreen key={view.identity.tribeId} {...props} onInbox={()=>navigate('notifications')} onSecurity={onSecurity} onBack={()=>navigate('profile')} onLogout={onLogout}/>;
 }
}
