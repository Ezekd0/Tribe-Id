import type { MemberView } from '@trueda-tribe-id/contracts';
import { CompactIDCard } from '../../components/MemberSummary';
import { Icon } from '../../components/FigmaAsset';
import { EmptyState } from '../../components/AsyncState';
import { Events } from './Events';
export function Hub({view,notify}:{view:MemberView;notify:(message:string)=>void}) {
  const latest=view.announcements[0];
  return <div className="hub-content"><section className="hub-welcome"><div className="welcome-copy"><p className="welcome-eyebrow">Welcome back,</p><h1>{view.identity.displayName}</h1><p className="welcome-number">{view.identity.memberNumber}</p><p className="welcome-description">This is your official Tribe Hub. Stay updated, connected and empowered.</p><a className="view-card-button" href="/id-card"><Icon name="viewCard" width={15} height={12}/>View my ID Card</a></div>{view.card?<CompactIDCard view={view}/>:<EmptyState>Your Tribe ID card has not been issued yet.</EmptyState>}</section>{latest?<a className="latest-announcement" href="/announcements"><Icon name="megaphone" width={46} height={40}/><div><span>LATEST ANNOUNCEMENT</span><h2>{latest.title}</h2></div><Icon name="arrow" width={6} height={9}/></a>:<EmptyState>No announcements yet.</EmptyState>}<section className="quick-access"><h2>QUICK ACCESS</h2><div className="quick-access-grid"><a href="/id-card"><Icon name="card" width={37} height={37}/><span>My ID Card</span></a><a href="/profile"><Icon name="profile" width={38} height={38}/><span>My Profile</span></a><a href="/announcements"><Icon name="announcement" width={37} height={37}/><span>Announcement</span></a></div></section><Events events={view.events} notify={notify}/></div>;
}
