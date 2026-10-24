import { spawn } from 'node:child_process';

// Tests inherit only tooling/platform settings, never an operator's service credentials.
const platformKeys = new Set(['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','TMP','TEMP','LANG','LC_ALL','DISPLAY','XDG_RUNTIME_DIR','XDG_CACHE_HOME','SYSTEMROOT','COMSPEC','PATHEXT','APPDATA','LOCALAPPDATA','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','PLAYWRIGHT_BROWSERS_PATH','PLAYWRIGHT_CHANNEL','JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','EXPO_HOME']);
export function isolatedEnvironment(source = process.env) {
  const env = Object.fromEntries(Object.entries(source).filter(([key,value]) => platformKeys.has(key) && value !== undefined));
  return { ...env, CI:'true', NODE_ENV:'test', AUTH_ENABLED:'false', ENABLE_MEMBER_PREVIEW:'false', EXPO_NO_TELEMETRY:'1', EXPO_PUBLIC_API_URL:'https://api.example.invalid', EXPO_PUBLIC_APP_ENV:'testing' };
}
export const checkPlan = Object.freeze({
  check: ['npm', ['run','check']],
  same_origin: ['node', ['--import','tsx','scripts/verify-same-origin-admin.ts']],
  same_origin_browser: ['node', ['scripts/verify-same-origin-browser.mjs']],
  reproducible: ['node', ['scripts/verify-build-reproducibility.mjs']],
  database: ['npm', ['run','test:database-isolated']],
  runtime: ['node', ['scripts/verify-operational-runtime.mjs']],
  backup: ['node', ['scripts/verify-backup-restore.mjs']],
  mobile: ['npm', ['run','export','-w','@trueda-tribe-id/mobile','--','--output-dir','../../.cache/ci-mobile-export']],
  browser: ['npm', ['run','test:browser']],
});
export async function runChecks(names, execute, source = process.env) {
  for (const name of names) if (!Object.hasOwn(checkPlan,name)) throw new Error('Unknown CI check');
  for (const name of names) {
    const [command,args] = checkPlan[name];
    const env = isolatedEnvironment(source);
    if (name === 'mobile') env.NODE_ENV = 'production';
    const code = await execute(command,args,env);
    if (code !== 0) throw new Error(`CI ${name} failed (exit ${code})`);
  }
}
export function execute(command,args,env) {
  return new Promise((resolve,reject) => {
    const child = spawn(command,args,{env,stdio:'inherit'});
    child.once('error',reject);
    child.once('exit',(code,signal) => resolve(signal ? 1 : code ?? 1));
  });
}
