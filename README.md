# Pikkumies Agentboard

A public MIT fork of [Agentboard](https://github.com/gbasin/agentboard). **Upstream base v0.36.0 (2dc3fd8).** Agentboard's React terminal, tmux integration, and mobile terminal controls remain the foundation. See [LICENSE](LICENSE) for the upstream copyright notice.

This fork runs behind an account launcher and reverse proxy. It has two process modes: `AGENTBOARD_MODE=pikkumies` for the simplified Pikkumies tab and standard mode for the full Agentboard interface. Each account gets a separate process and Unix socket for each mode. The launcher and welcome bar are supplied by the host integration; they are not served by this repository.

## Launch contract

The process requires `AGENTBOARD_SOCKET` and refuses a TCP listener in production. The launch environment provides `AGENTBOARD_TOKEN_DIR`, `AGENTBOARD_LAUNCHER_URL`, `AGENTBOARD_ALLOWED_ORIGIN`, `AGENTBOARD_FRAME_ANCESTORS`, and a private `TMPDIR` inside the account home. Pikkumies mode also requires `TMUX_SESSION=pikkumies` and `TERMINAL_MODE=pty`. The account launcher starts it with a private socket and token directory, then opens the iframe with a one-use token in the URL fragment.

The UI strips the fragment, exchanges a 64-character lowercase hex token at `POST /api/auth`, and keeps the returned bearer only in memory. The bearer lasts until the process exits, subject to an eight-hour absolute cap. Every non-static HTTP request checks it. A WebSocket sends no server frames until its first client frame carries the bearer; subsequent frames are restricted to the reviewed message list. Unauthenticated sockets close after five seconds and are capped at 16. The guard applies to both modes. There are no auth cookies or `Set-Cookie` responses. Every HTTP response has a configured `frame-ancestors` policy and an `X-Frame-Options` fallback. Only authenticated WebSockets count as clients; the process exits after 30 minutes without clients.

The account's local state is under `~/.mcxPikkumies/pikkumies/local`. The simplified process uses `local/ui/ui.sock`, `local/ui/tokens/` and `local/ui/tmp/`; the launcher creates the directories with mode `0700` and token files with mode `0600`. The UI writes pasted images to its private temporary directory with mode `0600`.

Install the release's `dist/client` bundle beside the compiled binary. The binary serves that directory by default; `AGENTBOARD_STATIC_DIR` can override it. Release binaries use Bun's `bun-linux-x64-baseline` target so hosts without AVX2 can run them; CI does not currently emulate a non-AVX2 CPU.

## Changes from upstream

| Area | Fork behavior |
| --- | --- |
| Listener and auth | One Unix socket; token fragment exchange; in-memory bearer on API and WebSocket requests; no production TCP or Tailscale listener. The upstream TCP/Tailscale code remains behind the unreachable production branch to ease tag merges. |
| Simplified UI | One 44 px dark strip with pinned Primary, fixed Pikkumies 2–9 tabs, five-second Eternal state polling, direct New action, and a close confirmation. The account command owns the window removal. `?session=pmN` selects a tab. No full-interface button appears in this strip; the host panel owns that action. |
| Eternal and ask API | `GET/POST /api/eternals`, `POST /api/eternals/:id/quit`, and `POST /api/ask` run the account command with an explicit sanitized environment. Pending asks form a same-origin local storage queue of up to five items, deduplicated by nonce and retried on setup or busy responses while the tab is open. The welcome bar stores the ask and switches tabs; it is outside this repository. |
| Background work | Simplified mode does not start transcript polling, ownership matching, metadata scans, PR lookups, or persistence maintenance. Its file, media, directory, preview, PR, and client-log routes return 404. |
| Offline cache | The upstream service worker and PWA fallback are removed so a cached page cannot outlive an account launch or replace an unavailable launcher page. |
| Standard mode | Keeps the full Agentboard interface with the same guard and Unix socket. Automatic session resume defaults on. Account-controlled file responses are attachments with `nosniff` and CSP sandbox. Existing Hermes windows in the full interface are not auto-resumed. |
| Release | Upstream release-please, npm platform packages, npm publishing, and Homebrew publishing are removed. CI builds a Linux x64 binary and SHA-256 checksum as artifacts. Fork tag releases attach the binary, checksum, and frontend bundle to GitHub Releases; they do not publish npm packages. |

### Controls omitted from simplified mode

| Upstream control | Simplified mode |
| --- | --- |
| Sidebar, mobile drawer, session rail, resize handle | Replaced by the fixed Eternal strip |
| Host and project badges, filters, sort, drag reorder, context menu | Hidden |
| New-session modal, shell button, settings, directory browser | Hidden |
| History, recovery, hibernating sections, wake, move to history | Hidden |
| PR chips, media rail, preview | Hidden and their server routes are unmounted |
| Terminal, phone arrow and number controls, paste status | Kept |

## Development and checks

Requires Bun 1.x, tmux, and the project dependencies. Build with `bun run build`. A direct `bun run start` requires the launch environment above. Use a private tmux socket and data directory for local tests; never run an extra server against a live tmux session.

```bash
bun install
bun run lint
bun run typecheck
env -u TMUX bun run test:ci
env -u TMUX bun x playwright test --config src/server/pikkumies/playwright.config.ts
```

The Playwright test starts a private tmux server and a Unix-socket backend, forwards it to a local test port, and checks fragment stripping, denied routes, response headers, and the simplified strip. FAD parity fixtures are generated by `bun run scripts/regen-fad-fixtures.ts` and require Cargo; the shim is for development only.

The unit-test auth bypass requires `NODE_ENV=test`, `AGENTBOARD_TEST_TCP=1`, and `AGENTBOARD_TEST_AUTH_BYPASS=1` together. It is not enabled by a single environment flag.

## Upstream merge policy

Merge **upstream release tags only**, never upstream `master`. Run `src/server/pikkumies/invariants.test.ts` first after every merge. It inventories registered HTTP routes and WebSocket client message types; an unknown entry fails the check until its allow or deny disposition is reviewed. Review any upstream security fix, open a tracking issue after public disclosure, and merge the fixed release tag. Upstream's [security policy](https://github.com/gbasin/agentboard/blob/master/SECURITY.md) supports only its latest release. Conflicts in the deleted upstream publishing workflow and npm package files are expected.
