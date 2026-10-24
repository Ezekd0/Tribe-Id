import { availableFigmaAssets, figmaIcons } from '../assets/figma';
export function FigmaAsset({file,width,height,alt='',className=''}:{file:string;width:number;height:number;alt?:string;className?:string}) {
  if (!availableFigmaAssets.has(file)) return <span className={`asset-slot ${className}`} style={{width,height}} aria-hidden="true" data-pending-asset={file}/>;
  return <span className={`figma-asset ${className}`} style={{width,height}}><img src={`/assets/figma/${file}`} alt={alt}/></span>;
}
export function Icon({name,width=20,height=width}:{name:keyof typeof figmaIcons;width?:number;height?:number}) {
  return <FigmaAsset file={figmaIcons[name]} width={width} height={height}/>;
}
export function Avatar({url,name,size=84}:{url:string|null;name:string;size?:number}) {
  const [first='',second=''] = name.trim().split(/\s+/);
  return url && (!url.startsWith('/assets/figma/') || availableFigmaAssets.has(url.split('/').pop()!)) ? <img className="avatar" src={url} width={size} height={size} alt={`${name}'s profile`}/> : <span className="avatar avatar-fallback" style={{width:size,height:size}} aria-label={`${name}'s profile`}>{first.slice(0,1)}{second.slice(0,1)}</span>;
}
