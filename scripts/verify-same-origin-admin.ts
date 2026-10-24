// Run after the normal web build; synthetic session repository, no database or cloud.
import {resolve} from 'node:path';
import {verifySameOriginBuild} from '../apps/api/src/modules/admin-static.test.js';
await verifySameOriginBuild(resolve('apps/web/dist'));
console.log('Built admin HTML/assets, CSP, same-origin bearer and API/file-probing checks passed.');
