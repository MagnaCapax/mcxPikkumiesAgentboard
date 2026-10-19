/** Route and WS inventories fail when an upstream merge adds an unreviewed surface. */
import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PIKKUMIES_WS_TYPES } from './guard'

const root = path.resolve(import.meta.dir, '..', '..', '..')
const files = [
  'src/server/index.ts',
  'src/server/persistence/routes.ts',
  'src/server/routes/pasteFile.ts',
  'src/server/pikkumies/routes.ts',
]
const expectedRoutes: Record<string, string[]> = {
  'src/server/index.ts': [
    "GET '/api/clipboard-file-path'", "GET '/api/directories'", "GET '/api/health'",
    "GET '/api/pr-checks'", "GET '/api/server-info'", "GET '/api/session-media/:sessionId'",
    "GET '/api/session-preview/:sessionId'", "GET '/api/sessions'",
    "GET '/api/settings/history-max-age-hours'", "GET '/api/settings/inactive-max-age-hours'",
    "GET '/api/settings/prefer-window-name'", "GET '/api/settings/synced'",
    "GET '/api/settings/terminal-colors'", "GET '/api/settings/tmux-mouse-mode'",
    "POST '/api/client-log'", "POST '/api/paste-image'", "POST '/api/pr-info'",
    "PUT '/api/settings/history-max-age-hours'", "PUT '/api/settings/inactive-max-age-hours'",
    "PUT '/api/settings/prefer-window-name'", "PUT '/api/settings/synced'",
    "PUT '/api/settings/terminal-colors'", "PUT '/api/settings/tmux-mouse-mode'",
  ],
  'src/server/persistence/routes.ts': [
    'GET `${api}/:id`', 'GET `${api}/health`', 'GET api',
    'PATCH `${api}/:id`', 'POST `${api}/:id/resume`', 'PUT `${api}/settings`',
  ],
  'src/server/routes/pasteFile.ts': ["POST '/'"],
  'src/server/pikkumies/routes.ts': [
    "GET '/eternals'", "POST '/ask'", "POST '/eternals'", "POST '/eternals/:id/quit'",
  ],
}

test('every registered HTTP route has an explicit reviewed disposition', async () => {
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8')
    const actual = [...source.matchAll(/\bapp\.(get|post|put|patch|delete)\(([^,\n]+)/g)]
      .map((match) => `${match[1]!.toUpperCase()} ${match[2]!.trim()}`).sort()
    expect(actual).toEqual([...expectedRoutes[file]!].sort())
  }
  const index = await readFile(path.join(root, files[0]!), 'utf8')
  expect([...index.matchAll(/\bapp\.route\(([^,]+),/g)].map((match) => match[1]!.trim()).sort())
    .toEqual(["'/api'", "'/api/paste-file'"].sort())
  expect(index).toContain("if (accountGuard.isUnmounted(url.pathname))")
  expect(index).toContain("if (!testAuthBypass && !accountGuard.isStatic(req.method, url.pathname) && !accountGuard.authorize(req))")
})

test('every client message has a reviewed allow or deny disposition', async () => {
  const source = await readFile(path.join(root, 'src/shared/types.ts'), 'utf8')
  const union = source.split('export type ClientMessage =')[1]!.split('export type SendClientMessage')[0]!
  const actual = new Set([...union.matchAll(/type: '([^']+)'/g)].map((match) => match[1]!))
  const denied = new Set(['session-create', 'session-kill', 'session-rename', 'session-wake', 'session-hibernate', 'session-move-to-history'])
  expect([...actual].sort()).toEqual([...new Set([...PIKKUMIES_WS_TYPES, ...denied])].sort())
})

test('production starts on one Unix listener with guarded WS sends', async () => {
  const index = await readFile(path.join(root, 'src/server/index.ts'), 'utf8')
  expect(index).toContain("if (!accountSocket && !testTcp) throw new Error")
  expect(index).toContain('...(accountSocket ? { unix: accountSocket }')
  expect(index).toContain('if (accountSocket) return')
  expect(index).toContain('if (testAuthBypass || socket.data.authenticated) socket.send(payload)')
  expect(index).toContain('if (testAuthBypass || ws.data.authenticated) ws.send(JSON.stringify(message))')
  expect(index).toContain('if (!pikkumiesMode && config.logPollIntervalMs > 0)')
})
