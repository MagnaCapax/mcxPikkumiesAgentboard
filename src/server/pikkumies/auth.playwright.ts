import { expect, test } from '@playwright/test'

test('fragment exchange and guarded simplified interface', async ({ page, request }, testInfo) => {
  const port = Number(process.env.E2E_PORT) || 4176
  const base = `http://127.0.0.1:${port}`
  const token = 'e'.repeat(64)
  const seenUrls: string[] = []
  page.on('request', (req) => seenUrls.push(req.url()))
  await page.goto(`${base}/#${token}`)
  await expect(page.getByTestId('pikkumies-layout')).toBeVisible()
  await expect(page).toHaveTitle('Pikkumies')
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/pikkumies.svg')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/pikkumies.webmanifest')
  await expect(page.getByRole('tab', { name: /Primary/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'New Pikkumies' })).toBeVisible()
  await expect(page.getByText('Primary', { exact: true })).toBeVisible()
  expect((await page.getByTestId('pikkumies-strip').boundingBox())?.height).toBe(44)
  expect(page.url()).not.toContain(token)
  expect(seenUrls.every((url) => !url.includes(token))).toBe(true)
  const unauth = await request.get(`${base}/api/sessions`)
  expect(unauth.status()).toBe(401)
  expect(unauth.headers()['set-cookie']).toBeUndefined()
  expect(unauth.headers()['content-security-policy']).toContain('frame-ancestors https://panel.example.test')
  expect((await request.get(`${base}/ws`)).status()).toBe(401)
  expect((await request.get(`${base}/bar`)).status()).toBe(401)
  for (const route of ['/api/eternals', '/api/settings/synced', '/api/health', '/api/unknown']) {
    const response = await request.get(`${base}${route}`)
    expect(response.status()).toBe(401)
    expect(response.headers()['set-cookie']).toBeUndefined()
    expect(response.headers()['content-security-policy']).toContain('frame-ancestors')
  }
  for (const token of ['z'.repeat(64), 'a'.repeat(63), 'A'.repeat(64)]) {
    expect((await request.post(`${base}/api/auth`, { data: { token } })).status()).toBe(401)
  }
  expect((await request.get(`${base}/favicon.svg`)).status()).toBe(200)
  expect((await request.get(`${base}/fonts/jetbrains-mono-latin-wght-normal.woff2`)).status()).toBe(200)
  const asset = await page.locator('script[src*="/assets/"]').getAttribute('src')
  expect(asset).toBeTruthy()
  const compressed = await request.get(`${base}${asset}`, { headers: { 'Accept-Encoding': 'gzip' } })
  expect(compressed.headers()['cache-control']).toContain('immutable')
  expect(compressed.headers()['content-encoding']).toBe('gzip')
  expect((await request.get(`${base}/api/session-media/id`)).status()).toBe(404)
  const authenticated = await page.evaluate(async () => {
    const response = await fetch('/api/eternals')
    return { status: response.status, body: await response.json() }
  })
  expect(authenticated.status).toBe(200)
  expect(authenticated.body).toEqual([{ id: 'pm1', state: 'running' }])
  expect(await page.evaluate(async () => {
    const response = await fetch('/api/session-media/id')
    return response.status
  })).toBe(404)
  expect(await page.evaluate(() => new Promise<number>((resolve) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`)
    let frames = 0
    ws.onmessage = () => { frames++ }
    ws.onopen = () => { setTimeout(() => { ws.close(); resolve(frames) }, 300) }
  }))).toBe(0)
  expect(await page.evaluate(() => new Promise<number>((resolve) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`)
    ws.onclose = (event) => resolve(event.code)
  }))).toBe(1008)
  expect(await page.evaluate(() => new Promise<number>((resolve) => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
    const sockets = Array.from({ length: 16 }, () => new WebSocket(url))
    let frames = 0
    Promise.all(sockets.map((socket) => new Promise<void>((opened) => {
      socket.onmessage = () => { frames++ }
      socket.onopen = () => opened()
    }))).then(() => {
      const excess = new WebSocket(url)
      excess.onmessage = () => { frames++ }
      sockets[0]!.onclose = (event) => {
        const accepted = excess.readyState === WebSocket.OPEN
        sockets.slice(1).forEach((socket) => socket.close())
        excess.close()
        resolve(frames === 0 && accepted ? event.code : -1)
      }
    })
  }))).toBe(1008)
  const delivered: string[] = []
  await page.route('**/api/ask', async (route) => {
    const text = (route.request().postDataJSON() as { text: string }).text
    delivered.push(text)
    const held = text === 'first question' && delivered.filter((item) => item === text).length === 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: held ? '{"accepted":false,"code":3}' : '{"accepted":true,"code":0}' })
  })
  const sender = await page.context().newPage()
  await sender.goto(base)
  await sender.evaluate(() => localStorage.setItem('pending-ask', JSON.stringify([
    { text: 'first question', nonce: 'a'.repeat(20), ts: Date.now() },
    { text: 'second question', nonce: 'b'.repeat(20), ts: Date.now() },
  ])))
  await expect(page.getByText(/Not sent yet: first question/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  await page.getByRole('button', { name: 'Send' }).click()
  await expect.poll(() => delivered).toEqual(['first question', 'first question', 'second question'])
  await expect(page.getByText('Not sent yet:')).toHaveCount(0)
  await sender.close()
  await page.screenshot({ path: testInfo.outputPath('pikkumies.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  expect((await page.getByTestId('pikkumies-strip').boundingBox())?.height).toBe(44)
  await expect(page.getByRole('button', { name: 'Open session menu' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('pikkumies-phone.png') })
  await page.route('**/api/eternals', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":"pm1","state":"running"},{"id":"pm2","state":"running"}]' })
  })
  await expect(page.getByRole('tab', { name: /Pikkumies 2/ })).toBeVisible({ timeout: 7000 })
  await page.keyboard.press('Control+2')
  await expect(page.getByRole('tab', { name: /Primary/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+Shift+2')
  await expect(page.getByRole('tab', { name: /Pikkumies 2/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+Shift+x')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.route('**/api/eternals/pm2/quit', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.getByRole('button', { name: 'Close Pikkumies 2' }).click()
  await page.getByRole('button', { name: 'Close it' }).click()
  await expect(page.getByRole('tab', { name: /Primary/ })).toHaveAttribute('aria-selected', 'true')
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForTimeout(100)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => page.locator('.xterm-helper-textarea').evaluate((element) => document.activeElement === element)).toBe(true)
  await page.clock.install()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    const original = WebSocket.prototype.close
    ;(window as Window & { __closedSockets?: number }).__closedSockets = 0
    WebSocket.prototype.close = function (...args) {
      ;(window as Window & { __closedSockets?: number }).__closedSockets!++
      return original.apply(this, args)
    }
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(10 * 60_000)
  expect(await page.evaluate(() => (window as Window & { __closedSockets?: number }).__closedSockets)).toBeGreaterThan(0)
})

test('desktop simplified clipboard offer can be copied', async ({ page, context }, testInfo) => {
  const base = `http://127.0.0.1:${Number(process.env.E2E_PORT) || 4176}`
  await page.setViewportSize({ width: 1280, height: 800 })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    class ObservedWebSocket extends NativeWebSocket {
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === 'string') {
          try {
            const message = JSON.parse(data) as { type?: string; sessionId?: string }
            if (message.type === 'terminal-attach' && message.sessionId) {
              ;(window as Window & { __attachedSocket?: WebSocket; __attachedSession?: string }).__attachedSocket = this
              ;(window as Window & { __attachedSession?: string }).__attachedSession = message.sessionId
            }
          } catch { /* Ignore non-JSON frames. */ }
        }
        return super.send(data)
      }
    }
    window.WebSocket = ObservedWebSocket
  })
  await page.goto(`${base}/#${'f'.repeat(64)}`)
  await expect(page.getByTestId('pikkumies-layout')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as Window & { __attachedSession?: string }).__attachedSession)).toBeTruthy()
  const offered = 'desktop clipboard offer'
  await page.evaluate((text) => {
    const state = window as Window & { __attachedSocket?: WebSocket; __attachedSession?: string }
    state.__attachedSocket!.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'clipboard-offer', sessionId: state.__attachedSession, source: 'tmux-buffer', text,
    }) }))
  }, offered)
  const copy = page.getByRole('button', { name: 'Copy selection' })
  await expect(copy).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('pikkumies-desktop-copy.png') })
  await copy.click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(offered)
})

test('iframe ready, gateway reconnect, and denied WebSocket messages', async ({ page }) => {
  const base = `http://127.0.0.1:${Number(process.env.E2E_PORT) || 4176}`
  let bearer = ''
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/auth') && response.ok()) bearer = (await response.json() as { bearer: string }).bearer
  })
  await page.goto(base)
  await page.route(`${base}/`, async (route) => {
    const response = await route.fetch()
    const headers: Record<string, string> = { ...response.headers(), 'content-security-policy': 'frame-ancestors *' }
    delete headers['x-frame-options']
    await route.fulfill({ response, headers })
  })
  await page.evaluate(() => {
    const parent = window as Window & { __pikkumiesMessages?: string[] }
    parent.__pikkumiesMessages = []
    parent.postMessage = (message: unknown) => { parent.__pikkumiesMessages!.push(String(message)) }
    const iframe = document.createElement('iframe')
    iframe.src = `${location.origin}/#${'b'.repeat(64)}`
    document.body.appendChild(iframe)
  })
  await expect.poll(() => page.evaluate(() => (window as Window & { __pikkumiesMessages?: string[] }).__pikkumiesMessages)).toContain('pikkumies:ready')
  await expect.poll(() => bearer).not.toBe('')
  expect(await page.evaluate((token) => new Promise<number>((resolve) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`)
    ws.onopen = () => ws.send(JSON.stringify({ bearer: token }))
    ws.onmessage = () => ws.send(JSON.stringify({ type: 'session-kill', sessionId: 'forbidden' }))
    ws.onclose = (event) => resolve(event.code)
  }), bearer)).toBe(1008)
  const frame = page.frames()[1]!
  await page.frameLocator('iframe').getByRole('button', { name: 'New Pikkumies' }).click()
  await expect(page.frameLocator('iframe').getByText('Pikkumies is not running right now.')).toBeVisible()
  await page.route('**/api/eternals', (route) => route.fulfill({ status: 503,
    headers: { 'X-Pikkumies-App': '1', 'Content-Type': 'application/json' }, body: '{"error":"unavailable"}' }))
  await frame.evaluate(() => fetch('/api/eternals'))
  expect(await page.evaluate(() => (window as Window & { __pikkumiesMessages?: string[] }).__pikkumiesMessages)).not.toContain('pikkumies:reconnect')
  await expect(page.frameLocator('iframe').getByTestId('pikkumies-layout')).toBeVisible()
  await page.unroute('**/api/eternals')
  await page.route('**/api/eternals', (route) => route.abort('failed'))
  await frame.evaluate(() => fetch('/api/eternals').catch(() => {}))
  expect(await page.evaluate(() => (window as Window & { __pikkumiesMessages?: string[] }).__pikkumiesMessages)).not.toContain('pikkumies:reconnect')
  await expect(page.frameLocator('iframe').getByTestId('pikkumies-layout')).toBeVisible()
  await page.unroute('**/api/eternals')
  await page.route('**/api/eternals', (route) => route.fulfill({ status: 503, body: 'gateway unavailable' }))
  await expect.poll(() => page.evaluate(() => (window as Window & { __pikkumiesMessages?: string[] }).__pikkumiesMessages), { timeout: 10_000 }).toContain('pikkumies:reconnect')
})

test('busy ask stops after three retries and remains available to send', async ({ page }) => {
  const base = `http://127.0.0.1:${Number(process.env.E2E_PORT) || 4176}`
  await page.goto(`${base}/#${'a'.repeat(64)}`)
  await expect(page.getByTestId('pikkumies-layout')).toBeVisible()
  await page.clock.install()
  let attempts = 0
  await page.route('**/api/ask', (route) => {
    attempts++
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":false,"code":5}' })
  })
  await page.evaluate(() => {
    const value = JSON.stringify([{ text: 'held question', nonce: 'q'.repeat(20), ts: Date.now() }])
    localStorage.setItem('pending-ask', value)
    window.dispatchEvent(new StorageEvent('storage', { key: 'pending-ask', newValue: value }))
  })
  await expect.poll(() => attempts).toBe(1)
  await page.clock.runFor(15_000)
  await expect.poll(() => attempts).toBe(4)
  await expect(page.getByText('That did not go through')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  await page.clock.runFor(10_000)
  expect(attempts).toBe(4)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect.poll(() => attempts).toBe(5)
})
