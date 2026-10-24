import { Platform } from 'react-native';
/** Observed Figma values. Platform body face is temporary until Inter is bundled. */
export const tokens = {
  colors: {background:'#010101',foreground:'#ffffff',accent:'#7d57bb',border:'rgba(255,255,255,0.7)',subtleBorder:'rgba(255,255,255,0.1)',muted:'rgba(255,255,255,0.5)',secondary:'rgba(255,255,255,0.8)',inactive:'#858585',placeholder:'#191919'},
  spacing:{page:24}, radius:{card:5,control:2},
  fonts:{heading:'Montserrat-Regular',medium:'Montserrat-Medium',semibold:'Montserrat-SemiBold',bold:'Montserrat-Bold',body:Platform.select({ios:'System',android:'sans-serif',default:'Arial'})},
} as const;
