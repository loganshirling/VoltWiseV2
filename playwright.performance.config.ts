import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

const chromiumProject = baseConfig.projects?.find((project) => project.name === 'chromium');
if (!chromiumProject) throw new Error('The shared Playwright configuration must define a Chromium project.');

export default defineConfig({
  ...baseConfig,
  testMatch: '**/*.perf.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 480_000,
  expect: { ...baseConfig.expect, timeout: 15_000 },
  projects: [chromiumProject],
});
