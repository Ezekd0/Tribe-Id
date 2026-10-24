import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { MemberView } from '@trueda-tribe-id/contracts';
import { ApiFailure, loadMember, logout, previewEnabled } from '../api/client';
import { currentRoute, routes, type RoutePath } from './routes';
import { AsyncState } from '../components/AsyncState';
import { Avatar, FigmaAsset, Icon } from '../components/FigmaAsset';
import { availableFigmaAssets } from '../assets/figma';
import { AdminWorkspace } from '../features/administration/AdminWorkspace';
import { SignIn } from '../features/authentication/SignIn';
import { Hub } from '../features/member/Hub';
import { IDCard } from '../features/member/IDCard';
import { Profile } from '../features/member/Profile';
import { Announcements } from '../features/member/Announcements';
type LoadState='loading'|'ready'|'error'|'session-required'|'empty'|'signed-out';
const headings:Record<RoutePath,{title:string;subtitle:string}>={
  '/hub':{title:'Tribe Hub',subtitle:''},
  '/id-card':{title:'My ID Card',subtitle:'Your digital identity in the Tribe.'},
  '/profile':{title:'My Profile',subtitle:'Welcome back'},
  '/announcements':{title:'Announcement',subtitle:'Stay updated with everything happening in the Tribe'}
};
export function MemberApp() {
  const [adminOpen,setAdminOpen]=useState(false);
  const [route,setRoute]=useState(currentRoute);
  const [view,setView]=useState<MemberView|null>(null);
  const [state,setState]=useState<LoadState>('loading');
  const [retry,setRetry]=useState(0);
  const [notice,setNotice]=useState('');
  const [loggingOut,setLoggingOut]=useState(false);
  const main=useRef<HTMLElement>(null);
  const drawer=useRef<HTMLDialogElement>(null);
  const menuButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const controller=new AbortController();
    setState('loading'); setView(null);
    loadMember(controller.signal).then(data=>{if(controller.signal.aborted)return;setView(data);setState(data?'ready':'empty');})
      .catch((error:unknown)=>{if(controller.signal.aborted)return;setState(error instanceof ApiFailure && error.status===401?'session-required':'error');});
    return ()=>controller.abort();
  },[retry]);
  useEffect(()=>{
    const onPop=()=>{setRoute(currentRoute());setNotice('');drawer.current?.close();};
    window.addEventListener('popstate',onPop);
    return ()=>window.removeEventListener('popstate',onPop);
  },[]);
  useEffect(()=>{document.title=`${route?headings[route].title:'Tribe Hub'} · Trueda Tribe ID`;},[route]);
  function navigate(event:MouseEvent<HTMLDivElement>) {
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const anchor=(event.target as HTMLElement).closest('a');
    if(!anchor||anchor.target||anchor.hasAttribute('download'))return;
    const url=new URL(anchor.href);
    if(url.origin!==location.origin||!routes.some(r=>r.path===url.pathname))return;
    event.preventDefault();
    const next=url.pathname as RoutePath;
    // Preserve the explicit preview scenario across navigation in development only.
    const query=previewEnabled?location.search:'';
    history.pushState(null,'',next+query);
    setAdminOpen(false);setRoute(next);setNotice('');drawer.current?.close();
    window.scrollTo({top:0,behavior:'instant'});
    requestAnimationFrame(()=>main.current?.focus({preventScroll:true}));
  }
  async function onLogout(){
    if(previewEnabled){setNotice('Development preview has no signed-in session.');drawer.current?.close();return;}
    if(loggingOut)return;
    setLoggingOut(true);
    try{await logout();setAdminOpen(false);setView(null);setState('signed-out');drawer.current?.close();}
    catch(error){if(error instanceof ApiFailure&&error.status===401){setView(null);setState('session-required');}else setNotice('Unable to log out. Please try again.');}
    finally{setLoggingOut(false);}
  }
  const onAdminExpired=useCallback(()=>{setAdminOpen(false);setView(null);setState('session-required');setNotice('Your session has ended. Sign in again.');},[]);
  const heading=route?headings[route]:headings['/hub'];
  return <div className="member-app" onClick={navigate}>
    <a className="skip-link" href="#member-content">Skip to content</a>
    {previewEnabled && <aside className="development-marker">Trueda Tribe ID · Development preview · Illustrative data</aside>}
    <div className={`member-canvas ${route==='/hub'?'hub-canvas':''}`}>
      <header className={`app-header ${route==='/profile'?'profile-header':''}`}>
        {route==='/hub'?<button ref={menuButton} className="icon-button menu-button" aria-label="Open Tribe navigation" aria-haspopup="dialog" onClick={()=>drawer.current?.showModal()}><Icon name="menu" width={24} height={13}/>{!availableFigmaAssets.has('0cc6c.svg')&&<span>Menu</span>}</button>:<div className="page-heading"><h1>{heading.title}</h1><p>{route==='/profile'&&view?`Welcome Back, ${view.identity.displayName}`:heading.subtitle}</p></div>}
        <div className="header-actions"><a className="icon-button" href="/announcements" aria-label="Announcements"><Icon name="bell" width={20} height={22}/>{!availableFigmaAssets.has('cee27.svg')&&<span className="text-icon-label">Updates</span>}</a><a className="avatar-link" href="/profile" aria-label="My Profile"><Avatar url={view?.identity.avatarUrl??null} name={view?.identity.displayName??'Tribe Member'} size={30}/></a></div>
      </header>
      <main id="member-content" ref={main} tabIndex={-1}>
        {adminOpen&&view?<AdminWorkspace tribeId={view.identity.tribeId} onSessionExpired={onAdminExpired} onClose={()=>setAdminOpen(false)}/>:!route?<AsyncState title="Page unavailable">Use the Tribe navigation to return to your member area.</AsyncState>:
          state==='loading'?<AsyncState title="Loading your Tribe…" busy/>:
          state==='error'?<AsyncState title="Unable to load your Tribe" retry={()=>setRetry(value=>value+1)}>Please try again.</AsyncState>:
          state==='session-required'?<SignIn onSignedIn={()=>setRetry(value=>value+1)}/>:
          state==='signed-out'?<><AsyncState title="You have been signed out"/><SignIn onSignedIn={()=>setRetry(value=>value+1)}/></>:
          state==='empty'?<AsyncState title="No active Tribe membership">Your Tribe member area will be available when your membership is active.</AsyncState>:
          view && (route==='/hub'?<Hub view={view} notify={setNotice}/>:route==='/id-card'?<IDCard view={view}/>:route==='/profile'?<Profile view={view} notify={setNotice} onLogout={()=>void onLogout()}/>:<Announcements announcements={view.announcements}/>)}
        {!previewEnabled&&state==='ready'&&!adminOpen&&<button className="admin-entry" onClick={()=>setAdminOpen(true)}>Open Tribe administration</button>}
        <p className={`action-notice ${notice?'is-visible':''}`} role="status" aria-live="polite">{notice}</p>
      </main>
      <nav className="bottom-navigation" aria-label="Tribe navigation">{routes.map(item=>{
        const selected=route===item.path;
        const icon=`${item.icon}${selected?'Active':item.icon==='home'?'':'Inactive'}` as 'homeActive'|'home'|'cardActive'|'cardInactive'|'announcementActive'|'announcementInactive'|'profileActive'|'profileInactive';
        return <a href={item.path} key={item.path} aria-current={selected?'page':undefined} aria-label={item.label}><Icon name={icon} width={31} height={item.icon==='card'?31:item.icon==='home'?33:35}/><span className={availableFigmaAssets.size?'sr-only':'nav-label'}>{item.label}</span></a>;
      })}</nav>
    </div>
    <dialog className="navigation-drawer" ref={drawer} aria-label="Tribe navigation" onClick={event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)event.currentTarget.close();}}} onClose={()=>menuButton.current?.focus()}>
      <button className="drawer-close text-button" onClick={()=>drawer.current?.close()}>Close</button>
      <div className="drawer-brand">{availableFigmaAssets.has('95b7d.png')?<FigmaAsset file="95b7d.png" width={60} height={52}/>:<span>Trueda<br/>Tribe ID</span>}</div>
      <nav aria-label="Tribe menu">{[routes[0],routes[3],routes[2],routes[1]].map(item=><a href={item.path} key={item.path} aria-current={route===item.path?'page':undefined}><Icon name={item.icon==='home'?'homeActive':item.icon} width={19} height={20}/><span>{item.label==='Announcements'?'Announcement':item.label}</span></a>)}</nav>
      <div className="drawer-footer"><div className="tribe-slogan"><FigmaAsset file="7055b.png" width={80} height={114} className="slogan-background"/><Icon name="group" width={23} height={17}/><p>We rise better, together.</p><strong>{view?.identity.tribeName??'Tribe'}</strong></div><button className="logout-button" disabled={loggingOut} onClick={()=>void onLogout()}><Icon name="logout" width={8} height={7}/>Log Out</button></div>
    </dialog>
  </div>;
}
