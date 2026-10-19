import { expect, test } from 'bun:test'
import { readPendingAsks } from './pendingAsk'

test('pending messages keep order, discard duplicates, and stop at five', () => {
  const now = Date.now()
  const rows = Array.from({ length: 7 }, (_, index) => ({ text: `message ${index}`, nonce: `nonce_${index.toString().padStart(16, '0')}`, ts: now }))
  expect(readPendingAsks(JSON.stringify([rows[0], rows[0], ...rows.slice(1)])).map((row) => row.text))
    .toEqual(['message 0', 'message 1', 'message 2', 'message 3', 'message 4'])
  expect(readPendingAsks(JSON.stringify({ ...rows[0], ts: now - 61 * 60_000 }))).toEqual([])
  expect(readPendingAsks(JSON.stringify(rows[0]))).toEqual([rows[0]])
})
