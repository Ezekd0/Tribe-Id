import { useState } from 'react';
import type { EventView } from '@trueda-tribe-id/contracts';
import { Icon } from '../../components/FigmaAsset';
import { EmptyState } from '../../components/AsyncState';
export function Events({events,notify}:{events:EventView[];notify:(message:string)=>void}) {
  const [showAll,setShowAll]=useState(false);
  return <section id="events" className="events-section"><div className="section-heading"><h2>UPCOMING EVENTS</h2>{events.length>2 && <button className="text-button" onClick={()=>setShowAll(!showAll)}>{showAll?'Show less':'View all'}</button>}</div>{events.length===0?<EmptyState>No upcoming events yet.</EmptyState>:<ul className="event-list">{(showAll?events:events.slice(0,2)).map(event=><li key={event.id}><EventCard event={event} notify={notify}/></li>)}</ul>}</section>;
}
export function EventCard({event,notify}:{event:EventView;notify:(message:string)=>void}) {
  const start=new Date(event.startsAt),end=new Date(event.endsAt);
  const part=(date:Date,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('en',{...options,timeZone:event.timezone}).format(date);
  const days=part(start,{day:'numeric'})+(part(start,{day:'numeric',month:'numeric'})!==part(end,{day:'numeric',month:'numeric'})?' - '+part(end,{day:'numeric'}):'');
  return <article className="event-card"><time className="event-date" dateTime={event.startsAt}><strong>{days}</strong><span>{part(start,{month:'short'}).toUpperCase()}</span></time><div className="event-content"><h3>{event.title}</h3><div className="event-meta"><span><Icon name="location" width={11} height={13}/>{event.location}</span><time dateTime={event.startsAt}><Icon name="clock" width={11}/>{part(start,{hour:'numeric',minute:'2-digit',hour12:true})}</time></div></div><button className="register-button" onClick={()=>notify('Event registration is not available yet.')} aria-disabled="true">{event.registrationStatus==='registered'?'Registered':'Register'}</button></article>;
}
