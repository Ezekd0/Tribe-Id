import type { AnnouncementView } from '@trueda-tribe-id/contracts';
import { Icon } from '../../components/FigmaAsset';
import { EmptyState } from '../../components/AsyncState';
export function Announcements({announcements}:{announcements:AnnouncementView[]}) {
  if (!announcements.length) return <EmptyState>No announcements yet.</EmptyState>;
  return <ul className="announcement-list">{announcements.map(item=><li key={item.id}><article className="announcement-card"><span className="category-badge">{item.category.toUpperCase()}</span><h2>{item.title}</h2><p>{item.body}</p><time dateTime={item.publishedAt}><Icon name="calendar" width={22} height={24}/>{new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric',timeZone:'Africa/Lagos'}).format(new Date(item.publishedAt)).toUpperCase()}</time></article></li>)}</ul>;
}
