import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PropsWithChildren } from 'react';
import { tokens } from '../theme/tokens';
export function Copy({children,muted=false}:PropsWithChildren<{muted?:boolean}>) {return <Text style={[styles.copy,muted&&styles.muted]}>{children}</Text>;}
export function Action({label,onPress}:{label:string;onPress:()=>void}) {return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({pressed})=>[styles.action,pressed&&{opacity:0.6}]}><Copy>{label}</Copy></Pressable>;}
export function StatePanel({message,loading,retry}:{message:string;loading?:boolean;retry?:()=>void}) {return <View accessibilityLiveRegion="polite" style={styles.panel}>{loading&&<ActivityIndicator accessibilityLabel="Loading" color={tokens.colors.accent}/>}<Copy>{message}</Copy>{retry&&<Action label="Try again" onPress={retry}/>}</View>;}
export function LoadingState({message='Loading your Tribe Hub…'}:{message?:string}) {return <StatePanel message={message} loading/>;}
export function EmptyState({message}:{message:string}) {return <StatePanel message={message}/>;}
export function ErrorState({message,retry}:{message:string;retry:()=>void}) {return <StatePanel message={message} retry={retry}/>;}
export const styles=StyleSheet.create({copy:{color:tokens.colors.foreground,fontFamily:tokens.fonts.body,fontSize:12,lineHeight:17},muted:{color:tokens.colors.muted},action:{minHeight:44,justifyContent:'center',paddingHorizontal:8},panel:{padding:16,gap:12,borderWidth:1,borderColor:tokens.colors.subtleBorder,borderRadius:5}});
