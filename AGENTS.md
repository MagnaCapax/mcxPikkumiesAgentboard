# AGENTS.md

- Bun 1.x, TypeScript 5.x, React 18, Hono, xterm.js, Zustand, Tailwind.

## Commands

```
bun run dev        # frontend + backend
bun run build      # production build
bun run lint       # oxlint
bun run typecheck  # tsc --noEmit
bun run test       # unit tests
```

Run `bun run lint && bun run typecheck && bun run test` after changes.

## FAD Parity Fixtures

FAD = [`franken_agent_detection`](https://github.com/Dicklesworthstone/franken_agent_detection)
(published as the `franken-agent-detection` crate) — the connector/parsing
library underneath [CASS](https://github.com/Dicklesworthstone/coding_agent_session_search).
It normalizes ~26 coding-agent transcript formats into `NormalizedConversation`s.

`src/server/__tests__/fadParity.test.ts` asserts our log extraction agrees with
FAD on a shared fixture tree at `tests/fixtures/fad/home/`. Expected outputs in
`tests/fixtures/fad/expected/` are generated, not hand-written — regenerate
with `bun run scripts/regen-fad-fixtures.ts` (requires cargo; builds the
dev-only `tools/fad-dump` shim). The shim is never a runtime dependency.

## How It Works

- Single tmux session (default: `agentboard`) with one window per project
- Backend discovers windows, streams terminal output via WebSocket
- Parses Claude/Codex/Pi JSONL logs from `~/.claude/projects/`, `~/.codex/sessions/`, `~/.pi/agent/sessions/`
- Devin CLI stores history in SQLite (`~/.local/share/devin/cli/sessions.db`); `src/server/devinSync.ts` mirrors it into `~/.agentboard/devin-sessions/*.jsonl` so the same pipeline applies. `src/server/devinLockMatch.ts` matches devin sessions to windows via `session_locks/<id>.lock` PIDs.
- Grok CLI writes transcripts at `~/.grok/sessions/<encoded-cwd>/<session-id>/chat_history.jsonl`; sessionId and projectPath are derived from the directory names. Sibling telemetry files (events.jsonl, updates.jsonl) are excluded from matching.
- Status: unknown -> working -> waiting (derived from log events)

## Structure

- src/server/     Hono backend, WebSocket, tmux/pty management, log parsing
  - `src/server/SessionManager.ts` - tmux window discovery, log parsing, status detection
  - `src/server/index.ts` - Hono routes, WebSocket handling
- src/client/     React frontend, xterm.js terminal, Zustand stores
  - `src/client/App.tsx` - main UI, keyboard shortcuts
  - `src/client/components/Terminal.tsx` - xterm.js wrapper
- src/shared/     Shared types

- Data directory: `~/.agentboard/` contains `agentboard.db` (session data) and `agentboard.log`

## tmux Safety

- Agent sessions often run *inside* the `agentboard` tmux session. Any `tmux`
  command in such a shell inherits `TMUX`, which overrides `TMUX_TMPDIR` and
  targets the real server — `kill-server`/`kill-session` will destroy live
  windows. Always run probes with `env -u TMUX tmux -L <socket-name>` against a
  dedicated socket, and never `kill-server` without explicit confirmation.
- The same applies to running a second **server** (dev, verify, manual e2e).
  Started from an agentboard pane, it inherits `TMUX`, joins the live tmux
  server, and groups its sessions with the live `agentboard` session — the
  live board then shows duplicate windows, and killing one kills the real
  window. The server now refuses to start from an agentboard-managed pane. Give it a private
  socket and data dir instead:

  ```
  TMUX_TMPDIR=/tmp/ab-dev-$$ AGENTBOARD_DATA_DIR=/tmp/ab-dev-$$/data \
    PORT=4141 TMUX_SESSION=ab-dev bun run dev
  ```

  `bun run test:e2e` already isolates itself. Stop what you started
  (`env -u TMUX TMUX_TMPDIR=/tmp/ab-dev-$$ tmux kill-server`) and remove the
  temp dir when done.
- Every subprocess the server spawns must pass an explicit `env` —
  `Bun.spawn*`/`spawnSync` without `env` reuse the *process-start* environ,
  so they ignore `delete process.env.TMUX` from isolation setup (and Bun
  Workers never see post-start env mutations at all). Use
  `sanitizedTmuxEnv()` (from `tmuxEnv.ts`, already the default inside
  `timedSpawnSync`/`timedSpawnAsync`) so spawned clients honor the
  `TMUX_TMPDIR` isolation instead of landing on the live tmux server.

## Git

- Check `git status`/`git diff` before commits
- Atomic commits; push only when asked
- Never destructive ops (`reset --hard`, `force push`) without explicit consent
- Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`
- Commit early and often — make small, incremental commits as you work rather than one large commit at the end.

## Releases

- Merge upstream release tags only, never upstream `master`. Run the fork invariants test before resolving merge conflicts.
- The fork does not publish npm or Homebrew packages. CI builds a Linux x64 binary and SHA-256 artifact. Releases attach these files to GitHub Releases.
- The deleted upstream publishing workflow and platform package files are expected merge conflicts.

## Critical Thinking

- Read more code when stuck
- Document unexpected behavior
- Call out conflicts between instructions

## Engineering

- Small files (<500 LOC), descriptive paths, current header comments
- Fix root causes, not symptoms
- Simplicity > cleverness (even if it means bigger refactors)
- Aim for 100% test coverage

## UI Testing

- Use the `dev-browser` skill for testing web UI changes. Headless browser
automation with Playwright. Start server, take screenshots, verify DOM state.
- For changes that impact UI, keep a Playwright screenshot or short clip as visual evidence. This fork commits directly to `master` without PRs.
