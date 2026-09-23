import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

describe('POST /api/nuvio/sign-in', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('rejects missing credentials without calling the cloud', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await POST(new NextRequest('http://localhost/api/nuvio/sign-in', { method: 'POST', body: JSON.stringify({ email: '' }) }))
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the authenticated session from the cloud', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', user: { id: 'u1' } }), { status: 200 })))
    const response = await POST(new NextRequest('http://localhost/api/nuvio/sign-in', { method: 'POST', body: JSON.stringify({ email: 'person@example.com', password: 'secret' }) }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ access_token: 'access', refresh_token: 'refresh' })
  })

  it('does not turn rejected cloud credentials into a successful session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error_description: 'Invalid login credentials' }), { status: 400 })))
    const response = await POST(new NextRequest('http://localhost/api/nuvio/sign-in', { method: 'POST', body: JSON.stringify({ email: 'person@example.com', password: 'wrong' }) }))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid login credentials' })
  })
})
