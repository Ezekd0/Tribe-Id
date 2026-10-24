import {useCallback} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import type {AnnouncementView} from '@trueda-tribe-id/contracts';
import type {MemberService} from '../../api/member-service';
import {useResource} from '../../state/use-resource';
import {FeaturePage,ResourceBoundary} from '../../components/FeaturePage';
import {EmptyState} from '../../components/UI';
import {TribeIcon} from '../../components/tribe/Icon';
import {tokens} from '../../theme/tokens';
/** Audited feed cards already contain the entire announcement; no unsupported detail route. */
export function AnnouncementFeed({announcements}:{announcements:AnnouncementView[]}) {
 if(!announcements.length)return <EmptyState message="No announcements yet."/>;
 return <>{announcements.map(announcement=><View key={announcement.id} style={s.card}><View style={s.category}><Text style={s.categoryText}>{announcement.category.toUpperCase()}</Text></View><Text accessibilityRole="header" style={s.title}>{announcement.title}</Text><Text style={s.body}>{announcement.body}</Text><View style={s.date}><TribeIcon name="calendar" size={12}/><Text style={s.dateText}>{new Date(announcement.publishedAt).toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).toUpperCase()}</Text></View></View>)}</>;
}
export function AnnouncementsScreen({service,tribeId,onExpired}:{service:MemberService;tribeId:string;onExpired:()=>void}) {
 const load=useCallback(()=>service.announcements(tribeId),[service,tribeId]);const resource=useResource(load,onExpired);
 return <FeaturePage title="Announcement" subtitle="Stay updated with everything happening in the Tribe"><ResourceBoundary {...resource}>{data=><AnnouncementFeed announcements={data.announcements}/>}</ResourceBoundary></FeaturePage>;
}
const s=StyleSheet.create({card:{borderWidth:1,borderColor:tokens.colors.border,borderRadius:5,padding:7,gap:8,minHeight:165},category:{alignSelf:'flex-start',backgroundColor:'rgba(125,87,187,0.3)',borderRadius:5,padding:6},categoryText:{color:tokens.colors.accent,fontFamily:tokens.fonts.semibold,fontSize:16},title:{fontFamily:tokens.fonts.semibold,fontSize:16,color:'white'},body:{fontFamily:tokens.fonts.body,fontSize:11.883,lineHeight:17,color:'white'},date:{flexDirection:'row',gap:6,alignItems:'center',marginTop:4},dateText:{fontFamily:tokens.fonts.body,fontSize:11.883,color:'white'}});
