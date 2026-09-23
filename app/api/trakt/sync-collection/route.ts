import { NextRequest, NextResponse } from 'next/server'

function ids(x: any) {
  const raw = x?.ids || x?.meta?.ids || {}
  const imdb = x?.imdb_id || x?.imdb || raw.imdb
  const tmdbRaw = x?.tmdb_id ?? x?.tmdb ?? raw.tmdb
  const tmdb = tmdbRaw != null ? Number(String(tmdbRaw).replace(/^tmdb:/i, '')) : NaN
  const out: any = {}
  if (imdb) out.imdb = String(imdb)
  if (Number.isFinite(tmdb)) out.tmdb = tmdb
  if (raw.trakt) out.trakt = Number(raw.trakt)
  return Object.keys(out).length ? out : null
}

export async function POST(req: NextRequest) {
  try {
    const { clientId, accessToken, items } = await req.json()
    if (!clientId || !accessToken || !Array.isArray(items)) return NextResponse.json({ error: 'Client ID, Access Token e itens são obrigatórios.' }, { status: 400 })
    const movies: any[] = [], shows: any[] = []
    for (const x of items) {
      const id = ids(x); if (!id) continue
      const type = String(x?.type || x?.media_type || x?.kind || '').toLowerCase()
      const title = String(x?.title || x?.name || x?.meta?.name || '').trim()
      const year = Number(x?.year || x?.release_year || x?.releaseYear)
      const media = { ids: id, ...(title ? { title } : {}), ...(Number.isFinite(year) ? { year } : {}) }
      if (type.includes('series') || type.includes('show') || x?.series || x?.show) shows.push(media)
      else movies.push(media)
    }
    const body: any = {}; if (movies.length) body.movies = movies.slice(0, 100); if (shows.length) body.shows = shows.slice(0, 100)
    if (!body.movies && !body.shows) return NextResponse.json({ error: 'Nenhum item com IMDb/TMDB/Trakt ID reconhecível.' }, { status: 400 })
    const r = await fetch('https://api.trakt.tv/sync/collection', { method: 'POST', headers: { 'trakt-api-key': String(clientId), 'trakt-api-version': '2', Authorization: `Bearer ${String(accessToken)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return NextResponse.json({ error: data?.message || data?.error || `Trakt HTTP ${r.status}`, data }, { status: r.status === 401 ? 401 : 502 })
    return NextResponse.json({ ok: true, sent: (body.movies?.length || 0) + (body.shows?.length || 0), data })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Falha ao sincronizar com Trakt.' }, { status: 502 }) }
}
