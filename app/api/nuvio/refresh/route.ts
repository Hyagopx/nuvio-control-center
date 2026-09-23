import { NextRequest, NextResponse } from 'next/server'
const BASE = process.env.NUVIO_API_BASE || 'https://api.nuvio.tv'
const KEY = process.env.NUVIO_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI'
export async function POST(req: NextRequest) {
  try {
    const { refresh_token } = await req.json()
    if (!refresh_token) return NextResponse.json({ error: 'Refresh token ausente.' }, { status: 400 })
    const r = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token }), cache: 'no-store' })
    const d = await r.json().catch(() => null)
    if (!r.ok) return NextResponse.json({ error: d?.error_description || d?.msg || d?.message || 'Sessão expirada.' }, { status: r.status === 400 || r.status === 401 ? 401 : 502 })
    return NextResponse.json({ access_token: d.access_token, refresh_token: d.refresh_token || refresh_token, user: d.user })
  } catch { return NextResponse.json({ error: 'Falha ao renovar a sessão.' }, { status: 502 }) }
}
