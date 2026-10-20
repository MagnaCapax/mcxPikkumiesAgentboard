/** Restricted Eternal and ask endpoints for the simplified interface. */
import { Hono } from 'hono'
import { timedSpawnAsync } from '../syncSpawnTiming'
import { sanitizedTmuxEnv } from '../tmuxEnv'

const ETERNAL_ID = /^pm[1-9]$/
const STATES = new Set(['running', 'starting', 'waiting-for-setup', 'not-ready', 'quit'])
const acceptedNonces = new Map<string, number>()
const pendingNonces = new Map<string, Promise<number>>()

export async function enforceWindowSizeLatest(): Promise<void> {
  const windows = await timedSpawnAsync(['tmux', 'list-windows', '-t', '=pikkumies', '-F', '#{window_id}'], { timeout: 5000 })
  if (windows.exitCode !== 0) return
  for (const id of windows.stdout.trim().split('\n')) {
    if (/^@\d+$/.test(id)) await timedSpawnAsync(['tmux', 'set-window-option', '-t', id, 'window-size', 'latest'], { timeout: 5000 })
  }
}

async function run(args: string[], stdin?: string) {
  const proc = Bun.spawn(['pikkumies', ...args], {
    stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
    stdout: 'pipe', stderr: 'pipe', env: sanitizedTmuxEnv(), timeout: 15_000,
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code: proc.exitCode, stdout, stderr }
}

export function pikkumiesRoutes() {
  const app = new Hono()
  app.get('/eternals', async (c) => {
    try {
      const result = await run(['eternal', 'list', '--json'])
      if (result.code !== 0) return c.json({ error: 'unavailable' }, 424)
      const rows: unknown = JSON.parse(result.stdout)
      if (!Array.isArray(rows) || !rows.every((row) => row && typeof row === 'object' &&
        ETERNAL_ID.test(row.id) && STATES.has(row.state))) return c.json({ error: 'invalid state' }, 500)
      return c.json(rows)
    } catch { return c.json({ error: 'unavailable' }, 424) }
  })
  app.post('/eternals', async (c) => {
    try {
      const result = await run(['eternal', 'new'])
      if (result.code !== 0) return c.json({ error: result.code === 75 ? 'memory' : 'unavailable' }, 409)
      await enforceWindowSizeLatest()
      const match = /\bpm[2-9]\b/.exec(result.stdout)
      return c.json({ id: match?.[0] ?? null })
    } catch { return c.json({ error: 'unavailable' }, 424) }
  })
  app.post('/eternals/:id/quit', async (c) => {
    const id = c.req.param('id')
    if (!ETERNAL_ID.test(id) || id === 'pm1') return c.json({ error: 'invalid id' }, 400)
    try {
      const result = await run(['eternal', 'quit', '--', id])
      if (result.code !== 0) return c.json({ error: 'unavailable' }, 409)
      return c.json({ ok: true })
    } catch { return c.json({ error: 'unavailable' }, 424) }
  })
  app.post('/ask', async (c) => {
    let body: { text?: unknown; nonce?: unknown }
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid' }, 400) }
    if (typeof body.text !== 'string' || body.text.length === 0 || body.text.length > 4000 ||
      typeof body.nonce !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.nonce)) {
      return c.json({ error: 'invalid' }, 400)
    }
    const now = Date.now()
    for (const [nonce, ts] of acceptedNonces) if (now - ts > 60 * 60_000) acceptedNonces.delete(nonce)
    if (acceptedNonces.has(body.nonce)) return c.json({ accepted: true, code: 0 })
    try {
      let pending = pendingNonces.get(body.nonce)
      if (!pending) {
        pending = run(['ask'], body.text).then((result) => result.code ?? 1)
        pendingNonces.set(body.nonce, pending)
      }
      const code = await pending
      pendingNonces.delete(body.nonce)
      if (code === 0) acceptedNonces.set(body.nonce, now)
      return c.json({ accepted: code === 0, code })
    } catch { pendingNonces.delete(body.nonce); return c.json({ accepted: false, code: 1 }) }
  })
  return app
}
