import {useEffect,useRef,useState} from 'react';
import {BackHandler,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import type {MemberService,ProfileResponse} from '../../api/member-service';
import {ApiFailure} from '../../api/client';
import {SessionFailure} from '../../auth/session-core';
import {Copy} from '../../components/UI';
import {Section} from '../../components/FeaturePage';
import {tokens} from '../../theme/tokens';
import {changedProfileFields,profileDraft,validateProfileDraft,type ProfileDraft} from './editable-fields';
export function ProfileEditor({data,service,tribeId,onSaved,onCancel,onExpired}:{data:ProfileResponse;service:MemberService;tribeId:string;onSaved:(data:ProfileResponse,message:string)=>void;onCancel:()=>void;onExpired:()=>void}) {
 const [draft,setDraft]=useState<ProfileDraft>(()=>profileDraft(data.profile!));const [errors,setErrors]=useState<Partial<Record<keyof ProfileDraft,string>>>({});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[blocked,setBlocked]=useState(false);const submitting=useRef(false);const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{const listener=BackHandler.addEventListener('hardwareBackPress',()=>{if(!submitting.current)onCancel();return true;});return()=>listener.remove();},[onCancel]);
 function expired(error:unknown){if(error instanceof ApiFailure&&error.status===401||error instanceof SessionFailure&&!error.canRetry){onExpired();return true;}return false;}
 async function reconcile(confirmed:boolean){
  try{const current=await service.profile(tribeId);if(!mounted.current)return;onSaved(current,confirmed?'Your profile has been saved.':'The save response could not be confirmed. The latest persisted profile is shown; review it before editing again.');}
  catch(error){if(!mounted.current||expired(error))return;setBlocked(true);setMessage(confirmed?'The update was accepted, but the latest profile could not be loaded. Reload the latest profile before editing again.':'The save outcome could not be confirmed. Reload the latest profile before editing again.');}
 }
 async function save(){if(submitting.current||blocked)return;const validation=validateProfileDraft(draft);setErrors(validation);if(Object.keys(validation).length)return;
  const changed=changedProfileFields(profileDraft(data.profile!),draft);if(!Object.keys(changed).length){setMessage('No profile changes to save.');return;}
  submitting.current=true;setBusy(true);setMessage('');let confirmed=false;
  try{await service.updateProfile(tribeId,changed);confirmed=true;}catch(error){if(!mounted.current||expired(error))return;if(error instanceof ApiFailure&&error.status>=400&&error.status<500){setMessage(error.message);submitting.current=false;setBusy(false);return;}}
  await reconcile(confirmed);if(mounted.current){submitting.current=false;setBusy(false);}
 }
 return <Section title="EDIT PROFILE"><Copy>Email, date of birth, membership and Tribe-managed information cannot be changed here.</Copy>{(['bio','phone','location','occupation'] as const).map(field=><View key={field} style={s.field}><Text style={s.label}>{field==='bio'?'About me':field[0]!.toUpperCase()+field.slice(1)}</Text><TextInput accessibilityLabel={field==='bio'?'About me':field[0]!.toUpperCase()+field.slice(1)} editable={!busy&&!blocked} multiline={field==='bio'} keyboardType={field==='phone'?'phone-pad':'default'} value={draft[field]??''} onChangeText={value=>setDraft(previous=>({...previous,[field]:value}))} style={[s.input,field==='bio'&&s.bio]}/>{errors[field]&&<Text accessibilityRole="alert" style={s.error}>{errors[field]}</Text>}</View>)}
  {message&&<Text accessibilityLiveRegion="polite" style={s.label}>{message}</Text>}
  {blocked?<Pressable accessibilityRole="button" accessibilityLabel="Reload latest profile" disabled={busy} style={s.button} onPress={()=>{if(submitting.current)return;submitting.current=true;setBusy(true);void reconcile(false).finally(()=>{submitting.current=false;if(mounted.current)setBusy(false);});}}><Copy>{busy?'Loading…':'Reload latest profile'}</Copy></Pressable>:<Pressable accessibilityRole="button" accessibilityLabel="Save profile" disabled={busy} accessibilityState={{disabled:busy,busy}} style={s.button} onPress={()=>void save()}><Copy>{busy?'Saving…':'Save profile'}</Copy></Pressable>}
  <Pressable accessibilityRole="button" accessibilityLabel="Cancel profile editing" disabled={busy} style={s.button} onPress={onCancel}><Copy>Cancel</Copy></Pressable>
 </Section>;
}
const s=StyleSheet.create({field:{gap:8},label:{color:tokens.colors.foreground,fontFamily:tokens.fonts.body,fontSize:12},input:{minHeight:48,borderWidth:1,borderColor:tokens.colors.border,borderRadius:5,padding:12,color:tokens.colors.foreground,fontFamily:tokens.fonts.body,fontSize:16},bio:{minHeight:112,textAlignVertical:'top'},error:{color:tokens.colors.accent,fontSize:12},button:{minHeight:44,justifyContent:'center',padding:8}});
