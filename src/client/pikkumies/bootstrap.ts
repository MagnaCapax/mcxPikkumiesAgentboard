/** Fragment exchange, in-memory API bearer, and exact-origin reconnect. */
// panelOrigin is the control panel that frames this UI; messages to it must name its origin, not this UI's.
type Launch = { bearer: string; allowedOrigin: string; panelOrigin: string; launcherUrl: string; mode: 'pikkumies' | 'standard' }
let launch: Launch | null = null
let lastReconnect = 0

// The bearer has its own header because the panel's login uses Authorization on the same requests.
export const PIKKUMIES_TOKEN_HEADER = 'X-Pikkumies-Token'

export function currentLaunch(): Launch | null { return launch }
export function currentBearer(): string | null { return launch?.bearer ?? null }

/**
 * The URL of this UI's own API for an app request, or null when the request goes elsewhere.
 * The UI can be served under a path (/user-<name>/pikkumies/), so "/api/..." is placed under the page's base path.
 */
export function apiRequestUrl(raw: string, base: string): URL | null {
  const url = new URL(raw, base)
  const root = new URL('./', base)
  if (url.origin !== root.origin) return null
  if (url.pathname.startsWith(`${root.pathname}api/`)) return url
  if (!url.pathname.startsWith('/api/')) return null
  return new URL(url.pathname.slice(1) + url.search, root)
}

function showUnavailable(): void {
  const root = document.getElementById('root')
  if (root) root.textContent = 'Pikkumies is not running right now. Open it again from your control panel.'
}

export function reconnectFromPanel(): boolean {
  if (!launch || Date.now() - lastReconnect < 30_000) return false
  lastReconnect = Date.now()
  if (window.parent !== window) window.parent.postMessage('pikkumies:reconnect', launch.panelOrigin)
  else window.location.assign(launch.launcherUrl)
  return true
}

export async function bootstrap(): Promise<boolean> {
  const fragment = window.location.hash.slice(1)
  history.replaceState(null, '', window.location.pathname + window.location.search)
  const token = fragment.startsWith('token=') ? new URLSearchParams(fragment).get('token') : fragment
  if (!token) return false
  // same-origin keeps the panel login (Basic or its session cookie) on the request; the panel answers 401 without it.
  const response = await fetch(new URL('api/auth', document.baseURI), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    credentials: 'same-origin',
  })
  if (!response.ok) return false
  launch = await response.json() as Launch
  const nativeFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = apiRequestUrl(input instanceof Request ? input.url : String(input), document.baseURI)
    if (!url) return nativeFetch(input, init)
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
    headers.set(PIKKUMIES_TOKEN_HEADER, launch?.bearer ?? '')
    const target = input instanceof Request ? new Request(url.href, input as RequestInit) : url
    return nativeFetch(target, { ...init, headers, credentials: 'same-origin' }).then((result) => {
      if (result.status === 401 || ([502, 503, 504].includes(result.status) && result.headers.get('X-Pikkumies-App') !== '1')) {
        if (!reconnectFromPanel()) showUnavailable()
      }
      return result
    })
  }) as typeof window.fetch
  return true
}
