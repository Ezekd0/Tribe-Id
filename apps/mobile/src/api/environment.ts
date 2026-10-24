export type MobileEnvironment = 'development' | 'testing' | 'production';
/** Public build configuration only. Never infer or default a production server. */
export function mobileEnvironment(baseUrl: string | undefined, environment: string | undefined, development: boolean) {
  const mode = environment ?? (development ? 'development' : 'production');
  if (!['development', 'testing', 'production'].includes(mode)) throw new Error('Invalid EXPO_PUBLIC_APP_ENV.');
  if (!baseUrl) throw new Error('Configure EXPO_PUBLIC_API_URL to connect to the Tribe API.');
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('Invalid API base URL.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['https:', 'http:'].includes(url.protocol)) throw new Error('API URL must be an HTTP(S) origin without credentials.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '0.0.0.0' || /^127\./.test(host)) throw new Error('A physical phone needs the PC LAN address, not loopback.');
  if (url.protocol !== 'https:' && (!development || mode !== 'development')) throw new Error('Testing and production builds require HTTPS. LAN HTTP is for development only.');
  return { mode: mode as MobileEnvironment, baseUrl: url.origin, storageKey: `trueda-tribe-id.refresh.${mode}.${Array.from(url.origin, char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')}` };
}
