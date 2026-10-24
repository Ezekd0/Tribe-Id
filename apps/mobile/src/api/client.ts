import { timedFetch } from './transport';
export interface SessionAccess { token(): string | null; refresh(): Promise<string | null>; clear(): Promise<void> }
export class ApiFailure extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}
export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly session: SessionAccess, private readonly transport: typeof fetch = (input,init)=>fetch(input,init)) { const request = timedFetch(transport); this.transport = async (input, init) => { try { return await request(input, init); } catch { throw new ApiFailure(0, 'The response could not be confirmed. Check your connection and try again.'); } }; }
  get<T>(path: string, query?:Record<string,string|number|undefined>) { return this.request<T>(path, 'GET', undefined, query); }
  write<T>(path:string,method:'POST'|'PATCH'|'DELETE'|'PUT',body?:object){return this.request<T>(path,method,body);}
  post<T>(path: string, body?: Record<string,string>) { return this.request<T>(path, 'POST', body); }
  patch<T>(path: string, body: Record<string,string|null>) { return this.request<T>(path, 'PATCH', body); }
  delete<T>(path: string) { return this.request<T>(path, 'DELETE'); }
  async logout() { await this.request<void>('/api/v1/auth/logout', 'POST'); await this.session.clear(); }
  private async request<T>(path: string, method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT', body?: object, query?:Record<string,string|number|undefined>): Promise<T> {
    if (!/^\/api\/v1\/[A-Za-z0-9/-]+$/.test(path)) throw new Error('Invalid API path');
    const search=new URLSearchParams();for(const [key,value] of Object.entries(query??{})){if(!/^[A-Za-z][A-Za-z0-9]*$/.test(key)||typeof value==='number'&&!Number.isFinite(value))throw new Error('Invalid API query');if(value!==undefined)search.set(key,String(value));}
    const target=this.baseUrl.replace(/\/$/, '')+path+(search.size?'?'+search.toString():'');
    const token = this.session.token() ?? await this.session.refresh();
    if (!token) throw new ApiFailure(401, 'Your session has ended.');
    let response = await this.transport(target, { method, headers: { Authorization: `Bearer ${token}`, ...(body?{'Content-Type':'application/json'}:{}) }, ...(body?{body:JSON.stringify(body)}:{}) });
    if (response.status === 401) {
      const replacement = await this.session.refresh();
      if (replacement) response = await this.transport(target, { method, headers: { Authorization: `Bearer ${replacement}`, ...(body?{'Content-Type':'application/json'}:{}) }, ...(body?{body:JSON.stringify(body)}:{}) });
    }
    if (response.status === 401) { await this.session.clear(); throw new ApiFailure(401, 'Your session has ended.'); }
    if (!response.ok) {
      let code:string|undefined;try{const failure=await response.json() as {error?:{code?:unknown}};if(typeof failure.error?.code==='string')code=failure.error.code;}catch{}
      throw new ApiFailure(response.status, response.status === 404 ? 'This member resource is no longer available.' : 'Unable to contact the Tribe service. Please try again.',code);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
}
