# Agentboard fork guide

This public MIT fork runs one account-local interface per Unix socket. `AGENTBOARD_MODE=pikkumies` shows the simple Pikkumies tab strip; standard mode keeps the full interface. Both modes require a launch token and an authenticated API and WebSocket connection. The account launcher supplies a per-UI private directory `L/ui/<ui>/` with socket, token directory, and temporary directory, plus origin settings, data directory, and `TMUX_TMPDIR=<state>/tmux`. App responses carry `X-Pikkumies-App: 1`; only authenticated WebSockets reset the idle timer.

The simple UI uses the upstream shortcut modifier, shows command failures inline, and holds an ask for manual Send after three exit-code-5 retries. Its tmux-buffer clipboard relay always offers click-to-copy.

## Stack and checks

Bun 1.x, TypeScript 5.x, React 18, Hono, xterm.js, Zustand, and Tailwind.

```bash
bun run build
bun run lint
bun run typecheck
env -u TMUX bun run test:ci
env -u TMUX bun x playwright test --config src/server/pikkumies/playwright.config.ts
```

Run lint, typecheck, and tests after changes. Keep a Playwright screenshot for UI changes. If the optional browser skill is installed, use it for UI checks.

## Code map

- `src/server/index.ts`: guarded HTTP and WebSocket server.
- `src/server/pikkumies/`: launch guard, restricted routes, invariants, and browser fixtures.
- `src/server/SessionManager.ts`: tmux window discovery and sessions.
- `src/client/pikkumies/`: simple account interface and token bootstrap.
- `src/client/components/Terminal.tsx`: xterm interface.
- `src/shared/`: shared messages and types.

FAD parity fixtures live under `tests/fixtures/fad/`. Regenerate them with `bun run scripts/regen-fad-fixtures.ts` when parser behavior changes; this needs Cargo and the development-only shim.

## tmux and server safety

Never run a probe against an inherited `TMUX` connection. Use `env -u TMUX tmux -L <private-socket>`. A second server needs its own `TMUX_TMPDIR`, `AGENTBOARD_DATA_DIR`, port, and session name. Every spawned tmux client needs `sanitizedTmuxEnv()`; Bun subprocesses can retain the process-start environment. Never kill a live tmux server.

## Git and releases

Check status and diff before committing. Make small conventional commits on `master`; push only when asked. Never amend, rebase, reset, or force push this fork. Merge upstream release tags only, never upstream `master`. Run the fork invariants test before resolving merge conflicts, and review all new routes and WebSocket messages. The fork ships a baseline Linux x64 binary and frontend assets; it does not publish npm or Homebrew packages.

Keep files small, fix root causes, and add meaningful tests for behavior and regressions. Keep public files free of private account data.
