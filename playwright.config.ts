import { defineConfig } from '@playwright/test';

const smoke = /offline|loop|scores/;
// Smoke across Chromium / Firefox / Edge; perf budgets run last, alone, so nothing competes for CPU.
export default defineConfig({
  testDir: 'e2e',
  expect: { timeout: 15_000 }, // Firefox boots from file:// slowly under parallel load
  projects: [
    { name: 'chromium', testMatch: smoke, use: { browserName: 'chromium' } },
    { name: 'firefox', testMatch: smoke, use: { browserName: 'firefox' } },
    { name: 'edge', testMatch: smoke, use: { browserName: 'chromium', channel: 'msedge' } },
    {
      name: 'perf',
      testMatch: /stress/,
      use: { browserName: 'chromium' },
      dependencies: ['chromium', 'firefox', 'edge'],
    },
  ],
});
