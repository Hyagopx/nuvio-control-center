import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited, RequestJsonError } from '../../../../lib/request-json'
import { boundedFetchText } from '../../../../lib/bounded-fetch'
import { clearRefreshCookie, isSameOriginRequest, NUVIO_REFRESH_COOKIE, setRefreshCookie } from '../../../../lib/browser-session'
const BASE = process.env.NUVIO_API_BASE || 'https://api.nuvio.tv'
const KEY = process.env.NUVIO_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI'
export async function POST(req: NextRequest) {
  try {
    if (!isSameOriginRequest(req)) return NextResponse.json({ error: 'Origem da solicitação inválida.' }, { status: 403 })
    const body = await readJsonLimited(req, 16_000)
    const refresh_token = req.cookies.get(NUVIO_REFRESH_COOKIE)?.value || body?.refresh_token
    const remember = body?.remember !== false
    if (typeof refresh_token !== 'string' || !refresh_token || refresh_token.length > 8_192) return NextResponse.json({ error: 'Refresh token ausente ou inválido.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    const { response:r, text } = await boundedFetchText(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token }) }, { timeoutMs:12_000, maxBytes:256_000 })
    let d:any=null;try{d=text?JSON.parse(text):null}catch{}
    if (!r.ok) {
      const status = r.status === 400 || r.status === 401 ? 401 : 502
      const response = NextResponse.json({ error: d?.error_description || d?.msg || d?.message || 'Sessão expirada.' }, { status, headers: { 'Cache-Control': 'no-store' } })
      if (status === 401) clearRefreshCookie(response)
      return response
    }
    if (typeof d?.access_token !== 'string' || !d.access_token) return NextResponse.json({ error: 'A Cloud API não retornou um token de acesso.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
    const nextRefreshToken = d.refresh_token || refresh_token
    const response = NextResponse.json({ access_token: d.access_token, user: d.user }, { headers: { 'Cache-Control': 'no-store' } })
    setRefreshCookie(response, nextRefreshToken, remember)
    return response
  } catch (error:any) {
    const response = NextResponse.json({ error: error instanceof RequestJsonError ? error.message : error?.message || 'Falha ao renovar a sessão.' }, { status: error instanceof RequestJsonError ? error.status : 502, headers: { 'Cache-Control': 'no-store' } })
    if (error instanceof RequestJsonError && error.status === 401) clearRefreshCookie(response)
    return response
  }
}
