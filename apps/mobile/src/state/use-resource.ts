import {useCallback,useEffect,useRef,useState} from 'react';
import {SessionFailure} from '../auth/session-core';
import {ApiFailure} from '../api/client';
export type ResourceState<T>={kind:'loading'}|{kind:'ready';data:T}|{kind:'error';message:string};
export function useResource<T>(load:()=>Promise<T>,onExpired:()=>void) {
  const [state,setState]=useState<ResourceState<T>>({kind:'loading'});
  const sequence=useRef(0);
  const retry=useCallback(async()=>{
    const id=++sequence.current;setState({kind:'loading'});
    try {const data=await load();if(id===sequence.current)setState({kind:'ready',data});}
    catch(error) {if(id!==sequence.current)return;if(error instanceof ApiFailure&&error.status===401 || error instanceof SessionFailure&&!error.canRetry){onExpired();return;}setState({kind:'error',message:error instanceof ApiFailure?error.message:'Unable to load this member resource. Please try again.'});}
  },[load,onExpired]);
  useEffect(()=>{void retry();return()=>{sequence.current++;};},[retry]);
  return {state,retry:()=>void retry()};
}
