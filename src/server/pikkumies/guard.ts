/** Account-local launch token exchange and default-deny request guard. */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { realpathSync, statSync, readdirSync } from 'node:fs'
import { open, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

const MAX_BEARER_AGE_MS = 8 * 60 * 60 * 1000
const MAX_LAUNCH_AGE_MS = 60_000
const STATIC_EXTENSION = /\.(?:html|js|css|svg|png|ico|woff2|webmanifest)$/
const FILE_PATH = /^\/api\/(?:session-media\/|session-preview\/|directories(?:\/|$)|paste-file(?:\/|$)|clipboard-file-path$|client-log$|pr-info$|pr-checks$)/
export const PIKKUMIES_WS_TYPES = new Set([
  'ping', 'session-refresh', 'terminal-attach', 'terminal-detach', 'terminal-input',
  'terminal-paste', 'terminal-resize', 'tmux-cancel-copy-mode', 'tmux-check-copy-mode',
])

export interface GuardConfig {
  tokenDir: string
  allowedOrigin: string
  frameAncestor: string
  launcherUrl: string
  staticDir: string
  mode: 'pikkumies' | 'standard'
}

export function loadGuardConfig(env: NodeJS.ProcessEnv = process.env): GuardConfig {
  const tokenDir = env.AGENTBOARD_TOKEN_DIR
  const allowedOrigin = env.AGENTBOARD_ALLOWED_ORIGIN
  const frameAncestor = env.AGENTBOARD_FRAME_ANCESTORS
  const launcherUrl = env.AGENTBOARD_LAUNCHER_URL
  if (!tokenDir || !allowedOrigin || !frameAncestor || !launcherUrl) {
    throw new Error('Missing account launch configuration')
  }
  const origin = new URL(allowedOrigin)
  const ancestor = new URL(frameAncestor)
  const launcher = new URL(launcherUrl)
  if (origin.origin !== allowedOrigin || ancestor.origin !== frameAncestor ||
      origin.protocol !== 'https:' || ancestor.protocol !== 'https:' || launcher.protocol !== 'https:') {
    throw new Error('Invalid account launch origins')
  }
  return { tokenDir, allowedOrigin, frameAncestor, launcherUrl,
    staticDir: env.AGENTBOARD_STATIC_DIR || './dist/client',
    mode: env.AGENTBOARD_MODE === 'pikkumies' ? 'pikkumies' : 'standard' }
}

function staticPaths(root: string): Set<string> {
  const paths = new Set<string>()
  function visit(directory: string, prefix: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relative)
      else if (entry.isFile() && STATIC_EXTENSION.test(entry.name)) paths.add(relative)
    }
  }
  try { visit(root, '') } catch { /* missing build keeps static access closed */ }
  if (paths.has('/index.html')) paths.add('/')
  return paths
}

export function validateRuntime(env: NodeJS.ProcessEnv, socket: string): void {
  if (!path.isAbsolute(socket)) throw new Error('Account socket must be an absolute path')
  const home = env.HOME
  const temporary = env.TMPDIR
  if (!home || !temporary) throw new Error('A private account temporary directory is required')
  const resolvedHome = realpathSync(home)
  const resolvedTemporary = realpathSync(temporary)
  const info = statSync(resolvedTemporary)
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 ||
      !resolvedTemporary.startsWith(resolvedHome + path.sep)) {
    throw new Error('Account temporary directory must be private and inside the home')
  }
}

export class AccountGuard {
  private bearer: string | null = null
  private issuedAt = 0
  private lastClientAt = Date.now()
  private openClients = 0

  private readonly staticAllow: Set<string>
  constructor(readonly config: GuardConfig, allowedStaticPaths = staticPaths(config.staticDir)) {
    this.staticAllow = allowedStaticPaths
  }

  get clientIdleMs(): number { return this.openClients ? 0 : Date.now() - this.lastClientAt }
  clientOpened(): void { this.openClients++; this.lastClientAt = Date.now() }
  clientClosed(): void { this.openClients = Math.max(0, this.openClients - 1); this.lastClientAt = Date.now() }
  touch(): void { this.lastClientAt = Date.now() }

  isStatic(method: string, pathname: string): boolean {
    return method === 'GET' && this.staticAllow.has(pathname)
  }

  isUnmounted(pathname: string): boolean {
    return this.config.mode === 'pikkumies' && FILE_PATH.test(pathname)
  }

  authorize(request: Request): boolean {
    const value = request.headers.get('authorization')
    return value?.startsWith('Bearer ') === true && this.checkBearer(value.slice(7))
  }

  checkBearer(value: string): boolean {
    if (!this.bearer || Date.now() - this.issuedAt >= MAX_BEARER_AGE_MS) return false
    const expected = Buffer.from(this.bearer)
    const supplied = Buffer.from(value)
    return expected.length === supplied.length && timingSafeEqual(expected, supplied)
  }

  async exchange(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    let token: unknown
    try { token = (await request.json() as { token?: unknown }).token } catch { return new Response(null, { status: 400 }) }
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(token)) return new Response(null, { status: 401 })
    const file = path.join(this.config.tokenDir, token)
    const claimed = path.join(this.config.tokenDir, `.${token}.used`)
    try {
      await rename(file, claimed)
      const info = await stat(claimed)
      if (!info.isFile() || info.size > 4096 || Date.now() - info.mtimeMs > MAX_LAUNCH_AGE_MS) return new Response(null, { status: 401 })
      const handle = await open(claimed, 'r')
      try {
        const body = (await handle.readFile('utf8')).trim()
        if (body && body !== token) return new Response(null, { status: 401 })
      } finally { await handle.close() }
    } catch { return new Response(null, { status: 401 }) }
    finally { await unlink(claimed).catch(() => {}) }
    if (!this.bearer || Date.now() - this.issuedAt >= MAX_BEARER_AGE_MS) {
      this.bearer = randomBytes(32).toString('base64url')
      this.issuedAt = Date.now()
    }
    this.touch()
    return Response.json({ bearer: this.bearer, allowedOrigin: this.config.allowedOrigin, launcherUrl: this.config.launcherUrl, mode: this.config.mode }, { headers: { 'Cache-Control': 'no-store' } })
  }

  headers(response: Response, pathname = ''): Response {
    const headers = new Headers(response.headers)
    headers.delete('set-cookie')
    headers.set('Content-Security-Policy', `frame-ancestors ${this.config.frameAncestor}` + (FILE_PATH.test(pathname) ? '; sandbox' : ''))
    headers.set('X-Frame-Options', `ALLOW-FROM ${this.config.frameAncestor}`)
    headers.set('Cache-Control', pathname === '/' ? 'no-store' : headers.get('Cache-Control') ?? 'no-store')
    if (FILE_PATH.test(pathname)) {
      headers.set('X-Content-Type-Options', 'nosniff')
      headers.set('Content-Disposition', 'attachment')
      if (response.headers.get('content-type')?.includes('text/html')) headers.set('Content-Type', 'application/octet-stream')
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}
