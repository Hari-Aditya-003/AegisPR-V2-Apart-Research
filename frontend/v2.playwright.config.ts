import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './v2-e2e', workers: 1, retries: 0, reporter: 'line', timeout: 90000,
  outputDir: 'test-results/v2',
  use: { baseURL: process.env.AEGISPR_V2_URL ?? 'http://localhost:3200', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
