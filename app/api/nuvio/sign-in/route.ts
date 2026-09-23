import { NextRequest, NextResponse } from 'next/server'
const BASE = process.env.NUVIO_API_BASE || 'https://api.nuvio.tv'
const KEY = process.env.NUVIO_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI'
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) return NextResponse.json({ error: 'Email e senha são obrigatórios.' }, { status: 400 })
    const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), cache: 'no-store' })
    const d = await r.json().catch(() => null)
    if (!r.ok) return NextResponse.json({ error: d?.error_description || d?.msg || d?.message || `Nuvio HTTP ${r.status}` }, { status: r.status === 400 || r.status === 401 ? 401 : 502 })
    return NextResponse.json({ access_token: d.access_token, refresh_token: d.refresh_token, user: d.user })
  } catch {
    return NextResponse.json({ error: 'Falha ao comunicar com a Cloud API.' }, { status: 502 })
  }
}
