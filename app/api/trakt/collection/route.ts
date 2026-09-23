import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited, RequestJsonError } from '../../../../lib/request-json'
import { boundedFetchText } from '../../../../lib/bounded-fetch'

export async function POST(req: NextRequest) {
  try {
    const { clientId, accessToken } = await readJsonLimited(req, 16_000)
    if (!clientId || !accessToken) return NextResponse.json({ error: 'Client ID e Access Token são obrigatórios.' }, { status: 400 })
    const headers = { 'trakt-api-key': String(clientId), Authorization: `Bearer ${String(accessToken)}`, Accept: 'application/json' }
    const [movieResult, showResult] = await Promise.all([
      boundedFetchText('https://api.trakt.tv/sync/collection/movies?extended=full&page=1&limit=250', { headers }, { timeoutMs:20_000,maxBytes:8_000_000 }),
      boundedFetchText('https://api.trakt.tv/sync/collection/shows?extended=full&page=1&limit=250', { headers }, { timeoutMs:20_000,maxBytes:8_000_000 }),
    ])
    const {response:movies,text:movieText}=movieResult, {response:shows,text:showText}=showResult
    if (!movies.ok || !shows.ok) {
      return NextResponse.json({ error: `Trakt recusou a consulta. ${movieText || showText || ''}`.trim() }, { status: movies.status === 401 || shows.status === 401 ? 401 : 502 })
    }
    const [m, s] = [JSON.parse(movieText||'[]'),JSON.parse(showText||'[]')]
    return NextResponse.json({ movies: Array.isArray(m) ? m : [], shows: Array.isArray(s) ? s : [] })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Falha ao consultar Trakt.' }, { status: e instanceof RequestJsonError ? e.status : 502 }) }
}
