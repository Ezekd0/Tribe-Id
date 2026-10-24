import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { TribeIcon } from './Icon';
import { tokens } from '../../theme/tokens';
export function Avatar({uri,size}:{uri:string|null;size:number}) {
  const [failed,setFailed] = useState<string|null>(null);
  return <View style={[s.avatar,{width:size,height:size,borderRadius:size/2}]}>{uri && failed !== uri ? <Image accessibilityLabel="Member portrait" source={{uri,cache:'reload'}} onError={() => setFailed(uri)} style={{width:size,height:size,borderRadius:size/2}} resizeMode="cover"/> : <TribeIcon name="user" size={size*0.48} color={tokens.colors.inactive}/>}</View>;
}
const s=StyleSheet.create({avatar:{backgroundColor:tokens.colors.placeholder,alignItems:'center',justifyContent:'center',overflow:'hidden'}});
