import type { NextRequest, NextResponse } from 'next/server'

export const NUVIO_REFRESH_COOKIE = 'nuvio-refresh'

export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  // Non-browser clients and existing automated integrations may omit Origin.
  if (!origin) return true
  try { return new URL(origin).origin === request.nextUrl.origin }
  catch { return false }
}

export function setRefreshCookie(response: NextResponse, value: string, remember: boolean): void {
  response.cookies.set(NUVIO_REFRESH_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/nuvio/refresh',
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  })
}

export function clearRefreshCookie(response: NextResponse): void {
  response.cookies.set(NUVIO_REFRESH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/nuvio/refresh',
    maxAge: 0,
  })
}
