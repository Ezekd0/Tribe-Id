let open=0;
export function systemPickerOpen(){return open>0;}
export function retainPortraitDraft(){open++;let released=false;return()=>{if(!released){released=true;open--;}};}
export async function withSystemPicker<T>(operation:()=>Promise<T>){open++;try{return await operation();}finally{open--;}}
