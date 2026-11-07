import { defineConfig } from '@playwright/test';

const windows = process.platform === 'win32';
const python = windows ? '..\\.venv\\Scripts\\python.exe' : '../.venv/bin/python';
const chromiumPath = process.env.CHROMIUM_PATH || (windows ? undefined : '/usr/bin/chromium');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 40000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    channel: chromiumPath ? undefined : 'chrome',
    launchOptions: { executablePath: chromiumPath, args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port 8000`, cwd: '../backend', url: 'http://127.0.0.1:8000/api/v1/health', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev -- --host 127.0.0.1 --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  ],
});
