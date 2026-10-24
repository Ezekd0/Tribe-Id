import type { EventView } from '@trueda-tribe-id/contracts';
export function announcementAge(value:string,now=Date.now()) {
  const time=new Date(value).getTime();
  if(!Number.isFinite(time)) return '';
  const minutes=Math.max(0,Math.floor((now-time)/60000));
  if(minutes<60) return `${minutes}m ago`;
  if(minutes<1440) return `${Math.floor(minutes/60)}h ago`;
  return `${Math.floor(minutes/1440)}d ago`;
}
export function eventDate(event:EventView) {
  const start=new Date(event.startsAt),end=new Date(event.endsAt);
  const day=new Intl.DateTimeFormat('en',{day:'numeric',timeZone:event.timezone});
  const month=new Intl.DateTimeFormat('en',{month:'short',timeZone:event.timezone});
  const calendar=new Intl.DateTimeFormat('en',{year:'numeric',month:'numeric',day:'numeric',timeZone:event.timezone});
  return {day:calendar.format(start)===calendar.format(end)?day.format(start):`${day.format(start)}–${day.format(end)}`,month:month.format(start).toUpperCase(),time:new Intl.DateTimeFormat('en',{hour:'numeric',minute:'2-digit',timeZone:event.timezone}).format(start)};
}
/** Preserve source proportions at 402px; wrap welcome at smaller widths or large text. */
export function hubLayout(width:number,fontScale:number) { return {stackWelcome:width<380||fontScale>1.2,stackQuickAccess:fontScale>1.4,stackEvents:width<350||fontScale>1.2}; }
