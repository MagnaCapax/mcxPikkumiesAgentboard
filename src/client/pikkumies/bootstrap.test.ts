import { expect, test } from 'bun:test'
import { apiRequestUrl } from './bootstrap'

test('API requests stay under the path the UI is served from', () => {
  const panel = 'https://host.example.test/user-alice/pikkumies/?session=pm1'
  expect(apiRequestUrl('/api/eternals', panel)?.href).toBe('https://host.example.test/user-alice/pikkumies/api/eternals')
  expect(apiRequestUrl('/api/pr-checks?url=x', panel)?.href).toBe('https://host.example.test/user-alice/pikkumies/api/pr-checks?url=x')
  expect(apiRequestUrl('api/auth', panel)?.href).toBe('https://host.example.test/user-alice/pikkumies/api/auth')
  expect(apiRequestUrl('https://host.example.test/user-alice/pikkumies/api/ask', panel)?.href).toBe('https://host.example.test/user-alice/pikkumies/api/ask')
})

test('a UI served at the root keeps its API at /api/', () => {
  const root = 'https://local.example.test/?session=pm1'
  expect(apiRequestUrl('/api/eternals', root)?.href).toBe('https://local.example.test/api/eternals')
})

test('requests that are not this UI\'s API never carry the bearer', () => {
  const panel = 'https://host.example.test/user-alice/pikkumies/'
  expect(apiRequestUrl('https://other.example.test/api/eternals', panel)).toBeNull()
  expect(apiRequestUrl('/user-alice/index.php', panel)).toBeNull()
  expect(apiRequestUrl('/user-bob/pikkumies/api/eternals', panel)).toBeNull()
  expect(apiRequestUrl('/assets/app.js', panel)).toBeNull()
})
