/** Single-strip Eternal layout for the simplified account interface. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session, SendClientMessage, SubscribeServerMessage } from '../../shared/types'
import type { ConnectionStatus } from '../stores/sessionStore'
import Terminal from '../components/Terminal'
import { ToastViewport, toastManager } from '../components/Toast'
import { getEffectiveModifier, matchesModifier } from '../utils/device'
import { useSettingsStore } from '../stores/settingsStore'
import { currentLaunch } from './bootstrap'
import { PENDING_ASK_KEY, readPendingAsks, removePendingAsk, type PendingAsk } from './pendingAsk'

type EternalState = 'running' | 'starting' | 'waiting-for-setup' | 'not-ready' | 'quit'
type Eternal = { id: string; state: EternalState }
const ID = /^pm[1-9]$/
const LAST_TAB_KEY = 'pikkumies-last-tab'

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
    if (id && ID.test(id)) return id
    if (readPendingAsks(localStorage.getItem(PENDING_ASK_KEY)).length) return 'pm1'
    const last = localStorage.getItem(LAST_TAB_KEY)
    return last && ID.test(last) ? last : 'pm1'
  })
  const [closingId, setClosingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [pollError, setPollError] = useState('')
  const shortcutModifier = useSettingsStore((state) => state.shortcutModifier)
  const [pending, setPending] = useState<PendingAsk[]>(() => readPendingAsks(localStorage.getItem(PENDING_ASK_KEY)))
  const [sendTick, setSendTick] = useState(0)
  const [sending, setSending] = useState(false)
  const [now, setNow] = useState(Date.now())
  const stateSince = useRef(new Map<string, { state: EternalState; since: number }>())
  const previousFocus = useRef<HTMLElement | null>(null)
  const keepButton = useRef<HTMLButtonElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  const poll = useCallback(async () => {
    try {
      const response = await fetch('/api/eternals')
      if (!response.ok) { setPollError('Pikkumies could not load its windows.'); return }
      const rows = await response.json() as Eternal[]
      const next = rows.filter((row) => ID.test(row.id)).sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)))
      const stamp = Date.now()
      for (const row of next) {
        const previous = stateSince.current.get(row.id)
        if (!previous || previous.state !== row.state) stateSince.current.set(row.id, { state: row.state, since: stamp })
      }
      for (const id of stateSince.current.keys()) if (!next.some((row) => row.id === id)) stateSince.current.delete(id)
      setEternals(next)
      setPollError('')
      setNow(stamp)
    } catch { /* existing state stays visible while reconnecting */ }
  }, [])

  useEffect(() => {
    let timer: number
    let stopped = false
    const tick = () => {
      void poll()
      if (!stopped) timer = window.setTimeout(tick, document.hidden ? 60_000 : 5000)
    }
    tick()
    const visible = () => { if (!document.hidden) { window.clearTimeout(timer); tick() } }
    document.addEventListener('visibilitychange', visible)
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [poll])

  const selected = useMemo(() => props.sessions.find((session) => session.name === targetId && session.tmuxWindow.startsWith('pikkumies:')) ?? null, [props.sessions, targetId])
  useEffect(() => {
    if (selected?.id !== props.selectedSessionId) props.selectSession(selected?.id ?? null)
  }, [selected, props.selectedSessionId, props.selectSession])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PENDING_ASK_KEY) return
      const next = readPendingAsks(event.newValue)
      setPending(next)
      if (next.length) { setTargetId('pm1'); setSendTick((tick) => tick + 1) }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    localStorage.setItem(LAST_TAB_KEY, targetId)
    tabRefs.current.get(targetId)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [targetId])

  useEffect(() => {
    const origin = currentLaunch()?.allowedOrigin
    if (origin && window.parent !== window) requestAnimationFrame(() => window.parent.postMessage('pikkumies:ready', origin))
    document.title = 'Pikkumies'
    document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', '/pikkumies.svg')
    const manifest = document.createElement('link')
    manifest.rel = 'manifest'
    manifest.href = '/pikkumies.webmanifest'
    document.head.appendChild(manifest)
    return () => manifest.remove()
  }, [])

  useEffect(() => {
    const focus = () => {
      if (!matchMedia('(pointer: coarse)').matches && !closingId) {
        document.querySelector<HTMLElement>('[data-testid="pikkumies-layout"] .xterm-helper-textarea')?.focus()
      }
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [closingId])

  useEffect(() => {
    const ask = pending[0]
    if (!ask) return
    let cancelled = false
    let timer: number | undefined
    let exitFiveRetries = 0
    async function deliver() {
      if (cancelled) return
      setSending(true)
      setNotice('')
      try {
        const response = await fetch('/api/ask', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: ask.text, nonce: ask.nonce }),
        })
        const result = await response.json() as { accepted?: boolean; code?: number }
        if (cancelled) return
        if (result.accepted) {
          setPending(removePendingAsk(ask.nonce))
          setSending(false)
          setNotice('')
          return
        }
        if (result.code === 5 && ++exitFiveRetries > 3) {
          setSending(false)
          setNotice('That did not go through')
          return
        }
        if (result.code === 2 || result.code === 5 || result.code === 6) {
          setNotice(result.code === 2 ? 'Your question will be sent when setup is done.' : '')
          timer = window.setTimeout(() => { void deliver() }, 5000)
          return
        }
        setSending(false)
        setNotice(result.code === 3 ? 'Pikkumies needs you in its window first.' :
          result.code === 4 ? 'You are sending messages quickly. Try again in a minute.' :
          'That did not go through. Try again.')
      } catch { if (!cancelled) { setSending(false); setNotice('That did not go through. Try again.') } }
    }
    void deliver()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); setSending(false) }
  }, [pending, sendTick])

  async function create() {
    const response = await fetch('/api/eternals', { method: 'POST' })
    const result = await response.json() as { id?: string; error?: string }
    if (response.ok && result.id && ID.test(result.id)) {
      setTargetId(result.id)
      void poll()
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-testid="pikkumies-layout"] .xterm-helper-textarea')?.focus(), 100)
      return
    }
    setNotice(result.error === 'memory' ? 'Not enough memory for another Pikkumies. Close one first.' : 'Pikkumies is not running right now.')
  }

  async function close() {
    if (!closingId) return
    const response = await fetch(`/api/eternals/${closingId}/quit`, { method: 'POST' })
    if (response.ok) {
      const index = tabs.findIndex((tab) => tab.id === closingId)
      setTargetId(tabs[Math.max(0, index - 1)]?.id ?? 'pm1')
      setClosingId(null)
      void poll()
    }
    else setNotice('Pikkumies is not running right now.')
  }

  const active = eternals.find((item) => item.id === targetId)
  const visible = eternals.filter((item) => item.id !== 'pm1' && item.state !== 'quit')
  const tabs = [{ id: 'pm1', state: eternals.find((item) => item.id === 'pm1')?.state ?? 'starting' }, ...visible] as Eternal[]
  const slow = (item: Eternal) => item.state !== 'running' && now - (stateSince.current.get(item.id)?.since ?? now) > 180_000
  useEffect(() => {
    if (!closingId) return
    previousFocus.current = document.activeElement as HTMLElement | null
    keepButton.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setClosingId(null) }
      if (event.key === 'Tab') {
        event.preventDefault()
        ;(document.activeElement === keepButton.current ? closeButton.current : keepButton.current)?.focus()
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); previousFocus.current?.focus() }
  }, [closingId])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesModifier(event, getEffectiveModifier(shortcutModifier))) return
      const index = tabs.findIndex((tab) => tab.id === targetId)
      let next: string | undefined
      if (/^Digit[1-9]$/.test(event.code)) next = tabs[Number(event.code.slice(5)) - 1]?.id
      else if (event.code === 'BracketLeft') next = tabs[Math.max(0, index - 1)]?.id
      else if (event.code === 'BracketRight') next = tabs[Math.min(tabs.length - 1, index + 1)]?.id
      else if (event.code === 'KeyN') { event.preventDefault(); void create(); return }
      else if (event.code === 'KeyX') { event.preventDefault(); if (targetId !== 'pm1') setClosingId(targetId); return }
      else if (event.code === 'Comma') { event.preventDefault(); return }
      if (next) { event.preventDefault(); setTargetId(next) }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  })
  return <div className="flex h-full min-h-0 flex-col bg-[#0f1720] text-white" data-testid="pikkumies-layout">
    <div data-testid="pikkumies-strip" role="tablist" aria-label="Pikkumies windows" className="flex w-full items-center gap-1 overflow-x-auto border-b border-white/10 px-2 text-sm" style={{ height: 44, minHeight: 44 }}>
      {tabs.map((item) => <div key={item.id} className={`flex h-9 shrink-0 items-center rounded-md ${targetId === item.id ? 'bg-white/15' : 'hover:bg-white/10'}`}>
        <button role="tab" aria-selected={targetId === item.id} aria-controls="pikkumies-panel" tabIndex={targetId === item.id ? 0 : -1}
          ref={(element) => { if (element) tabRefs.current.set(item.id, element); else tabRefs.current.delete(item.id) }}
          onKeyDown={(event) => {
            const index = tabs.findIndex((tab) => tab.id === item.id)
            const next = event.key === 'ArrowRight' ? tabs[Math.min(index + 1, tabs.length - 1)] :
              event.key === 'ArrowLeft' ? tabs[Math.max(index - 1, 0)] :
              event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : undefined
            if (next) { event.preventDefault(); setTargetId(next.id); tabRefs.current.get(next.id)?.focus() }
          }}
          className="flex h-full items-center gap-2 rounded-md px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4fc3f7]" title={item.id === 'pm1' ? 'Primary always runs' : undefined} onClick={() => setTargetId(item.id)}>
          <span>{item.id === 'pm1' ? 'Primary' : `Pikkumies ${item.id.slice(2)}`}</span>
          {item.state === 'running' ? <><span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-400" /><span className="sr-only"> Running</span></> :
            <span className="text-amber-300">{item.state === 'waiting-for-setup' ? 'Needs setup' : 'Starting'}{slow(item) ? ' Taking longer than usual. Contact support.' : ''}</span>}
        </button>
        {item.id !== 'pm1' && <button className="flex h-11 w-11 items-center justify-center text-white/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4fc3f7]" aria-label={`Close Pikkumies ${item.id.slice(2)}`} onClick={() => setClosingId(item.id)}>×</button>}
      </div>)}
      <button aria-label="New Pikkumies" onClick={() => { if (tabs.length >= 9) toastManager.add({ title: 'You have 9 Pikkumies, the maximum', type: 'info' }); else void create() }} className="h-11 shrink-0 rounded-md px-2 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4fc3f7]">+ New Pikkumies</button>
      {props.connectionStatus !== 'connected' && <span aria-label="Reconnecting..." className="ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-400" />}
    </div>
    {active?.state === 'waiting-for-setup' && <div className="bg-amber-950 px-3 py-2 text-sm text-amber-200">Pikkumies needs you to finish setup in the window below.</div>}
    {pollError && <div role="status" className="bg-amber-950 px-3 py-2 text-sm text-amber-200">{pollError}</div>}
    <div aria-live="polite" className={notice || pending.length ? 'bg-amber-950 px-3 py-2 text-sm text-amber-200' : 'sr-only'}>
      {pending.length > 0 && <span>Not sent yet: {pending[0]!.text.slice(0, 60)}. </span>}
      {sending && <span>Sending your message… </span>}{notice}
      {pending.length > 0 && !sending && <button className="ml-2 rounded px-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4fc3f7]" onClick={() => setSendTick((tick) => tick + 1)}>Send</button>}
    </div>
    <div id="pikkumies-panel" role="tabpanel" aria-label={targetId === 'pm1' ? 'Primary' : `Pikkumies ${targetId.slice(2)}`} className="flex min-h-0 flex-1 flex-col">
    <Terminal simplified session={selected} sessions={props.sessions} connectionStatus={props.connectionStatus} connectionEpoch={props.connectionEpoch}
      sendMessage={props.sendMessage} subscribe={props.subscribe} onClose={() => {}} onSelectSession={props.selectSession}
      onNewSession={() => {}} onKillSession={() => {}} onRenameSession={() => {}} onResumeSession={() => {}} onOpenSettings={() => {}} />
    </div>
    {closingId && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="mx-4 w-full max-w-sm rounded-lg bg-[#1e293b] p-5">
        <h2 className="mb-2 text-lg">Close Pikkumies {closingId.slice(2)}?</h2>
        <p className="mb-5 text-sm">This stops it and removes it from your list. It will not come back after a restart.</p>
        <div className="flex justify-end gap-3"><button ref={keepButton} className="rounded px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4fc3f7]" onClick={() => setClosingId(null)}>Keep it</button><button ref={closeButton} className="rounded bg-red-600 px-3 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4fc3f7]" onClick={() => { void close() }}>Close it</button></div>
      </div>
    </div>}
    <ToastViewport />
  </div>
}
