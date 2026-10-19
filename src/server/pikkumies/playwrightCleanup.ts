/** Clean up only the private tmux and filesystem for this Playwright run. */
import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export default async function cleanup() {
  const id = process.env.AGENTBOARD_E2E_ID
  if (!id || !/^[a-f0-9]{16}$/.test(id)) return
  for (const name of readdirSync(tmpdir()).filter((entry) => entry.startsWith(`board-e2e-${id}-`))) {
    const root = path.join(tmpdir(), name)
    const env: NodeJS.ProcessEnv = { ...process.env, TMUX_TMPDIR: path.join(root, 'home', 'tmux') }
    delete env.TMUX
    spawnSync('tmux', ['kill-server'], { env, stdio: 'ignore' })
    rmSync(root, { recursive: true, force: true })
  }
}
