import { NextRequest, NextResponse } from 'next/server'
export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    const target = new URL(String(url || ''))
    if (!/^https?:$/.test(target.protocol)) throw new Error('A URL precisa usar http ou https.')
    const r = await fetch(target.toString(), { cache: 'no-store', redirect: 'follow', headers: { Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(15000) })
    const text = await r.text()
    if (!r.ok) return NextResponse.json({ error: `URL respondeu HTTP ${r.status}.` }, { status: 400 })
    try { return NextResponse.json({ data: JSON.parse(text), source: r.url }) } catch { return NextResponse.json({ error: 'A URL não retornou JSON válido.' }, { status: 400 }) }
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Falha ao importar URL.' }, { status: 400 }) }
}
