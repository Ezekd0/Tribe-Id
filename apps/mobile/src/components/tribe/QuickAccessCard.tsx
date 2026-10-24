import { Pressable, StyleSheet, Text } from 'react-native';
import { TribeIcon,type IconName } from './Icon';
import { tokens } from '../../theme/tokens';
export function QuickAccessCard({label,icon,onPress}:{label:string;icon:IconName;onPress:()=>void}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({pressed})=>[s.card,pressed&&{borderColor:tokens.colors.accent,backgroundColor:'#171020'}]}><TribeIcon name={icon} size={37} color={tokens.colors.accent}/><Text style={s.label}>{label}</Text></Pressable>;
}
const s=StyleSheet.create({card:{flex:1,minHeight:93.151,minWidth:0,borderWidth:0.548,borderColor:tokens.colors.subtleBorder,borderRadius:2.739,alignItems:'center',justifyContent:'center',paddingHorizontal:2,paddingVertical:12,gap:9},label:{color:'white',fontFamily:tokens.fonts.body,fontWeight:'500',fontSize:13.041,textAlign:'center',flexShrink:1}});
