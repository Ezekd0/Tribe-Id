// Verification-only host for actual native components. Never imported by the app entry.
import {useState,useMemo,useCallback,useRef} from 'react';
import {registerRootComponent} from 'expo';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {useFonts} from 'expo-font';
import Feather from '@expo/vector-icons/Feather';
import {MemberShell} from '../src/components/tribe/MemberShell';
import {MemberService} from '../src/api/member-service';
import {ApiFailure} from '../src/api/client';
import {MemberContent} from '../src/navigation/MemberContent';
import {authFixture} from './auth-fixture';
import {AccountSecurityScreen} from '../src/features/authentication/AccountSecurityScreen';
import {SessionScreen} from '../src/features/authentication/SessionScreen';
import {HubScreen} from '../src/features/tribe/HubScreen';
import {LoadingState,EmptyState,ErrorState,StatePanel} from '../src/components/UI';
import type {MemberRoute} from '../src/navigation/routes';
import {developmentMemberView} from '../../api/src/development/member-fixture';
import {tribeFonts} from '../src/theme/fonts';
function Preview() {
  const [loaded]=useFonts({...tribeFonts,...Feather.font});
  const initial=new URLSearchParams(location.search).get('feature');
  const [route,setRoute]=useState<MemberRoute>(initial==='notifications'||initial==='id-card'||initial==='profile'||initial==='announcements'||initial==='events'||initial==='settings'?initial:'hub');const [drawer,setDrawer]=useState(false);const [retries,setRetries]=useState(0);
  const scenario=new URLSearchParams(location.search).get('state');
  const view=structuredClone(developmentMemberView);
  view.identity.avatarUrl=null; // Do not fetch unavailable sample artwork in the QA host.
  if(scenario==='empty'){view.card=null;view.profile=null;view.announcements=[];view.events=[];}
  if(scenario==='long'){view.identity.displayName='Synthetic Example Member With Deliberately Long Test Name';view.identity.memberNumber='TRUEDA-TRIBE-MEMBER-0000000001';view.events.forEach(event=>{event.title='Community leadership and development gathering';event.location='Example Test Conference Centre';});view.announcements[0]!.title='Community leadership programme registration and membership updates are now available';}
  const auth=useMemo(()=>authFixture(scenario),[scenario]);
  const [security,setSecurity]=useState(initial==='security');
  const [authenticated,setAuthenticated]=useState(false);
  const [expired,setExpired]=useState(false);
  const onExpired=useCallback(()=>setExpired(true),[]);
  const attempts=useRef(0);
  const profileWritten=useRef(false);
  const service=useMemo(()=>new MemberService({write:async<T,>(_path:string,_method:'POST'|'PATCH'|'DELETE',body?:object)=>({...{emailNotifications:false,pushNotifications:false,profileVisibility:'private'},...body} as T),patch:async<T,>(path:string,body:Record<string,string|null>)=>{if(!path.endsWith('/profile'))throw new Error('Unsupported QA write');if(scenario==='profile-rejected')throw new ApiFailure(403,'Profile update is not permitted.');Object.assign(view.profile!,body);profileWritten.current=true;if(scenario==='profile-uncertain'||scenario==='profile-reload-error')throw new ApiFailure(0,'Response could not be confirmed.');return undefined as T;},get:async <T,>(path:string)=>{if(scenario==='loading')return await new Promise<T>(()=>{});if(scenario==='error'&&attempts.current++===0)throw new ApiFailure(503,'Unable to contact the Tribe service. Please try again.');if(scenario==='expired')throw new ApiFailure(401,'Expired');if(path.endsWith('/privacy-requests'))return {requests:[]} as T;if(path.endsWith('/portrait'))return {assetId:null,url:null,expiresAt:null} as T;if(path.endsWith('/preferences'))return {emailNotifications:false,pushNotifications:false,profileVisibility:'private'} as T;if(path.endsWith('/notifications'))return {notifications:[]} as T;if(path.endsWith('/events'))return {events:view.events} as T;if(path.endsWith('/announcements'))return {announcements:view.announcements} as T;if(path.endsWith('/profile')&&scenario==='profile-reload-error'&&profileWritten.current)throw new ApiFailure(503,'Profile unavailable');if(path.endsWith('/profile'))return {identity:view.identity,profile:view.profile} as T;if(path.endsWith('/id-card'))return {identity:view.identity,card:view.card,location:view.profile?.location??null} as T;throw new Error('Unsupported QA resource');}}),[scenario]);
  function navigate(next:MemberRoute){setRoute(next);setDrawer(false);}
  return <SafeAreaProvider initialMetrics={{insets:{top:0,right:0,bottom:0,left:0},frame:{x:0,y:0,width:innerWidth,height:innerHeight}}}>{security?<AccountSecurityScreen auth={auth} onBack={()=>setSecurity(false)} onSignedOut={onExpired}/>:initial==='auth'&&authenticated?<StatePanel message="Authenticated QA session"/>:initial==='auth'?<SessionScreen auth={auth} onAuthenticated={()=>setAuthenticated(true)} busy={scenario==='loading'} message={scenario==='expired'?'Your session has expired.':'No valid saved session was found.'} retry={()=>setRetries(retries+1)}/>:<MemberShell onLogout={initial?()=>setExpired(true):undefined} route={route} navigate={navigate} drawer={drawer} setDrawer={setDrawer} avatarUrl={null} tribeName={view.identity.tribeName}>{initial&&loaded?(expired?<EmptyState message="Your session has expired."/>:<MemberContent route={route} view={view} service={service} navigate={navigate} onExpired={onExpired} onLogout={()=>setExpired(true)} onSecurity={()=>setSecurity(true)}/>):!loaded?<LoadingState/>:scenario==='loading'?<LoadingState/>:scenario==='error'?<ErrorState message={`Unable to load your Tribe Hub. Attempts: ${retries}`} retry={()=>setRetries(retries+1)}/>:scenario==='signed-out'?<EmptyState message="A member session is required."/>:route==='hub'?<HubScreen view={view} navigate={navigate}/>:<StatePanel message={`Destination: ${route}`}/>}</MemberShell>}</SafeAreaProvider>;
}
registerRootComponent(Preview);
