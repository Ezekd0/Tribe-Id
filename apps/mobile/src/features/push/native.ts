import {Platform} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import type {PushAdapter} from './controller';
const projectId=()=>Constants.expoConfig?.extra?.eas?.projectId??Constants.easConfig?.projectId;
const supported=()=>Constants.executionEnvironment!=='storeClient'&&Device.isDevice&&(Platform.OS==='android'||Platform.OS==='ios')&&typeof projectId()==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(projectId());
// Never display untrusted content in a foreground banner. Authenticated details live in the inbox.
if(Platform.OS==='android'||Platform.OS==='ios')Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:false,shouldShowList:false,shouldPlaySound:false,shouldSetBadge:false})});
export const nativePushAdapter:PushAdapter={
 available:supported,
 async permission(request){if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('tribe-notifications',{name:'Tribe notifications',importance:Notifications.AndroidImportance.DEFAULT,lockscreenVisibility:Notifications.AndroidNotificationVisibility.PRIVATE});let permission=await Notifications.getPermissionsAsync();if(permission.status!=='granted'&&request)permission=await Notifications.requestPermissionsAsync({ios:{allowAlert:true,allowBadge:false,allowSound:false}});return permission.status==='granted';},
 async token(){if(!supported())throw new Error('Push is not configured for this device.');const value=await Notifications.getExpoPushTokenAsync({projectId:projectId()});return {provider:'expo',platform:Platform.OS as 'android'|'ios',token:value.data};},
 listen(received,tapped,rolled){if(Platform.OS!=='android'&&Platform.OS!=='ios')return()=>{};const subscriptions=[Notifications.addNotificationReceivedListener(()=>received()),Notifications.addNotificationResponseReceivedListener(value=>{if(value.actionIdentifier===Notifications.DEFAULT_ACTION_IDENTIFIER)tapped(value.notification.request.content.data);}),Notifications.addPushTokenListener(()=>rolled())];return()=>subscriptions.forEach(value=>value.remove());},
 async lastResponse(){if(Platform.OS!=='android'&&Platform.OS!=='ios')return null;const value=await Notifications.getLastNotificationResponseAsync();return value?.actionIdentifier===Notifications.DEFAULT_ACTION_IDENTIFIER?value.notification.request.content.data:null;},
 async clearResponse(){if(Platform.OS!=='android'&&Platform.OS!=='ios')return;await Notifications.clearLastNotificationResponseAsync();},
};
