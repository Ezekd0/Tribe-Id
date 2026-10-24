import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AnnouncementView } from '@trueda-tribe-id/contracts';
import { tokens } from '../../theme/tokens';
import { TribeIcon } from './Icon';
import { announcementAge } from './format';
export function AnnouncementCard({announcement,onPress}:{announcement:AnnouncementView;onPress:()=>void}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Latest announcement: ${announcement.title}`} onPress={onPress} style={({pressed})=>[s.card,pressed&&{opacity:0.6}]}><TribeIcon name="volume-2" size={40}/><View style={s.copy}><Text style={s.label}>LATEST ANNOUNCEMENT</Text><Text style={s.title}>{announcement.title}</Text></View><View style={s.tail}><Text style={s.age}>{announcementAge(announcement.publishedAt)}</Text><TribeIcon name="chevron-right" size={12}/></View></Pressable>;
}
const s=StyleSheet.create({card:{minHeight:70,borderWidth:1,borderColor:tokens.colors.border,borderRadius:5,flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingVertical:8,gap:12},copy:{flex:1,minWidth:0},label:{fontFamily:tokens.fonts.body,fontWeight:'300',fontSize:10.693,color:tokens.colors.muted,marginBottom:4},title:{fontFamily:tokens.fonts.body,fontWeight:'600',fontSize:12.475,lineHeight:15,color:'white'},tail:{flexDirection:'row',gap:5,alignItems:'center'},age:{color:tokens.colors.secondary,fontFamily:tokens.fonts.body,fontSize:10,fontWeight:'300'}});
