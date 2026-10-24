import type { MemberView } from '@trueda-tribe-id/contracts';
// Entirely synthetic test data. Names, profile, places and membership identifiers are fictional.
// Never seeded, used as identity, or returned by protected routes; no real portrait is supplied.
export const developmentMemberView: MemberView = {
  identity: { membershipId:'00000000-0000-4000-8000-000000000001', tribeId:'00000000-0000-4000-8000-000000000002', tribeName:'Example Tribe', memberNumber:'EXAMPLE-TEST-0001', role:'member', status:'active', joinedAt:'2024-05-01T00:00:00Z', displayName:'Example Test Member', avatarUrl:null },
  profile: { bio:'Synthetic profile for development and automated tests.\n\nThis fictional member does not represent a real person.', email:'member@example.com', phone:null, dateOfBirth:null, location:'Example City, Test Region.', occupation:'Example test occupation', skills:['Example Skill A','Example Skill B','Example Skill C','Example Skill D'], teams:['Example Team A','Example Team B','Example Team C','Example Team D'], achievements:[
    {id:'tribe-star',name:'Tribe Star',description:'Awarded for outstanding contributions',awardedAt:'2026-11-01T00:00:00Z'},
    {id:'top-contributor',name:'Top Contributor',description:'Consistent and valuable contributions',awardedAt:'2026-11-01T00:00:00Z'},
    {id:'event-champion',name:'Event Champion',description:'Active participation in Example Event',awardedAt:'2026-11-01T00:00:00Z'}] },
  card: {id:'00000000-0000-4000-8000-000000000003',status:'issued',issuedAt:'2024-05-01T00:00:00Z',expiresAt:null},
  announcements: [
    {id:'tour',title:'Example Tour 2027 - Registration is Open',body:'Get ready, Registration for Example Tour 2027 is now officially open. Register and be part of this global movement.',category:'important',publishedAt:'2026-11-20T00:00:00Z'},
    {id:'hangout',title:'Example Tribe Hangout, 2027',body:'Lets show up participate and have fun',category:'event',publishedAt:'2026-11-12T00:00:00Z'},
    {id:'outreach',title:'Example Tribe orphanage Outreach, 2027',body:'Here is the schedule for the week. Lets show up, participate and touch a soul.',category:'general',publishedAt:'2026-11-12T00:00:00Z'},
    {id:'outreach-smile',title:'Example Tribe orphanage Outreach, 2027',body:"Lets show up and put a smile on someone's face",category:'general',publishedAt:'2026-11-12T00:00:00Z'}],
  events:[
    {id:'hangout',title:'Example Tribe Community Hangout',location:'Example City, Test Region.',startsAt:'2026-11-18T11:00:00Z',endsAt:'2026-11-18T14:00:00Z',timezone:'Africa/Lagos',registrationStatus:null},
    {id:'summit',title:'Example Summit',location:'Example Test Hall, Example City.',startsAt:'2027-04-10T08:00:00Z',endsAt:'2027-04-14T17:00:00Z',timezone:'Africa/Lagos',registrationStatus:null}]
};
export function previewView(scenario: string | undefined): MemberView {
  const view = structuredClone(developmentMemberView);
  if (scenario === 'empty') { view.profile=null; view.card=null; view.events=[]; view.announcements=[]; }
  if (scenario === 'long') { view.identity.displayName='A Tribe Member With A Long Display Name'; view.announcements[0]!.title='An important announcement with a longer title that must wrap without clipping content or shifting navigation off screen'; view.profile!.bio += '\n\n' + 'Community and creativity. '.repeat(24); }
  return view;
}
