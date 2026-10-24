import type { MemberView } from '@trueda-tribe-id/contracts';
import { MemberSummary } from '../../components/MemberSummary';
import { EmptyState } from '../../components/AsyncState';
export function IDCard({view}:{view:MemberView}) {
  return <div className="id-card-page">{view.card?<><div className="id-card-holder"><MemberSummary view={view} card/></div>{view.card.status!=='issued' && <p role="status">This Tribe ID card is {view.card.status}.</p>}</>:<EmptyState>Your Tribe ID card has not been issued yet.</EmptyState>}</div>;
}
