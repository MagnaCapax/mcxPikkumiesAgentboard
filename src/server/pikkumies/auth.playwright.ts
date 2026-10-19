import { expect, test } from '@playwright/test'

test('fragment exchange and guarded simplified interface', async ({ page, request }, testInfo) => {
  const port = Number(process.env.E2E_PORT) || 4176
  const base = `http://127.0.0.1:${port}`
  const token = 'e'.repeat(48)
  const seenUrls: string[] = []
  page.on('request', (req) => seenUrls.push(req.url()))
  await page.goto(`${base}/#${token}`)
  await expect(page.getByTestId('pikkumies-layout')).toBeVisible()
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
  expect((await request.get(`${base}/favicon.svg`)).status()).toBe(200)
  expect((await request.get(`${base}/fonts/jetbrains-mono-latin-wght-normal.woff2`)).status()).toBe(200)
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
  await page.screenshot({ path: testInfo.outputPath('pikkumies.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  expect((await page.getByTestId('pikkumies-strip').boundingBox())?.height).toBe(44)
  await expect(page.getByRole('button', { name: 'Open session menu' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('pikkumies-phone.png') })
})
