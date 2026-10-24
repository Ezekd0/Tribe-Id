import type {EventView} from '@trueda-tribe-id/contracts';
export function participationState(event:EventView,now=Date.now()){
 const closed=!Number.isFinite(Date.parse(event.startsAt))||Date.parse(event.startsAt)<=now;
 if(event.registrationStatus==='attended')return {label:'Attended',action:null};
 if(closed)return {label:event.registrationStatus==='registered'?'Registered · Closed':'Registration closed',action:null};
 return event.registrationStatus==='registered'?{label:'Cancel registration',action:'cancel' as const}:{label:event.registrationStatus==='cancelled'?'Register again':'Register',action:'register' as const};
}
export function eventFailureMessage(code?:string){return code==='EVENT_FULL'?'This event is full. There is no waitlist.':code==='EVENT_CLOSED'?'Registration and cancellation are closed because this event has started.':code==='EVENT_NOT_FOUND'?'This event is no longer available.':'The event request was not accepted. Please refresh and review the current event.';}
