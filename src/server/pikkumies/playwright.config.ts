import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const port = Number(process.env.E2E_PORT) || 4176
const runId = randomBytes(8).toString('hex')
process.env.AGENTBOARD_E2E_ID = runId
export default defineConfig({
  testDir: '.',
  testMatch: '*.playwright.ts',
  globalTeardown: './playwrightCleanup.ts',
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium' },
  webServer: {
    command: 'bun src/server/pikkumies/e2eServer.ts',
    cwd: path.resolve(import.meta.dirname, '../../..'),
    env: { AGENTBOARD_E2E_ID: runId },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
