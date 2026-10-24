import type {PropsWithChildren,ReactNode} from 'react';
import {ScrollView,StyleSheet,Text,View} from 'react-native';
import {LoadingState,ErrorState} from './UI';
import type {ResourceState} from '../state/use-resource';
import {tokens} from '../theme/tokens';
export function FeaturePage({title,subtitle,children}:{title:string;subtitle?:string}&PropsWithChildren) {
  return <ScrollView contentContainerStyle={s.page}><Text accessibilityRole="header" style={s.title}>{title}</Text>{subtitle&&<Text style={s.subtitle}>{subtitle}</Text>}<View style={s.content}>{children}</View></ScrollView>;
}
export function ResourceBoundary<T>({state,retry,children}:{state:ResourceState<T>;retry:()=>void;children:(data:T)=>ReactNode}) {
  return state.kind==='loading'?<LoadingState/>:state.kind==='error'?<ErrorState message={state.message} retry={retry}/>:children(state.data);
}
export function Section({title,children}:{title:string}&PropsWithChildren){return <View style={s.section}><Text accessibilityRole="header" style={s.label}>{title}</Text>{children}</View>;}
const s=StyleSheet.create({page:{padding:24,gap:8,width:'100%',maxWidth:560,alignSelf:'center'},title:{fontFamily:tokens.fonts.semibold,fontSize:20,color:tokens.colors.accent},subtitle:{fontFamily:tokens.fonts.body,fontSize:11.672,color:'white',lineHeight:17},content:{gap:18,marginTop:18},section:{borderWidth:1,borderColor:tokens.colors.subtleBorder,borderRadius:5,padding:12,gap:10},label:{fontFamily:tokens.fonts.body,fontWeight:'600',fontSize:10,color:tokens.colors.accent}});
