import {StyleSheet,Text,View} from 'react-native';
import {tokens} from '../theme/tokens';
export function UnavailableAction({label,reason}:{label:string;reason:string}) {
 return <View accessibilityLabel={`${label}: unavailable. ${reason}`} style={s.row}><Text style={s.label}>{label}</Text><Text style={s.reason}>{reason}</Text></View>;
}
const s=StyleSheet.create({row:{gap:4,paddingVertical:6},label:{fontFamily:tokens.fonts.body,fontSize:10,color:tokens.colors.secondary},reason:{fontFamily:tokens.fonts.body,fontSize:9,lineHeight:13,color:tokens.colors.muted}});
