import { Pressable, StyleSheet, View } from 'react-native';
import { TribeIcon } from './Icon';
import { Avatar } from './Avatar';
export function TribeHeader({avatarUrl,onMenu,onAnnouncements,onProfile}:{avatarUrl:string|null;onMenu:()=>void;onAnnouncements:()=>void;onProfile:()=>void}) {
  return <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="Open member menu" onPress={onMenu} style={({pressed})=>[s.target,pressed&&s.pressed]}><TribeIcon name="menu" size={24}/></Pressable><View style={s.actions}><Pressable accessibilityRole="button" accessibilityLabel="Announcements" onPress={onAnnouncements} style={({pressed})=>[s.target,pressed&&s.pressed]}><TribeIcon name="bell" size={22}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="My Profile" onPress={onProfile} style={({pressed})=>[s.target,pressed&&s.pressed]}><Avatar uri={avatarUrl} size={30}/></Pressable></View></View>;
}
const s=StyleSheet.create({header:{height:44,marginHorizontal:17,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},target:{width:44,height:44,alignItems:'center',justifyContent:'center'},actions:{flexDirection:'row'},pressed:{opacity:0.6}});
