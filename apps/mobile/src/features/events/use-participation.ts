import {useCallback,useEffect,useRef,useState} from 'react';
import type {EventView} from '@trueda-tribe-id/contracts';
import type {MemberService} from '../../api/member-service';
import {ApiFailure} from '../../api/client';import {SessionFailure} from '../../auth/session-core';
import {eventFailureMessage,participationState} from './participation';
export function useParticipation(initial:EventView[],service:MemberService|undefined,tribeId:string,onExpired?:()=>void,refreshOnMount=false){
 const [events,setEvents]=useState(initial),[pending,setPending]=useState<string|null>(null),[message,setMessage]=useState(''),[blocked,setBlocked]=useState(false),[full,setFull]=useState<string[]>([]);
 const [,tick]=useState(0);useEffect(()=>{const timer=setInterval(()=>tick(value=>value+1),1000);return()=>clearInterval(timer);},[]);
 const lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{setEvents(initial);setFull([]);setMessage('');},[initial,tribeId]);
 const expired=useCallback((error:unknown)=>{if(error instanceof ApiFailure&&error.status===401||error instanceof SessionFailure&&!error.canRetry){onExpired?.();return true;}return false;},[onExpired]);
 const reload=useCallback(async()=>{if(!service)return false;try{const current=await service.events(tribeId);if(!mounted.current)return false;setEvents(current.events);setBlocked(false);return true;}catch(error){if(mounted.current&&!expired(error)){setBlocked(true);setMessage('Current event participation could not be loaded. Reload events before making another change.');}return false;}},[service,tribeId,expired]);
 useEffect(()=>{if(refreshOnMount&&service)void reload();},[reload,refreshOnMount,service]);
 async function change(event:EventView){const state=participationState(event);if(!service||!state.action||lock.current||blocked||full.includes(event.id)&&state.action==='register')return;
  lock.current=true;setPending(event.id);setMessage('');let outcome='';
  try{await service.eventRegistration(tribeId,event.id,state.action);outcome=state.action==='register'?'Your event registration is confirmed.':'Your event registration has been cancelled.';}
  catch(error){if(!mounted.current||expired(error)){lock.current=false;return;}if(error instanceof ApiFailure&&error.status>=400&&error.status<500){outcome=eventFailureMessage(error.code);if(error.code==='EVENT_FULL')setFull(previous=>[...previous,event.id]);}else outcome='The response could not be confirmed. Current participation has been reloaded; review it before making another change.';}
  const loaded=await reload();if(mounted.current){if(loaded)setMessage(outcome);setPending(null);}lock.current=false;
 }
 return {events,pending,message,blocked,full,change,reload:async()=>{setFull([]);return reload();}};
}
