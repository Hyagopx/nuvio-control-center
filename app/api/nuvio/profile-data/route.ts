import { NextRequest, NextResponse } from 'next/server'
import { nuvioCall } from '../../../../lib/nuvio-client'
import { readJsonLimited, RequestJsonError } from '../../../../lib/request-json'

const PAGE_SIZE = 100

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonLimited(req, 16_000)
    const token = String(body?.token || '')
    const profileId = Number(body?.profileId)
    const kind = String(body?.kind || '')
    const page = Math.max(1, Math.floor(Number(body?.page) || 1))
    if (!token || !Number.isInteger(profileId) || profileId < 1 || profileId > 6) return NextResponse.json({ error: 'Token e perfil válidos são obrigatórios.' }, { status: 400 })
    if (kind !== 'library' && kind !== 'history') return NextResponse.json({ error: 'Tipo de dados não suportado.' }, { status: 400 })
    if (page > 500) return NextResponse.json({ error: 'O limite de páginas foi atingido.' }, { status: 400 })
    const rows = kind === 'library'
      ? await nuvioCall('/rest/v1/rpc/sync_pull_library', token, { method: 'POST', body: JSON.stringify({ p_profile_id: profileId, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }) })
      : await nuvioCall('/rest/v1/rpc/sync_pull_watched_items', token, { method: 'POST', body: JSON.stringify({ p_profile_id: profileId, p_page: page, p_page_size: PAGE_SIZE }) })
    const items = Array.isArray(rows) ? rows : []
    return NextResponse.json({ kind, page, pageSize: PAGE_SIZE, items, hasMore: items.length === PAGE_SIZE }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao carregar os dados do perfil.' }, { status: error instanceof RequestJsonError ? error.status : 502 })
  }
}
