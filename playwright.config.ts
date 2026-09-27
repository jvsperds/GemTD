import { defineConfig } from '@playwright/test';

// The perf budget runs after the other specs so they don't compete with it for CPU.
export default defineConfig({
  testDir: 'e2e',
  use: { browserName: 'chromium' },
  projects: [
    { name: 'e2e', testIgnore: /stress/ },
    { name: 'perf', testMatch: /stress/, dependencies: ['e2e'] },
  ],
});
