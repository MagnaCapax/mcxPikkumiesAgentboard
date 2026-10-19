/** Fragment exchange, in-memory API bearer, and exact-origin reconnect. */
type Launch = { bearer: string; allowedOrigin: string; launcherUrl: string; mode: 'pikkumies' | 'standard' }
let launch: Launch | null = null
let lastReconnect = 0

export function currentLaunch(): Launch | null { return launch }
export function currentBearer(): string | null { return launch?.bearer ?? null }

function showUnavailable(): void {
  const root = document.getElementById('root')
  if (root) root.textContent = 'Pikkumies is not running right now. Open it again from your control panel.'
}

export function reconnectFromPanel(): boolean {
  if (!launch || Date.now() - lastReconnect < 30_000) return false
  lastReconnect = Date.now()
  if (window.parent !== window) window.parent.postMessage('pikkumies:reconnect', launch.allowedOrigin)
  else window.location.assign(launch.launcherUrl)
  return true
}

export async function bootstrap(): Promise<boolean> {
  const fragment = window.location.hash.slice(1)
  history.replaceState(null, '', window.location.pathname + window.location.search)
  const token = fragment.startsWith('token=') ? new URLSearchParams(fragment).get('token') : fragment
  if (!token) return false
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    credentials: 'omit',
  })
  if (!response.ok) return false
  launch = await response.json() as Launch
  const nativeFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, init)
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
    headers.set('Authorization', `Bearer ${launch?.bearer ?? ''}`)
    return nativeFetch(input, { ...init, headers, credentials: 'omit' }).then((result) => {
      if (result.status === 401 && !reconnectFromPanel()) showUnavailable()
      return result
    }).catch((error) => { showUnavailable(); throw error })
  }) as typeof window.fetch
  return true
}
