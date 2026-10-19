/** Single-strip Eternal layout for the simplified account interface. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session, SendClientMessage, SubscribeServerMessage } from '../../shared/types'
import type { ConnectionStatus } from '../stores/sessionStore'
import Terminal from '../components/Terminal'
import { ToastViewport } from '../components/Toast'

type EternalState = 'running' | 'starting' | 'waiting-for-setup' | 'not-ready' | 'quit'
type Eternal = { id: string; state: EternalState }
type PendingAsk = { text: string; nonce: string; ts: number }
const ID = /^pm[1-9]$/

interface Props {
  sessions: Session[]
  selectedSessionId: string | null
  selectSession: (id: string | null) => void
  connectionStatus: ConnectionStatus
  connectionEpoch: number
  sendMessage: SendClientMessage
  subscribe: SubscribeServerMessage
}

export default function PikkumiesLayout(props: Props) {
  const [eternals, setEternals] = useState<Eternal[]>([])
  const [targetId, setTargetId] = useState(() => {
    const id = new URLSearchParams(window.location.search).get('session')
    return id && ID.test(id) ? id : 'pm1'
  })
  const [closingId, setClosingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now())
  const stateSince = useRef(new Map<string, { state: EternalState; since: number }>())

  const poll = useCallback(async () => {
    try {
      const response = await fetch('/api/eternals')
      if (!response.ok) return
      const rows = await response.json() as Eternal[]
      const next = rows.filter((row) => ID.test(row.id)).sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)))
      const stamp = Date.now()
      for (const row of next) {
        const previous = stateSince.current.get(row.id)
        if (!previous || previous.state !== row.state) stateSince.current.set(row.id, { state: row.state, since: stamp })
      }
      for (const id of stateSince.current.keys()) if (!next.some((row) => row.id === id)) stateSince.current.delete(id)
      setEternals(next)
      setNow(stamp)
    } catch { /* existing state stays visible while reconnecting */ }
  }, [])

  useEffect(() => {
    void poll()
    const timer = window.setInterval(() => { void poll() }, 5000)
    return () => window.clearInterval(timer)
  }, [poll])

  const selected = useMemo(() => props.sessions.find((session) => session.name === targetId && session.tmuxWindow.startsWith('pikkumies:')) ?? null, [props.sessions, targetId])
  useEffect(() => {
    if (selected?.id !== props.selectedSessionId) props.selectSession(selected?.id ?? null)
  }, [selected, props.selectedSessionId, props.selectSession])

  useEffect(() => {
    const raw = localStorage.getItem('pending-ask')
    if (!raw) return
    let pending: PendingAsk
    try { pending = JSON.parse(raw) as PendingAsk } catch { return }
    if (typeof pending.text !== 'string' || typeof pending.nonce !== 'string' ||
        !Number.isFinite(pending.ts) || Date.now() - pending.ts > 60 * 60_000) return
    let cancelled = false
    let fiveRetries = 0
    async function deliver() {
      if (cancelled) return
      try {
        const response = await fetch('/api/ask', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: pending.text, nonce: pending.nonce }),
        })
        const result = await response.json() as { accepted?: boolean; code?: number }
        if (result.accepted) {
          if (localStorage.getItem('pending-ask') === raw) localStorage.removeItem('pending-ask')
          setNotice('')
          return
        }
        if (result.code === 2 || result.code === 5 && ++fiveRetries <= 3) {
          if (result.code === 2) setNotice('Pikkumies needs you in its window first.')
          window.setTimeout(() => { void deliver() }, 5000)
          return
        }
        setNotice(result.code === 3 ? 'Pikkumies needs you in its window first.' :
          result.code === 4 ? 'You are sending messages quickly. Try again in a minute.' :
          'That did not go through. Try again.')
      } catch { setNotice('That did not go through. Try again.') }
    }
    void deliver()
    return () => { cancelled = true }
  }, [])

  async function create() {
    const response = await fetch('/api/eternals', { method: 'POST' })
    const result = await response.json() as { id?: string; error?: string }
    if (response.ok && result.id && ID.test(result.id)) { setTargetId(result.id); void poll(); return }
    setNotice(result.error === 'memory' ? 'Not enough memory for another Pikkumies. Close one first.' : 'Pikkumies is not running right now.')
  }

  async function close() {
    if (!closingId) return
    const response = await fetch(`/api/eternals/${closingId}/quit`, { method: 'POST' })
    if (response.ok) { setTargetId('pm1'); setClosingId(null); void poll() }
    else setNotice('Pikkumies is not running right now.')
  }

  const active = eternals.find((item) => item.id === targetId)
  const visible = eternals.filter((item) => item.id !== 'pm1' && item.state !== 'quit')
  const tabs = [{ id: 'pm1', state: eternals.find((item) => item.id === 'pm1')?.state ?? 'starting' }, ...visible] as Eternal[]
  const slow = (item: Eternal) => item.state !== 'running' && now - (stateSince.current.get(item.id)?.since ?? now) > 180_000
  return <div className="flex h-full min-h-0 flex-col bg-[#0f1720] text-white" data-testid="pikkumies-layout">
    <div data-testid="pikkumies-strip" className="flex w-full items-center gap-1 overflow-x-auto border-b border-white/10 px-2 text-sm" style={{ height: 44, minHeight: 44 }}>
      {tabs.map((item) => <div key={item.id} className={`flex h-9 shrink-0 items-center rounded-md ${targetId === item.id ? 'bg-white/15' : 'hover:bg-white/10'}`}>
        <button className="flex h-full items-center gap-2 px-2" title={item.id === 'pm1' ? 'Primary always runs' : undefined} onClick={() => setTargetId(item.id)}>
          <span>{item.id === 'pm1' ? 'Primary' : `Pikkumies ${item.id.slice(2)}`}</span>
          {item.state === 'running' ? <span aria-label="Running" className="h-2 w-2 rounded-full bg-green-400" /> :
            <span className="text-amber-300">{item.state === 'waiting-for-setup' ? 'Needs setup' : 'Starting'}{slow(item) ? ' Taking longer than usual. Contact support.' : ''}</span>}
        </button>
        {item.id !== 'pm1' && <button className="px-2 text-white/60 hover:text-white" aria-label={`Close Pikkumies ${item.id.slice(2)}`} onClick={() => setClosingId(item.id)}>×</button>}
      </div>)}
      <button aria-label="New Pikkumies" title={tabs.length >= 9 ? 'You have 9 Pikkumies, the maximum' : undefined} disabled={tabs.length >= 9} onClick={() => { void create() }} className="h-9 shrink-0 rounded-md px-2 hover:bg-white/10 disabled:opacity-50">+ New Pikkumies</button>
      {props.connectionStatus !== 'connected' && <span aria-label="Reconnecting..." className="ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-400" />}
    </div>
    {active?.state === 'waiting-for-setup' && <div className="bg-amber-950 px-3 py-2 text-sm text-amber-200">Pikkumies needs you to finish setup in the window below.</div>}
    {notice && <div role="alert" className="bg-amber-950 px-3 py-2 text-sm text-amber-200">{notice}</div>}
    <Terminal simplified session={selected} sessions={props.sessions} connectionStatus={props.connectionStatus} connectionEpoch={props.connectionEpoch}
      sendMessage={props.sendMessage} subscribe={props.subscribe} onClose={() => {}} onSelectSession={props.selectSession}
      onNewSession={() => {}} onKillSession={() => {}} onRenameSession={() => {}} onResumeSession={() => {}} onOpenSettings={() => {}} />
    {closingId && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="mx-4 w-full max-w-sm rounded-lg bg-[#1e293b] p-5">
        <h2 className="mb-2 text-lg">Close Pikkumies {closingId.slice(2)}?</h2>
        <p className="mb-5 text-sm">This stops it and removes it from your list. It will not come back after a restart.</p>
        <div className="flex justify-end gap-3"><button onClick={() => setClosingId(null)}>Keep it</button><button onClick={() => { void close() }}>Close it</button></div>
      </div>
    </div>}
    <ToastViewport />
  </div>
}
