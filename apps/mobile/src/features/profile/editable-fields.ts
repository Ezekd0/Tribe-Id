import type {ProfileView,ProfileUpdateRequest} from '@trueda-tribe-id/contracts';
export type ProfileDraft=Pick<ProfileView,'bio'|'phone'|'location'|'occupation'>;
export function profileDraft(profile:ProfileView):ProfileDraft {
 return {bio:profile.bio,phone:profile.phone,location:profile.location,occupation:profile.occupation};
}
export function normalizeProfileDraft(draft:ProfileDraft):ProfileDraft {
 const phone=draft.phone?.trim()??'';
 return {bio:draft.bio,phone:phone?phone.replace(/[ ()-]/g,''):null,location:draft.location?.trim()||null,occupation:draft.occupation?.trim()||null};
}
export function validateProfileDraft(draft:ProfileDraft) {
 const errors:Partial<Record<keyof ProfileDraft,string>>={};
 if(draft.bio.length>2000)errors.bio='Bio must be at most 2,000 characters.';
 for(const field of ['location','occupation'] as const)if((draft[field]?.trim().length??0)>200)errors[field]='Use at most 200 characters.';
 const phone=draft.phone?.trim()??'';
 if(phone&&(phone.length>25||!/^\+?[0-9 ()-]+$/.test(phone)||!/^\+?[0-9]{7,15}$/.test(phone.replace(/[ ()-]/g,''))))errors.phone='Use 7–15 digits, with an optional leading + and spaces, parentheses or hyphens.';
 return errors;
}
export function changedProfileFields(original:ProfileDraft,draft:ProfileDraft):ProfileUpdateRequest {
 const before=normalizeProfileDraft(original),after=normalizeProfileDraft(draft);const changed:ProfileUpdateRequest={};
 for(const field of ['bio','phone','location','occupation'] as const)if(before[field]!==after[field])changed[field]=after[field] as never;
 return changed;
}
