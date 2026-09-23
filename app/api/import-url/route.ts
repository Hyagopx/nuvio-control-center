import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited, RequestJsonError } from '../../../lib/request-json'
import { safeExternalJson, SafeFetchError } from '../../../lib/safe-external-fetch'
export async function POST(req: NextRequest) {
  try {
    const { url } = await readJsonLimited(req, 8_000)
    const response = await safeExternalJson(String(url || ''), { timeoutMs: 12_000, maxBytes: 1_000_000 })
    return NextResponse.json({ data: response.json, source: response.url }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    const status = e instanceof RequestJsonError || e instanceof SafeFetchError ? e.status : 400
    return NextResponse.json({ error: e?.message || 'Falha ao importar URL.' }, { status })
  }
}
