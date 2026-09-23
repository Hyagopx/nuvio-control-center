import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited, RequestJsonError } from '../../../../lib/request-json'
import { boundedFetchText } from '../../../../lib/bounded-fetch'
const BASE = process.env.NUVIO_API_BASE || 'https://api.nuvio.tv'
const KEY = process.env.NUVIO_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI'
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await readJsonLimited(req, 16_000)
    if (!email || !password) return NextResponse.json({ error: 'Email e senha são obrigatórios.' }, { status: 400 })
    const { response:r, text } = await boundedFetchText(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }, { timeoutMs:12_000, maxBytes:256_000 })
    let d:any=null;try{d=text?JSON.parse(text):null}catch{}
    if (!r.ok) return NextResponse.json({ error: d?.error_description || d?.msg || d?.message || `Nuvio HTTP ${r.status}` }, { status: r.status === 400 || r.status === 401 ? 401 : 502 })
    return NextResponse.json({ access_token: d.access_token, refresh_token: d.refresh_token, user: d.user })
  } catch (error:any) {
    return NextResponse.json({ error: error instanceof RequestJsonError ? error.message : error?.message || 'Falha ao comunicar com a Cloud API.' }, { status: error instanceof RequestJsonError ? error.status : 502 })
  }
}
