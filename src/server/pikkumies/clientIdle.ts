import type { AccountGuard } from './guard'

/** Only authenticated WebSocket open/close events change the guard's idle clock. */
export function startClientIdleMonitor(
  guard: AccountGuard,
  exit: () => void,
  idleMs = 30 * 60_000,
  checkMs = 60_000,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => { if (guard.clientIdleMs >= idleMs) exit() }, checkMs)
  timer.unref?.()
  return timer
}
