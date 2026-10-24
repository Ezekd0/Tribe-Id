import {createContext,useContext} from 'react';
import type {PushStatus} from './controller';
export const PushContext=createContext<{status:PushStatus;receivedVersion:number;sync:(tribeId:string,request?:boolean)=>Promise<void>}>({status:'unavailable',receivedVersion:0,sync:async()=>{}});
export const useDevicePush=()=>useContext(PushContext);
