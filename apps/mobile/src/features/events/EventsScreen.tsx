import {useCallback,useEffect,useState} from 'react';
import {BackHandler,Pressable,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import type {EventView} from '@trueda-tribe-id/contracts';
import type {MemberService} from '../../api/member-service';
import {FeaturePage,ResourceBoundary,Section} from '../../components/FeaturePage';
import {Action,Copy,EmptyState} from '../../components/UI';
import {EventCard} from '../../components/tribe/EventCard';
import {useResource} from '../../state/use-resource';
import {tokens} from '../../theme/tokens';
import {useParticipation} from './use-participation';import {participationState} from './participation';
export function EventDetails({event,onBack,onChange,pending=false,disabled=false,full=false}:{event:EventView;onBack:()=>void;onChange?:()=>void;pending?:boolean;disabled?:boolean;full?:boolean}) {
 const date=(value:string)=>new Date(value).toLocaleString('en',{dateStyle:'medium',timeStyle:'short',timeZone:event.timezone});const state=participationState(event);const label=pending?'Updating…':full&&state.action==='register'?'Event full':state.label;const inactive=disabled||pending||!state.action||full&&state.action==='register'||!onChange;
 return <Section title="EVENT DETAILS"><Text accessibilityRole="header" style={s.title}>{event.title}</Text><Copy>{event.location}</Copy><Copy>Starts: {date(event.startsAt)}</Copy><Copy>Ends: {date(event.endsAt)}</Copy><Copy>Timezone: {event.timezone}</Copy><Copy>Registration: {event.registrationStatus||'Not registered'}</Copy><Copy>Registration and cancellation close when this event starts.</Copy><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:inactive,busy:pending}} disabled={inactive} onPress={onChange} style={s.action}><Copy>{label}</Copy></Pressable><Action label="Back to events" onPress={onBack}/></Section>;
}
export function EventsPresentation({events,onHome,service,tribeId='',onExpired}:{events:EventView[];onHome:()=>void;service?:MemberService;tribeId?:string;onExpired?:()=>void}) {
 const [selected,setSelected]=useState<string|null>(null);const {width,fontScale}=useWindowDimensions();const participation=useParticipation(events,service,tribeId,onExpired);
 const event=participation.events.find(item=>item.id===selected);
 useEffect(()=>{const handler=BackHandler.addEventListener('hardwareBackPress',()=>{if(selected)setSelected(null);else onHome();return true;});return()=>handler.remove();},[selected,onHome]);
 return <>{event?<EventDetails event={event} onBack={()=>setSelected(null)} onChange={service?()=>void participation.change(event):undefined} pending={participation.pending===event.id} disabled={participation.blocked||participation.pending!==null} full={participation.full.includes(event.id)}/>:!participation.events.length?<EmptyState message="No upcoming events."/>:participation.events.map(item=><View key={item.id} style={s.item}><EventCard event={item} stacked={width<350||fontScale>1.2} reference={!service} pending={participation.pending===item.id} disabled={participation.blocked||participation.pending!==null} full={participation.full.includes(item.id)} onRegister={()=>service?void participation.change(item):setSelected(item.id)}/><Action label={`View details: ${item.title}`} onPress={()=>setSelected(item.id)}/></View>)}{participation.message&&<Text accessibilityLiveRegion="polite" style={s.message}>{participation.message}</Text>}<Action label="Reload events" onPress={()=>void participation.reload()}/><Action label="Back to Tribe Hub" onPress={onHome}/></>;
}
export function EventsScreen({service,tribeId,onExpired,onHome}:{service:MemberService;tribeId:string;onExpired:()=>void;onHome:()=>void}) {
 const load=useCallback(()=>service.events(tribeId),[service,tribeId]);const resource=useResource(load,onExpired);
 useEffect(()=>{if(resource.state.kind==='ready')return;const handler=BackHandler.addEventListener('hardwareBackPress',()=>{onHome();return true;});return()=>handler.remove();},[resource.state.kind,onHome]);
 return <FeaturePage title="Upcoming Events"><ResourceBoundary {...resource}>{data=><EventsPresentation events={data.events} service={service} tribeId={tribeId} onExpired={onExpired} onHome={onHome}/>}</ResourceBoundary></FeaturePage>;
}
const s=StyleSheet.create({item:{gap:2},title:{fontFamily:tokens.fonts.semibold,fontSize:16,color:'white'},message:{fontFamily:tokens.fonts.body,fontSize:12,color:'white'},action:{minHeight:44,justifyContent:'center',padding:8}});
