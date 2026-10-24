import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { tokens } from '../../theme/tokens';
export type IconName = ComponentProps<typeof Feather>['name'];
/** One consistent temporary icon family; replace with exact local Figma exports later. */
export function TribeIcon({name,size=24,color=tokens.colors.foreground}:{name:IconName;size?:number;color?:string}) {
  return <Feather name={name} size={size} color={color} accessible={false}/>;
}
