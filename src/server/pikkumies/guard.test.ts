import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm, mkdir, chmod, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { AccountGuard, allowsPikkumiesMessage, loadGuardConfig, resolveStaticDir, validateRuntime } from './guard'

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
  test('real static requests cannot keep the server alive, but an authenticated WebSocket can', async () => {
    const staticDir = await mkdtemp(path.join(tmpdir(), 'board-static-')); dirs.push(staticDir)
    await writeFile(path.join(staticDir, 'index.html'), '<html>ok</html>')
    const listener = net.createServer()
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
    const port = (listener.address() as net.AddressInfo).port
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    const fixture = Bun.spawn(['bun', 'src/server/pikkumies/e2eServer.ts'], { env: {
      ...process.env, NODE_ENV: 'test', E2E_PORT: String(port), AGENTBOARD_E2E_STATIC_DIR: staticDir,
      AGENTBOARD_TEST_IDLE_MS: '350', AGENTBOARD_TEST_IDLE_CHECK_MS: '20',
    }, stdout: 'pipe', stderr: 'pipe' })
    void new Response(fixture.stdout).text()
    void new Response(fixture.stderr).text()
    const base = `http://127.0.0.1:${port}`
    const get = () => fetch(base).then((response) => response.status).catch(() => 0)
    try {
      for (let i = 0; i < 100 && await get() !== 200; i++) await Bun.sleep(20)
      expect(await get()).toBe(200)
      const auth = await fetch(`${base}/api/auth`, { method: 'POST', body: JSON.stringify({ token: 'f'.repeat(64) }) })
      expect(auth.status).toBe(200)
      const { bearer } = await auth.json() as { bearer: string }
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => { ws.send(JSON.stringify({ bearer })) }
        ws.onmessage = () => resolve()
        ws.onerror = () => reject(new Error('WebSocket authentication failed'))
      })
      for (let i = 0; i < 35; i++) {
        expect(await get()).toBe(200)
        await Bun.sleep(20)
      }
      ws.close()
      let exited = false
      for (let i = 0; i < 50; i++) {
        if (await get() === 0) { exited = true; break }
        await Bun.sleep(20)
      }
      expect(exited).toBe(true)
    } finally { fixture.kill(); await fixture.exited }
  }, 20_000)
  test('terminal frames cannot choose another tmux window', () => {
    const sessions = [{ id: 'one', name: 'pm1', tmuxWindow: 'pikkumies:0' }]
    expect(allowsPikkumiesMessage({ type: 'terminal-attach', sessionId: 'one' }, sessions)).toBe(true)
    expect(allowsPikkumiesMessage({ type: 'terminal-attach', sessionId: 'one', tmuxTarget: 'other:0' }, sessions)).toBe(false)
    expect(allowsPikkumiesMessage({ type: 'session-kill', sessionId: 'one' }, sessions)).toBe(false)
    expect(allowsPikkumiesMessage({ type: 'terminal-input', sessionId: 'other' }, sessions)).toBe(false)
    expect(allowsPikkumiesMessage({ type: 'terminal-input', sessionId: 'one' }, [{ ...sessions[0]!, tmuxWindow: 'other:0' }])).toBe(false)
  })
  test('compiled binaries load frontend files next to the executable', () => {
    expect(resolveStaticDir({}, '/opt/board/agentboard', true)).toBe('/opt/board/dist/client')
    expect(resolveStaticDir({ AGENTBOARD_STATIC_DIR: '/another/root' }, '/opt/board/agentboard', true)).toBe('/another/root')
  })
  test('requires private directories inside the account home', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'board-home-')); dirs.push(home)
    const ui = path.join(home, 'ui')
    const temporary = path.join(ui, 'tmp')
    const tokens = path.join(ui, 'tokens')
    const data = path.join(ui, 'data')
    const tmux = path.join(ui, 'tmux')
    await mkdir(temporary, { recursive: true, mode: 0o700 })
    await mkdir(tokens, { mode: 0o700 })
    await mkdir(data, { mode: 0o700 })
    await mkdir(tmux, { mode: 0o700 })
    const env = { HOME: home, TMPDIR: temporary, AGENTBOARD_TOKEN_DIR: tokens, AGENTBOARD_DATA_DIR: data, TMUX_TMPDIR: tmux }
    expect(() => validateRuntime(env, path.join(ui, 'ui.sock'))).not.toThrow()
    await chmod(temporary, 0o755)
    expect(() => validateRuntime(env, path.join(ui, 'ui.sock'))).toThrow()
  })

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
    const token = 'a'.repeat(64)
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

  test('concurrent exchanges cannot both claim one launch token', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'board-guard-')); dirs.push(dir)
    const guard = makeGuard(dir)
    const token = 'b'.repeat(64)
    await writeFile(path.join(dir, token), token, { mode: 0o600 })
    const exchange = () => guard.exchange(new Request('https://local.test/api/auth', {
      method: 'POST', body: JSON.stringify({ token }),
    }))
    const statuses = (await Promise.all([exchange(), exchange()])).map((response) => response.status).sort()
    expect(statuses).toEqual([200, 401])
  })

  test('rejects malformed names before filesystem access and rejects symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'board-guard-')); dirs.push(root)
    const dir = path.join(root, 'tokens')
    await mkdir(dir)
    const guard = makeGuard(dir)
    const exchange = (token: string) => guard.exchange(new Request('https://local.test/api/auth', {
      method: 'POST', body: JSON.stringify({ token }),
    }))
    const malformed = ['../outside', 'a/b', '', 'a'.repeat(65)]
    await mkdir(path.join(dir, 'a'))
    await mkdir(path.join(dir, '...'))
    await mkdir(path.join(dir, '.a'))
    const targets = malformed.map((token) => path.resolve(dir, token))
    for (const [index, target] of targets.entries()) {
      if (target === dir) await writeFile(path.join(dir, 'marker'), 'unchanged')
      else await writeFile(target, `unchanged-${index}`, { mode: 0o600 })
    }
    for (const token of ['z'.repeat(64), 'a'.repeat(63), 'A'.repeat(64), ...malformed]) {
      expect((await exchange(token)).status).toBe(401)
    }
    for (const [index, target] of targets.entries()) {
      if (target === dir) {
        expect((await stat(target)).isDirectory()).toBe(true)
        expect(await readFile(path.join(dir, 'marker'), 'utf8')).toBe('unchanged')
      } else expect(await readFile(target, 'utf8')).toBe(`unchanged-${index}`)
    }
    const token = 'c'.repeat(64)
    const outside = path.join(dir, 'outside')
    await writeFile(outside, token, { mode: 0o600 })
    await symlink(outside, path.join(dir, token))
    expect((await exchange(token)).status).toBe(401)
  })
})
