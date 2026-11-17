// A Pikkumies tab opened in the background never fires visibilitychange, so its hidden timer must start when the
// lifecycle listeners start; otherwise the socket stays open and the server's idle exit never fires.
// Runs isolated (scripts/test-runner.ts ISOLATED_CLIENT_FILES): it stubs ../pikkumies/bootstrap for the process.
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

mock.module('../pikkumies/bootstrap', () => ({
  currentBearer: () => null,
  currentLaunch: () => ({ bearer: '', allowedOrigin: '', launcherUrl: '', mode: 'pikkumies' }),
  reconnectFromPanel: () => false,
}))

const { WebSocketManager } = await import('../hooks/useWebSocket')

const globalAny = globalThis as unknown as Record<string, unknown>
const originalWindow = globalAny.window
const originalDocument = globalAny.document
type Timer = { id: number; callback: () => void; delay: number }
let timers: Timer[] = []
let visibilityListeners: Array<() => void> = []
let visibility = 'visible'
let nextId = 1
const HIDDEN_CLOSE_MS = 10 * 60_000

beforeEach(() => {
  timers = []
  visibilityListeners = []
  nextId = 1
  globalAny.window = {
    location: { protocol: 'http:', host: 'localhost:1234' },
    setTimeout: (callback: () => void, delay: number) => { const id = nextId++; timers.push({ id, callback, delay }); return id },
    clearTimeout: (id: number) => { timers = timers.filter((t) => t.id !== id) },
    setInterval: () => nextId++,
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  globalAny.document = {
    get visibilityState() { return visibility },
    addEventListener: (event: string, handler: () => void) => { if (event === 'visibilitychange') visibilityListeners.push(handler) },
    removeEventListener: (event: string, handler: () => void) => {
      if (event === 'visibilitychange') visibilityListeners = visibilityListeners.filter((h) => h !== handler)
    },
  }
})

afterEach(() => {
  globalAny.window = originalWindow
  globalAny.document = originalDocument
})

const hiddenCloseTimers = () => timers.filter((t) => t.delay === HIDDEN_CLOSE_MS)

test('a tab loaded hidden starts its hidden-close timer and drops the socket when it fires', () => {
  visibility = 'hidden'
  const manager = new WebSocketManager()
  manager.startLifecycleListeners()
  expect(hiddenCloseTimers()).toHaveLength(1)
  hiddenCloseTimers()[0]!.callback()
  expect(manager.getStatus()).toBe('disconnected')
})

test('a tab loaded visible starts no hidden-close timer', () => {
  visibility = 'visible'
  const manager = new WebSocketManager()
  manager.startLifecycleListeners()
  expect(hiddenCloseTimers()).toHaveLength(0)
})

test('a tab loaded hidden that becomes visible cancels the timer', () => {
  visibility = 'hidden'
  const manager = new WebSocketManager()
  manager.startLifecycleListeners()
  expect(hiddenCloseTimers()).toHaveLength(1)
  visibility = 'visible'
  for (const listener of visibilityListeners) listener()
  expect(hiddenCloseTimers()).toHaveLength(0)
  manager.stopLifecycleListeners()
})

test('hiding again after becoming visible schedules exactly one timer', () => {
  visibility = 'visible'
  const manager = new WebSocketManager()
  manager.startLifecycleListeners()
  visibility = 'hidden'
  for (const listener of visibilityListeners) listener()
  for (const listener of visibilityListeners) listener()
  expect(hiddenCloseTimers()).toHaveLength(1)
  manager.stopLifecycleListeners()
})
