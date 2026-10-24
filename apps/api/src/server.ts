import { buildApp } from './app.js';
import { readEnvironment } from './config/env.js';
const env = readEnvironment();
const app = await buildApp(env);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
try { await app.listen({ host: env.host, port: env.port }); }
catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
