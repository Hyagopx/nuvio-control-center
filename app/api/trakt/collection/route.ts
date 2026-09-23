import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { clientId, accessToken } = await req.json()
    if (!clientId || !accessToken) return NextResponse.json({ error: 'Client ID e Access Token são obrigatórios.' }, { status: 400 })
    const headers = { 'trakt-api-key': String(clientId), Authorization: `Bearer ${String(accessToken)}`, Accept: 'application/json' }
    const [movies, shows] = await Promise.all([
      fetch('https://api.trakt.tv/sync/collection/movies?extended=full&page=1&limit=250', { headers, cache: 'no-store' }),
      fetch('https://api.trakt.tv/sync/collection/shows?extended=full&page=1&limit=250', { headers, cache: 'no-store' }),
    ])
    if (!movies.ok || !shows.ok) {
      const a = await movies.text().catch(() => ''), b = await shows.text().catch(() => '')
      return NextResponse.json({ error: `Trakt recusou a consulta. ${a || b || ''}`.trim() }, { status: movies.status === 401 || shows.status === 401 ? 401 : 502 })
    }
    const [m, s] = await Promise.all([movies.json(), shows.json()])
    return NextResponse.json({ movies: Array.isArray(m) ? m : [], shows: Array.isArray(s) ? s : [] })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Falha ao consultar Trakt.' }, { status: 502 }) }
}
