import {PushController,type PushStatus} from './features/push/controller';
import {nativePushAdapter} from './features/push/native';
import {PushContext} from './features/push/context';
import {systemPickerOpen} from './features/portrait/system-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import Feather from '@expo/vector-icons/Feather';
import { tribeFonts } from './theme/fonts';
import { MemberShell } from './components/tribe/MemberShell';
import { mobileEnvironment } from './api/environment';
import { ApiClient, ApiFailure } from './api/client';
import { MemberService, type HubView } from './api/member-service';
import { MobileSession } from './auth/session';
import { AuthService } from './api/auth-service';
import { AccountSecurityScreen } from './features/authentication/AccountSecurityScreen';
import { SessionFailure } from './auth/session-core';
import { SessionScreen } from './features/authentication/SessionScreen';
import { Action, LoadingState, EmptyState, ErrorState, StatePanel } from './components/UI';
import { MemberContent } from './navigation/MemberContent';
import { type MemberRoute } from './navigation/routes';
import { tokens } from './theme/tokens';
type State = {kind:'loading'} | {kind:'restoring'} | {kind:'ready';view:HubView} | {kind:'error';message:string} | {kind:'signed-out';message:string} | {kind:'empty'} | {kind:'choose-tribe';memberships:{tribeId:string;tribeName:string}[]};
/** Native member client with secure credential/session flow. */
export default function App() {
  const [fontsLoaded,fontError] = useFonts({...tribeFonts,...Feather.font});
  const [route,setRoute] = useState<MemberRoute>('hub');
  const [security,setSecurity] = useState(false);
  const [drawer,setDrawer] = useState(false);
  const [state,setState] = useState<State>({kind:'restoring'});
  const generation = useRef(0);
  const selectedTribe=useRef<string|null>(null);
  const logoutPending=useRef(false);
  const push=useRef<PushController|null>(null);const pushStarted=useRef(false);const [pushStatus,setPushStatus]=useState<PushStatus>('unavailable');const [receivedVersion,setReceivedVersion]=useState(0);const [pushNotice,setPushNotice]=useState(false);
  const runtime = useRef<{session:MobileSession;api:ApiClient;service:MemberService;auth:AuthService}|null>(null);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setState({kind:'restoring'});
    try {
      const { baseUrl } = mobileEnvironment(process.env.EXPO_PUBLIC_API_URL, process.env.EXPO_PUBLIC_APP_ENV, __DEV__);
      if (!runtime.current) { const session = new MobileSession(baseUrl); const api=new ApiClient(baseUrl,session);runtime.current = {session,api,service:new MemberService(api),auth:new AuthService(baseUrl,session,api)}; }
      if (!runtime.current.session.token() && !await runtime.current.session.refresh()) { if(current === generation.current) setState({kind:'signed-out',message:'Sign in to access your account.'}); return; }
      const memberships = await runtime.current.service.memberships();
      if (memberships.memberships.length === 0) {if(current === generation.current) setState({kind:'empty'});return;}
      const configured = selectedTribe.current ?? process.env.EXPO_PUBLIC_TRIBE_ID;
      const membership = configured ? memberships.memberships.find(item => item.tribeId === configured) : memberships.memberships.length === 1 ? memberships.memberships[0] : undefined;
      if (!membership) {if(current === generation.current)setState({kind:'choose-tribe',memberships:memberships.memberships});return;}
      const view = await runtime.current.service.hub(membership.tribeId);
      if(current === generation.current) setState({kind:'ready',view});
    } catch(error) {if(current === generation.current) setState(error instanceof ApiFailure && error.status===401 || error instanceof SessionFailure && !error.canRetry ? {kind:'signed-out',message:error.message} : {kind:'error',message:error instanceof Error ? error.message : 'Unable to load your Tribe Hub.'});}
  },[]);
  useEffect(() => {void load();return () => {generation.current++;};},[load]);
  useEffect(()=>{if(!runtime.current)return;if(state.kind==='signed-out'){push.current?.stop();pushStarted.current=false;setPushStatus('disabled');setPushNotice(false);return;}if(state.kind!=='ready')return;const service=runtime.current.service,api=runtime.current.api;if(!push.current)push.current=new PushController(nativePushAdapter,{preferences:id=>service.preferences(id),memberships:()=>service.memberships(),notification:(tribeId,id)=>service.notification(tribeId,id),register:data=>api.write<void>('/api/v1/me/push-device','PUT',data),unregister:()=>api.delete<void>('/api/v1/me/push-device')},setPushStatus,(tribeId,target)=>{selectedTribe.current=tribeId;setSecurity(false);setDrawer(false);setRoute(target);void load();},()=>{setReceivedVersion(value=>value+1);setPushNotice(true);});if(!pushStarted.current){push.current.start();pushStarted.current=true;}void push.current.sync(state.view.identity.tribeId);},[state,load]);
  useEffect(()=>()=>{push.current?.stop();},[]);
  useEffect(()=>{const handler=AppState.addEventListener('change',next=>{if(next==='active'&&!systemPickerOpen()&&runtime.current&&!logoutPending.current&&state.kind==='ready'&&!security)void load();});return()=>handler.remove();},[load,state.kind,security]);
  useEffect(() => {const handler = BackHandler.addEventListener('hardwareBackPress',() => {if(security||state.kind==='signed-out'||state.kind==='restoring')return false;if(drawer){setDrawer(false);return true;}if(route==='events')return false;if(route !== 'hub'){setRoute(route==='notifications'?'settings':route==='settings'?'profile':'hub');return true;}return false;});return () => handler.remove();},[route,drawer,security,state.kind]);
  async function logout() {
    if(logoutPending.current)return;logoutPending.current=true;
    generation.current++;setDrawer(false);setSecurity(false);setState({kind:'loading'});
    try {await push.current?.revoke();pushStarted.current=false;await runtime.current?.api.logout();generation.current++;setRoute('hub');setState({kind:'signed-out',message:'You have been signed out.'});}
    catch(error) {if(error instanceof ApiFailure && error.status===401) {setState({kind:'signed-out',message:error.message});return;}setState({kind:'error',message:'Sign-out could not be confirmed. Retry from the member menu.'});}
    finally {logoutPending.current=false;}
  }
  const onExpired=useCallback(()=>{push.current?.stop();pushStarted.current=false;generation.current++;setDrawer(false);setSecurity(false);setState({kind:'signed-out',message:'Your session has expired. Sign in again to continue.'});},[]);
  async function refreshMemberView(){if(state.kind!=='ready'||!runtime.current)return;const expected=generation.current;try{const view=await runtime.current.service.hub(state.view.identity.tribeId);if(expected===generation.current)setState(current=>current.kind==='ready'&&current.view.identity.tribeId===view.identity.tribeId?{kind:'ready',view}:current);}catch(error){if(error instanceof ApiFailure&&error.status===401)onExpired();}}
  function navigate(next:MemberRoute) {if(next==='notifications')setPushNotice(false);setRoute(next);setDrawer(false);}
  const environmentLabel = (() => { try { const config=mobileEnvironment(process.env.EXPO_PUBLIC_API_URL,process.env.EXPO_PUBLIC_APP_ENV,__DEV__); return config.mode==='production'?undefined:`${config.mode} · ${config.baseUrl}`; } catch { return 'API configuration required'; } })();
  return <PushContext.Provider value={{status:pushStatus,receivedVersion,sync:async(id,request)=>{await push.current?.sync(id,request);}}}><SafeAreaProvider><StatusBar barStyle="light-content" backgroundColor={tokens.colors.background}/>{security&&runtime.current?<AccountSecurityScreen environmentLabel={environmentLabel} auth={runtime.current.auth} onBack={()=>setSecurity(false)} onSignedOut={onExpired}/>:state.kind==='signed-out'||state.kind==='restoring' ? <SessionScreen environmentLabel={environmentLabel} busy={state.kind==='restoring'} message={state.kind==='signed-out'?state.message:'Restoring session'} retry={()=>void load()} auth={runtime.current?.auth} onAuthenticated={()=>{setRoute('hub');selectedTribe.current=null;void load();}}/> : <MemberShell environmentLabel={environmentLabel} onLogout={()=>void logout()} route={route} navigate={navigate} drawer={drawer} setDrawer={setDrawer} avatarUrl={state.kind==='ready'?state.view.identity.avatarUrl:null} tribeName={state.kind==='ready'?state.view.identity.tribeName:null}>
    <View style={s.content}>
      {pushNotice&&state.kind==='ready'&&<Action label="You have a Tribe notification. Open inbox" onPress={()=>navigate('notifications')}/>}
      {!fontsLoaded && !fontError ? <LoadingState message="Loading Tribe typography…"/> : fontError ? <StatePanel message="Typography could not load. Restart the application to try again."/> : <>
        {state.kind==='loading' && <LoadingState/>}
        {state.kind==='error' && <ErrorState message={state.message} retry={()=>void load()}/>}
        {state.kind==='choose-tribe' && <><StatePanel message="Choose an active Tribe membership."/>{state.memberships.map(membership=><Action key={membership.tribeId} label={membership.tribeName} onPress={()=>{selectedTribe.current=membership.tribeId;setRoute('hub');void load();}}/>)}</>}
        {state.kind==='empty' && <><EmptyState message="You have no active Tribe memberships. Membership approval is separate from email verification."/><Action label="Account security and membership status" onPress={()=>setSecurity(true)}/><Action label="Check activation status" onPress={()=>void load()}/></>}
        {state.kind==='ready' && runtime.current && <MemberContent route={route} view={state.view} service={runtime.current.service} navigate={navigate} onExpired={onExpired} onLogout={()=>void logout()} onSecurity={()=>setSecurity(true)} onMemberChanged={()=>void refreshMemberView()}/>}
      </>}
    </View>
  </MemberShell>}</SafeAreaProvider></PushContext.Provider>;
}
const s=StyleSheet.create({content:{flex:1}});
