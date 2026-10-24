import type { MemberView, SessionView, ProfileUpdateRequest, CardProofResponse, CardVerificationResponse, PortraitResponse, PortraitUploadRequest, PortraitUploadResponse, MemberPreferences, MemberPreferencesUpdate, NotificationInboxResponse, PrivacyRequestType, PrivacyRequestView, PrivacyRequestListResponse } from '@trueda-tribe-id/contracts';
import {parsePrivacyRequest,parsePrivacyRequests} from '../features/privacy/request-contract';
import {parsePreferences,parseInbox} from '../features/settings/preferences';
import {parsePortrait,parsePortraitUpload} from '../features/portrait/portrait-contract';
import {parseCardProof,parseCardVerification} from '../features/tribe-id/verification-contract';
import type { ApiClient } from './client';
export type HubView = Pick<MemberView, 'identity' | 'card' | 'announcements' | 'events'>;
export type IDCardResponse=Pick<MemberView,'identity'|'card'> & {location:string|null};
export type ProfileResponse=Pick<MemberView,'identity'|'profile'>;
export class MemberService {
  constructor(private readonly api: Pick<ApiClient, 'get'> & Partial<Pick<ApiClient,'patch'|'post'|'delete'|'write'>>) {}
  memberships() { return this.api.get<SessionView>('/api/v1/me'); }
  private path(tribeId:string,resource:string) {if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tribeId))throw new Error('Invalid Tribe ID');return `/api/v1/tribes/${tribeId}/${resource}`;}
  private resource<T>(tribeId:string,resource:string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tribeId)) throw new Error('Invalid Tribe ID');
    return this.api.get<T>(`/api/v1/tribes/${tribeId}/${resource}`);
  }
  hub(tribeId:string) {return this.resource<HubView>(tribeId,'hub');}
  idCard(tribeId:string) {return this.resource<IDCardResponse>(tribeId,'id-card');}
  async cardProof(tribeId:string):Promise<CardProofResponse> {return parseCardProof(await this.resource<unknown>(tribeId,'id-card/proof'));}
  async verifyCard(tribeId:string,proof:string):Promise<CardVerificationResponse> {
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tribeId))throw new Error('Invalid Tribe ID');
    if(!proof||proof.length>2048)throw new Error('Paste a card proof of at most 2,048 characters.');
    if(!this.api.post)throw new Error('Card verification unavailable.');
    return parseCardVerification(await this.api.post<unknown>(`/api/v1/tribes/${tribeId}/id-card/verify`,{proof}));
  }
  async portrait(tribeId:string):Promise<PortraitResponse>{return parsePortrait(await this.resource<unknown>(tribeId,'profile/portrait'));}
  async startPortraitUpload(tribeId:string,request:PortraitUploadRequest):Promise<PortraitUploadResponse>{
    const path=this.path(tribeId,'profile/portrait/uploads');if(!this.api.write)throw new Error('Portrait updates unavailable.');return parsePortraitUpload(await this.api.write<unknown>(path,'POST',request),request.mimeType);
  }
  finalizePortrait(tribeId:string,assetId:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId))throw new Error('Invalid portrait asset');if(!this.api.post)throw new Error('Portrait updates unavailable.');return this.api.post<void>(this.path(tribeId,`profile/portrait/uploads/${assetId}/finalize`));}
  removePortrait(tribeId:string){if(!this.api.delete)throw new Error('Portrait updates unavailable.');return this.api.delete<void>(this.path(tribeId,'profile/portrait'));}
  profile(tribeId:string) {return this.resource<ProfileResponse>(tribeId,'profile');}
  updateProfile(tribeId:string, update:ProfileUpdateRequest) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tribeId)) throw new Error('Invalid Tribe ID');
    if(!this.api.patch)throw new Error('Profile updates are unavailable.');
    return this.api.patch<void>(`/api/v1/tribes/${tribeId}/profile`,{...update});
  }
  eventRegistration(tribeId:string,eventId:string,action:'register'|'cancel') {
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(!uuid.test(tribeId)||!uuid.test(eventId))throw new Error('Invalid event path');
    const path=`/api/v1/tribes/${tribeId}/events/${eventId}/registration`;
    if(action==='register'){if(!this.api.post)throw new Error('Event registration unavailable.');return this.api.post<void>(path);}
    if(!this.api.delete)throw new Error('Event cancellation unavailable.');return this.api.delete<void>(path);
  }
  async preferences(tribeId:string):Promise<MemberPreferences>{return parsePreferences(await this.resource<unknown>(tribeId,'preferences'));}
  async updatePreferences(tribeId:string,update:MemberPreferencesUpdate){if(!this.api.write)throw new Error('Preferences updates unavailable.');return parsePreferences(await this.api.write<unknown>(this.path(tribeId,'preferences'),'PATCH',update));}
  async inbox(tribeId:string,offset=0):Promise<NotificationInboxResponse>{if(!Number.isInteger(offset)||offset<0||offset>10000)throw new Error('Invalid inbox page');return parseInbox(await this.api.get<unknown>(this.path(tribeId,'notifications'),{limit:50,offset}));}
  async notification(tribeId:string,id:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Invalid notification');const item=parseInbox({notifications:[await this.api.get<unknown>(this.path(tribeId,`notifications/${id}`))]}).notifications[0]!;if(item.id!==id)throw new Error('The notification response could not be validated.');return item;}
  markNotificationRead(tribeId:string,id:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Invalid notification');if(!this.api.post)throw new Error('Inbox updates unavailable.');return this.api.post<void>(this.path(tribeId,`notifications/${id}/read`));}
  async privacyRequests(tribeId:string,offset=0):Promise<PrivacyRequestListResponse>{if(!Number.isInteger(offset)||offset<0||offset>10000)throw new Error('Invalid request page');return parsePrivacyRequests(await this.api.get<unknown>(this.path(tribeId,'privacy-requests'),{limit:50,offset}));}
  async createPrivacyRequest(tribeId:string,type:PrivacyRequestType):Promise<PrivacyRequestView>{if(!['export','deletion'].includes(type))throw new Error('Invalid privacy request type');if(!this.api.post)throw new Error('Privacy review requests unavailable.');const request=parsePrivacyRequest(await this.api.post<unknown>(this.path(tribeId,'privacy-requests'),{type}));if(request.type!==type||request.status!=='pending')throw new Error('The privacy review response could not be confirmed.');return request;}
  announcements(tribeId:string) {return this.resource<Pick<MemberView,'announcements'>>(tribeId,'announcements');}
  events(tribeId:string) {return this.resource<Pick<MemberView,'events'>>(tribeId,'events');}
}
