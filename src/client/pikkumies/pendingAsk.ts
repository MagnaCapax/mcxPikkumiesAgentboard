/** Ordered, bounded messages handed to this tab by the account launcher. */
export type PendingAsk = { text: string; nonce: string; ts: number }
export const PENDING_ASK_KEY = 'pending-ask'

export function readPendingAsks(raw: string | null): PendingAsk[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    const rows = Array.isArray(value) ? value : [value]
    const seen = new Set<string>()
    return rows.filter((row): row is PendingAsk => {
      if (!row || typeof row !== 'object') return false
      const ask = row as Partial<PendingAsk>
      if (typeof ask.text !== 'string' || !ask.text || ask.text.length > 4000 ||
          typeof ask.nonce !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(ask.nonce) ||
          typeof ask.ts !== 'number' || !Number.isFinite(ask.ts) ||
          Date.now() - ask.ts > 60 * 60_000 || seen.has(ask.nonce)) return false
      seen.add(ask.nonce)
      return true
    }).slice(0, 5)
  } catch { return [] }
}

export function removePendingAsk(nonce: string): PendingAsk[] {
  const next = readPendingAsks(localStorage.getItem(PENDING_ASK_KEY)).filter((ask) => ask.nonce !== nonce)
  if (next.length) localStorage.setItem(PENDING_ASK_KEY, JSON.stringify(next))
  else localStorage.removeItem(PENDING_ASK_KEY)
  return next
}
