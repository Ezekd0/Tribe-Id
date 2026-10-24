import type { MemberView } from '@trueda-tribe-id/contracts';
import { Avatar, FigmaAsset, Icon } from './FigmaAsset';
export function memberSince(value:string|null){return value ? new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value)) : 'Not available';}
export function cardStatus(view:MemberView){return view.card?.status==='revoked'?'REVOKED':view.card?.status==='expired'?'EXPIRED':view.identity.status.toUpperCase()+' MEMBER';}
export function MemberSummary({view,card=false}:{view:MemberView;card?:boolean}) {
  const {identity,profile}=view;
  return <section className={`member-summary ${card?'identity-card':''}`} aria-label={card?'Tribe ID card':'Tribe member summary'}>
    <FigmaAsset file="4312b.png" width={354} height={124} className="summary-background"/>
    {card && <FigmaAsset file="95b7d.png" width={50} height={43} className="card-logo"/>}
    <Avatar url={identity.avatarUrl} name={identity.displayName}/>
    <div className="member-details"><span className="member-status"><span className="status-dot"/>{cardStatus(view)}</span><h2>{identity.displayName}</h2><p className="member-role">TRIBE MEMBER</p><p className="member-number">{identity.memberNumber}</p><p className="identity-meta"><Icon name="location" width={11} height={13}/>{profile?.location??'Location not provided'}</p><p className="identity-meta since"><Icon name="memberSince" width={11} height={13}/>Member Since {memberSince(identity.joinedAt)}</p></div>
    {card && <div className="verification-slot" aria-label="Card verification is not available"/>}
  </section>;
}
export function CompactIDCard({view}:{view:MemberView}) {
  return <div className="compact-id-card" aria-label="Tribe ID card preview"><FigmaAsset file="4312b.png" width={170} height={148} className="summary-background"/><FigmaAsset file="95b7d.png" width={27} height={25} className="compact-logo"/><span className="compact-status"><span className="status-dot"/>{cardStatus(view)}</span><div className="compact-number">MEMBER ID<strong>{view.identity.memberNumber}</strong></div><p className="compact-since">{cardStatus(view)}<br/>Since {memberSince(view.identity.joinedAt)}</p><div className="compact-verification"/><div className="compact-portrait"><Avatar url={view.identity.avatarUrl} name={view.identity.displayName}/><strong>{view.identity.displayName}</strong><span>Tribe Member</span></div></div>;
}
