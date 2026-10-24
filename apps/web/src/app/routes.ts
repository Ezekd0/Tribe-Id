export const routes=[{path:'/hub',label:'Home',icon:'home'},{path:'/id-card',label:'My ID Card',icon:'card'},{path:'/announcements',label:'Announcements',icon:'announcement'},{path:'/profile',label:'My Profile',icon:'profile'}] as const;
export type RoutePath=typeof routes[number]['path'];
export function currentRoute():RoutePath|null {
  const path=window.location.pathname==='/'?'/hub':window.location.pathname.replace(/\/$/,'');
  return routes.some(route=>route.path===path)?path as RoutePath:null;
}
