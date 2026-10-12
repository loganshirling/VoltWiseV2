import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const systemChromium = process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
const systemFirefox = process.env.FIREFOX_EXECUTABLE;
const chromiumLaunchOptions = existsSync(systemChromium)
  ? { executablePath: systemChromium, args: ['--no-sandbox'] }
  : {};

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunchOptions },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        ...(systemFirefox ? { launchOptions: { executablePath: systemFirefox } } : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --strictPort --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
