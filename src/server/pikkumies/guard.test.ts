import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AccountGuard, loadGuardConfig } from './guard'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

function makeGuard(dir: string) {
  return new AccountGuard(loadGuardConfig({
    AGENTBOARD_TOKEN_DIR: dir,
    AGENTBOARD_ALLOWED_ORIGIN: 'https://panel.example.test',
    AGENTBOARD_FRAME_ANCESTORS: 'https://panel.example.test',
    AGENTBOARD_LAUNCHER_URL: 'https://panel.example.test/launch',
    AGENTBOARD_MODE: 'pikkumies',
  }), new Set(['/', '/assets/app-123.js']))
}

describe('account guard', () => {
  test('fails closed for missing configuration and unknown paths', async () => {
    expect(() => loadGuardConfig({})).toThrow()
    const dir = await mkdtemp(path.join(tmpdir(), 'board-guard-')); dirs.push(dir)
    const guard = makeGuard(dir)
    expect(guard.isStatic('GET', '/')).toBe(true)
    expect(guard.isStatic('GET', '/assets/app-123.js')).toBe(true)
    expect(guard.isStatic('POST', '/assets/app-123.js')).toBe(false)
    expect(guard.isStatic('GET', '/api/sessions')).toBe(false)
    expect(guard.isStatic('GET', '/bar')).toBe(false)
    expect(guard.isUnmounted('/api/session-media/id')).toBe(true)
    expect(guard.isUnmounted('/api/pr-checks')).toBe(true)
    expect(guard.authorize(new Request('https://local.test/api/sessions'))).toBe(false)
  })

  test('exchanges a token once and enforces response headers', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'board-guard-')); dirs.push(dir)
    const guard = makeGuard(dir)
    const token = 'a'.repeat(48)
    await writeFile(path.join(dir, token), token, { mode: 0o600 })
    const request = () => new Request('https://local.test/api/auth', { method: 'POST', body: JSON.stringify({ token }) })
    const accepted = await guard.exchange(request())
    expect(accepted.status).toBe(200)
    const { bearer } = await accepted.json() as { bearer: string }
    expect(guard.checkBearer(bearer)).toBe(true)
    expect((await guard.exchange(request())).status).toBe(401)
    const response = guard.headers(new Response('<html></html>', { headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'bad=1' } }), '/api/session-media/id')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('Content-Security-Policy')).toBe('frame-ancestors https://panel.example.test; sandbox')
    expect(response.headers.get('Content-Disposition')).toBe('attachment')
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
  })
})
