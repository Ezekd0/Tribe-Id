import {lstat, readdir, readFile, realpath} from 'node:fs/promises';
import {isAbsolute, join, resolve, sep, extname} from 'node:path';
import type {FastifyInstance} from 'fastify';

const types:Record<string,string>={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff':'font/woff','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp'};
// Load only the immutable build output at startup. Never derive filesystem paths
// from request URLs, follow symlinks, expose source maps, or use SPA fallbacks.
export async function registerAdminStatic(app:FastifyInstance, directory:string):Promise<void>{
  const root=resolve(directory);
  if(!isAbsolute(directory)||!root.endsWith(`${sep}apps${sep}web${sep}dist`)||await realpath(root)!==root)throw new Error('ADMIN_WEB_DIST must be the real absolute packaged apps/web/dist directory');
  const entries:{url:string;body:Buffer;type:string;cache:string}[]=[];
  let bytes=0;
  async function add(path:string,url:string,type:string,cache:string){
    const stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw new Error('Invalid admin build asset');
    const body=await readFile(path);bytes+=body.length;
    if(bytes>32*1024*1024||entries.length>=512)throw new Error('Admin build exceeds bounded asset manifest');
    entries.push({url,body,type,cache});
  }
  await add(join(root,'index.html'),'/', 'text/html; charset=utf-8','no-store');
  async function assets(path:string,prefix:string){
    const stat=await lstat(path);
    if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Invalid admin assets directory');
    for(const item of await readdir(path,{withFileTypes:true})){
      if(!/^[A-Za-z0-9_.-]+$/.test(item.name)||item.name.startsWith('.'))throw new Error('Invalid admin asset name');
      if(item.isDirectory())await assets(join(path,item.name),`${prefix}/${item.name}`);
      else {
        const type=types[extname(item.name)];
        if(!type||!item.isFile())throw new Error('Unexpected file in admin build assets');
        await add(join(path,item.name),`${prefix}/${item.name}`,type,/[.-][A-Za-z0-9_-]{8,}\./.test(item.name)?'public, max-age=31536000, immutable':'no-cache');
      }
    }
  }
  await assets(join(root,'assets'),'/assets');
  // These are the web client's existing history routes, not an arbitrary SPA
  // fallback. Refreshing a supported screen must still reach the sign-in boundary.
  const screens=['/','/hub','/id-card','/announcements','/profile'];
  for(const entry of entries){
    const paths=entry.url==='/'?screens.flatMap(path=>path==='/'?[path]:[path,path+'/']):[entry.url];
    for(const path of paths)app.get(path,async(_request,reply)=>reply.type(entry.type).header('Cache-Control',entry.cache).send(entry.body));
  }
}
