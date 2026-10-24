import { Pressable, StyleSheet, View } from 'react-native';
import { memberRoutes,routeLabels,type MemberRoute } from '../../navigation/routes';
import { TribeIcon,type IconName } from './Icon';
import { tokens } from '../../theme/tokens';
export const routeIcons:Record<MemberRoute,IconName>={hub:'home','id-card':'credit-card',announcements:'bell',profile:'user',settings:'settings',events:'calendar',notifications:'bell'};
export function TribeBottomNavigation({route,navigate}:{route:MemberRoute;navigate:(route:MemberRoute)=>void}) {
  const selectedRoute=route==='notifications'?'announcements':route==='settings'?'profile':route==='events'?'hub':route;
  return <View accessibilityRole="tablist" style={s.navigation}>{memberRoutes.map(item=><Pressable key={item} accessibilityRole="tab" accessibilityLabel={routeLabels[item]} accessibilityState={{selected:selectedRoute===item}} aria-selected={selectedRoute===item} onPress={()=>navigate(item)} style={({pressed})=>[s.tab,pressed&&{opacity:0.6}]}><TribeIcon name={routeIcons[item]} size={31} color={selectedRoute===item?tokens.colors.foreground:tokens.colors.inactive}/></Pressable>)}</View>;
}
const s=StyleSheet.create({navigation:{height:60,flexDirection:'row',justifyContent:'space-between',paddingHorizontal:24,width:'100%',maxWidth:560,alignSelf:'center'},tab:{width:44,height:52,alignItems:'center',justifyContent:'center'}});
