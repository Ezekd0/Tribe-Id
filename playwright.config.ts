import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',timeout:30000,fullyParallel:false,workers:1,
  outputDir:'.cache/browser-results',reporter:'list',
  use:{baseURL:'http://127.0.0.1:5173',headless:true,channel:process.env.PLAYWRIGHT_CHANNEL==='chromium'?undefined:(process.env.PLAYWRIGHT_CHANNEL??'chrome'),screenshot:'only-on-failure'},
  webServer:[
    {command:'ENABLE_MEMBER_PREVIEW=true HOST=127.0.0.1 node --import tsx apps/api/src/server.ts',url:'http://127.0.0.1:3001/api/v1/health',reuseExistingServer:!process.env.CI},
    {command:'VITE_MEMBER_PREVIEW=true npm run dev -w @trueda-tribe-id/web -- --port 5173 --strictPort',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},
    {command:'VITE_MEMBER_PREVIEW=false npm run dev -w @trueda-tribe-id/web -- --port 5174 --strictPort',url:'http://127.0.0.1:5174',reuseExistingServer:!process.env.CI}
  ]
});
