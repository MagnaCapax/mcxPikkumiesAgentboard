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
  await expect(page.getByRole('tab', { name: /Pikkumies 2/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+x')
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
