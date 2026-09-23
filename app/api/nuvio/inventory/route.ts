import { NextRequest, NextResponse } from 'next/server'
import { nuvioCall } from '../../../../lib/nuvio-client'

function parseCollections(value: any) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray(value.collections)) return value.collections
  if (typeof value === 'string') { try { return parseCollections(JSON.parse(value)) } catch { return [] } }
  return []
}

function parseSettings(value: any) {
  if (!value) return null
  const raw = value?.settings_json ?? value
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return null } }
  return raw && typeof raw === 'object' ? raw : null
}

async function safeSettings(token: string, id: number) {
  try {
    const rows = await nuvioCall('/rest/v1/rpc/sync_pull_home_catalog_settings', token, {
      method: 'POST', body: JSON.stringify({ p_profile_id: id, p_platform: 'home_catalog_shared' }),
    })
    return parseSettings(Array.isArray(rows) ? rows[0] : rows)
  } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json()
    if (!token) return NextResponse.json({ error: 'Token ausente.' }, { status: 401 })
    const profiles = await nuvioCall('/rest/v1/rpc/sync_pull_profiles', token, { method: 'POST', body: '{}' })
    const ps = Array.isArray(profiles) ? profiles : []
    const [lockRows, avatarRows] = await Promise.all([
      nuvioCall('/rest/v1/rpc/sync_pull_profile_locks', token, { method:'POST', body:'{}' }).catch(() => []),
      nuvioCall('/rest/v1/rpc/get_avatar_catalog', token, { method:'POST', body:'{}' }).catch(() => []),
    ])
    const lockMap = new Map((Array.isArray(lockRows)?lockRows:[]).map((x:any)=>[Number(x.profile_index ?? x.profileIndex),x.pin_enabled===true || x.pinEnabled===true]))
    const out = await Promise.all(ps.map(async (p: any) => {
      const id = Number(p?.profile_index ?? p?.id)
      if (!Number.isFinite(id) || id <= 0) return { profile: p || {}, addons: [], plugins: [], collections: [], watchProgress: [], watchedItems: [], library: [], catalogSettings: null }
      const [addons, plugins, collections, progress, history, library, catalogSettings] = await Promise.all([
        nuvioCall(`/rest/v1/addons?select=*&profile_id=eq.${id}&order=sort_order`, token),
        nuvioCall(`/rest/v1/plugins?select=*&profile_id=eq.${id}&order=sort_order`, token),
        nuvioCall('/rest/v1/rpc/sync_pull_collections', token, { method: 'POST', body: JSON.stringify({ p_profile_id: id }) }),
        nuvioCall('/rest/v1/rpc/sync_pull_watch_progress', token, { method: 'POST', body: JSON.stringify({ p_profile_id: id }) }),
        nuvioCall('/rest/v1/rpc/sync_pull_watched_items', token, { method: 'POST', body: JSON.stringify({ p_profile_id: id, p_page: 1, p_page_size: 100000 }) }),
        nuvioCall('/rest/v1/rpc/sync_pull_library', token, { method: 'POST', body: JSON.stringify({ p_profile_id: id, p_limit: 500, p_offset: 0 }) }),
        safeSettings(token, id),
      ])
      return {
        profile: { ...(p || {}), pin_enabled: lockMap.get(id)===true },
        addons: Array.isArray(addons) ? addons : [],
        plugins: Array.isArray(plugins) ? plugins : [],
        collections: parseCollections(collections?.[0]?.collections_json),
        watchProgress: Array.isArray(progress) ? progress : [],
        watchedItems: Array.isArray(history) ? history : [],
        library: Array.isArray(library) ? library : [],
        catalogSettings,
      }
    }))
    return NextResponse.json({ fetchedAt: new Date().toISOString(), profiles: out, avatarCatalog:Array.isArray(avatarRows)?avatarRows:[] })
  } catch (e: any) {
    const message = e?.message || 'Falha no inventário.'
    return NextResponse.json({ error: message }, { status: /JWT|token|unauthorized|401/i.test(message) ? 401 : 502 })
  }
}
