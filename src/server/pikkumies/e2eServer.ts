/** Isolated Unix-socket server with a TCP forwarder for browser tests. */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, copyFileSync, cpSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const root = mkdtempSync(path.join(tmpdir(), `board-e2e-${process.env.AGENTBOARD_E2E_ID ?? 'manual'}-`))
const home = path.join(root, 'home')
const ui = path.join(home, 'local', 'ui')
const tokenDir = path.join(ui, 'tokens')
const temporary = path.join(ui, 'tmp')
const socket = path.join(ui, 'ui.sock')
const tmuxDir = path.join(home, 'tmux')
const binDir = path.join(root, 'bin')
for (const dir of [home, ui, tokenDir, temporary, tmuxDir, binDir, path.join(home, 'data')]) mkdirSync(dir, { recursive: true, mode: 0o700 })
const token = 'e'.repeat(64)
writeFileSync(path.join(tokenDir, token), token, { mode: 0o600 })
writeFileSync(path.join(binDir, 'pikkumies'), '#!/bin/sh\nif [ "$1" = eternal ] && [ "$2" = list ]; then echo \'[{"id":"pm1","state":"running"}]\'; exit 0; fi\nexit 1\n', { mode: 0o700 })

const env: Record<string, string | undefined> = { ...process.env, HOME: home, TMPDIR: temporary, TMUX_TMPDIR: tmuxDir,
  TMUX_SESSION: 'pikkumies', TERMINAL_MODE: 'pty', AGENTBOARD_MODE: 'pikkumies',
  AGENTBOARD_SOCKET: socket, AGENTBOARD_TOKEN_DIR: tokenDir,
  AGENTBOARD_DATA_DIR: path.join(home, 'data'), AGENTBOARD_STATIC_DIR: 'dist/client',
  AGENTBOARD_ALLOWED_ORIGIN: 'https://panel.example.test',
  AGENTBOARD_FRAME_ANCESTORS: 'https://panel.example.test',
  AGENTBOARD_LAUNCHER_URL: 'https://panel.example.test/launch',
  PATH: `${binDir}:${process.env.PATH ?? ''}` }
delete env.TMUX
delete env.AGENTBOARD_TEST_TCP
delete env.AGENTBOARD_TEST_AUTH_BYPASS
const created = Bun.spawnSync(['tmux', 'new-session', '-d', '-s', 'pikkumies', '-n', 'pm1', 'sleep 3600'], { env: env, stdout: 'pipe', stderr: 'pipe' })
if (created.exitCode !== 0) throw new Error(created.stderr.toString())
let command = ['bun', 'src/server/index.ts']
if (process.env.AGENTBOARD_E2E_BINARY) {
  const releaseDir = path.join(root, 'release')
  mkdirSync(path.join(releaseDir, 'dist'), { recursive: true, mode: 0o700 })
  const binary = path.join(releaseDir, 'agentboard')
  copyFileSync(process.env.AGENTBOARD_E2E_BINARY, binary)
  chmodSync(binary, 0o700)
  cpSync('dist/client', path.join(releaseDir, 'dist', 'client'), { recursive: true })
  delete env.AGENTBOARD_STATIC_DIR
  command = [binary]
}
const server = Bun.spawn(command, { env, stdout: 'pipe', stderr: 'pipe' })
void new Response(server.stdout).text()
void new Response(server.stderr).text()
for (let i = 0; i < 100 && !existsSync(socket); i++) await Bun.sleep(100)
if (!existsSync(socket)) throw new Error('Account socket did not start')

const forwarder = net.createServer((client) => {
  const upstream = net.connect(socket)
  client.pipe(upstream).pipe(client)
  upstream.on('error', () => client.destroy())
  client.on('error', () => upstream.destroy())
})
forwarder.listen(Number(process.env.E2E_PORT) || 4176, '127.0.0.1', () => {
  process.stdout.write(`ready ${root}\n`)
})

function stop() {
  forwarder.close()
  server.kill()
  Bun.spawnSync(['tmux', 'kill-server'], { env: env, stdout: 'pipe', stderr: 'pipe' })
  rmSync(root, { recursive: true, force: true })
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
