import type { ReactNode } from 'react';
export function AsyncState({title,children,retry,busy=false}:{title:string;children?:ReactNode;retry?:()=>void;busy?:boolean}) {
  return <section className="async-state" role={retry?'alert':'status'} aria-busy={busy}><h2>{title}</h2>{children && <p>{children}</p>}{retry && <button className="button" onClick={retry}>Try again</button>}</section>;
}
export function EmptyState({children}:{children:ReactNode}) { return <p className="empty-state">{children}</p>; }
