import { NextRequest, NextResponse } from 'next/server'
import { clearRefreshCookie, isSameOriginRequest } from '../../../../lib/browser-session'

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  clearRefreshCookie(response)
  return response
}
