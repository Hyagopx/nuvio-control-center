import { NextRequest, NextResponse } from 'next/server'
import { nuvioCall } from '../../../../lib/nuvio-client'
import { readJsonLimited, RequestJsonError } from '../../../../lib/request-json'

function cleanAddon(x: any, i: number) {
  return {
    url: String(x?.url || '').trim(),
    sort_order: i,
    enabled: x?.enabled !== false,
    ...(String(x?.name || x?.display_name || '').trim() ? { name: String(x?.name || x?.display_name).trim() } : {}),
  }
}

function cleanPlugin(x: any, i: number) {
  return {
    url: String(x?.url || x?.repository || '').trim(),
    name: x?.name ?? x?.display_name ?? null,
    enabled: x?.enabled !== false,
    sort_order: i,
    repo_type: x?.repo_type ?? null,
  }
}

function parseSettings(value: any) {
  const raw = value?.settings_json ?? value
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw && typeof raw === 'object' ? raw : null
}

function settingKey(item: any) {
  if (item?.is_collection === true || item?.isCollection === true) return `collection/${String(item?.collection_id ?? item?.collectionId ?? item?.catalog_id ?? item?.catalogId ?? '').trim().toLocaleLowerCase()}`
  return [item?.addon_id ?? item?.addonId, item?.type, item?.catalog_id ?? item?.catalogId]
    .map(value => String(value ?? '').trim().toLocaleLowerCase()).join('/')
}

function verifyCatalogSettings(expected: any, actual: any) {
  const actualByKey = new Map((Array.isArray(actual?.items) ? actual.items : []).map((item: any) => [settingKey(item), item]))
  const differences: string[] = []
  for (const item of expected.items) {
    const key = settingKey(item)
    const saved: any = actualByKey.get(key)
    if (!saved) { differences.push(`${key}: ausente após releitura`); continue }
    if ((saved.enabled !== false) !== (item.enabled !== false)) differences.push(`${key}: estado ativo divergente`)
    if (Number(saved.order ?? 0) !== Number(item.order ?? 0)) differences.push(`${key}: ordem divergente`)
    if (String(saved.custom_title ?? '').trim() !== String(item.custom_title ?? '').trim()) differences.push(`${key}: título divergente`)
    if ((saved.is_collection === true || saved.isCollection === true) !== (item.is_collection === true || item.isCollection === true)) differences.push(`${key}: tipo divergente`)
    if (String(saved.collection_id ?? saved.collectionId ?? '') !== String(item.collection_id ?? item.collectionId ?? '')) differences.push(`${key}: coleção divergente`)
  }
  if ((actual?.hide_unreleased_content === true) !== (expected?.hide_unreleased_content === true)) differences.push('preferência de conteúdo não lançado divergente')
  if (!actual) differences.unshift('A Cloud não retornou a configuração de catálogos.')
  return { matches: differences.length === 0, checkedItems: expected.items.length, differences: differences.slice(0, 20) }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonLimited(req, 8_000_000)
    const token = String(body?.token || '')
    const profileId = Number(body?.profileId)
    const kind = String(body?.kind || '')
    if (!token || token.length > 16_000 || !Number.isInteger(profileId) || profileId < 1 || profileId > 6 || !kind) return NextResponse.json({ error: 'Token, profileId válido e operação são obrigatórios.' }, { status: 400 })

    if (kind === 'addons') {
      const addons = Array.isArray(body?.items) ? body.items.map(cleanAddon).filter((x: any) => x.url) : []
      await nuvioCall('/rest/v1/rpc/sync_push_addons', token, { method: 'POST', body: JSON.stringify({ p_addons: addons, p_profile_id: profileId }) })
      return NextResponse.json({ ok: true, kind, count: addons.length })
    }

    if (kind === 'plugins') {
      const plugins = Array.isArray(body?.items) ? body.items.map(cleanPlugin) : []
      await nuvioCall('/rest/v1/rpc/sync_push_plugins', token, { method: 'POST', body: JSON.stringify({ p_plugins: plugins, p_profile_id: profileId }) })
      return NextResponse.json({ ok: true, kind, count: plugins.length })
    }

    if (kind === 'collections') {
      const collections = Array.isArray(body?.items) ? body.items : []
      await nuvioCall('/rest/v1/rpc/sync_push_collections', token, { method: 'POST', body: JSON.stringify({ p_collections_json: collections, p_profile_id: profileId }) })
      return NextResponse.json({ ok: true, kind, count: collections.length })
    }

    if (kind === 'catalog-settings') {
      const settings = body?.settings && typeof body.settings === 'object' ? body.settings : null
      if (!settings || !Array.isArray(settings.items)) return NextResponse.json({ error: 'Configuração de catálogos inválida.' }, { status: 400 })
      await nuvioCall('/rest/v1/rpc/sync_push_home_catalog_settings', token, { method: 'POST', body: JSON.stringify({ p_profile_id: profileId, p_settings_json: settings, p_platform: 'home_catalog_shared' }) })
      const rows = await nuvioCall('/rest/v1/rpc/sync_pull_home_catalog_settings', token, { method: 'POST', body: JSON.stringify({ p_profile_id: profileId, p_platform: 'home_catalog_shared' }) })
      const readback = parseSettings(Array.isArray(rows) ? rows[0] : rows)
      const verification = verifyCatalogSettings(settings, readback)
      if (!verification.matches) return NextResponse.json({ ok: false, kind, error: 'A configuração foi enviada, mas a releitura da Cloud divergiu do estado esperado.', verification }, { status: 409 })
      return NextResponse.json({ ok: true, kind, count: settings.items.length, verified: true })
    }

    if (kind === 'watch-progress') {
      const entries = Array.isArray(body?.items) ? body.items : []
      await nuvioCall('/rest/v1/rpc/sync_push_watch_progress', token, { method: 'POST', body: JSON.stringify({ p_profile_id: profileId, p_entries: entries }) })
      return NextResponse.json({ ok: true, kind, count: entries.length })
    }

    if (kind === 'watched-items') {
      const items = Array.isArray(body?.items) ? body.items : []
      await nuvioCall('/rest/v1/rpc/sync_push_watched_items', token, { method: 'POST', body: JSON.stringify({ p_profile_id: profileId, p_items: items }) })
      return NextResponse.json({ ok: true, kind, count: items.length })
    }

    if (kind === 'library') {
      const items = Array.isArray(body?.items) ? body.items : []
      await nuvioCall('/rest/v1/rpc/sync_push_library', token, { method: 'POST', body: JSON.stringify({ p_profile_id: profileId, p_items: items }) })
      return NextResponse.json({ ok: true, kind, count: items.length })
    }

    if (kind === 'profile-name') {
      const name = String(body?.name || '').trim()
      if (!name) return NextResponse.json({ error: 'Nome vazio.' }, { status: 400 })
      await nuvioCall(`/rest/v1/profiles?profile_index=eq.${encodeURIComponent(profileId)}`, token, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ name }),
      })
      return NextResponse.json({ ok: true, kind, name })
    }

    if (kind === 'profile-delete') {
      if (profileId === 1) return NextResponse.json({ error: 'O perfil principal não pode ser excluído.' }, { status: 400 })
      const remoteProfiles = await nuvioCall('/rest/v1/rpc/sync_pull_profiles', token, { method: 'POST', body: '{}' })
      const currentProfiles = Array.isArray(remoteProfiles) ? remoteProfiles : []
      if (currentProfiles.length <= 1) return NextResponse.json({ error: 'A conta precisa manter pelo menos um perfil.' }, { status: 409 })
      if (!currentProfiles.some((profile: any) => Number(profile?.profile_index ?? profile?.id) === profileId)) return NextResponse.json({ error: 'O perfil já não existe na conta.' }, { status: 404 })
      await nuvioCall(`/rest/v1/profiles?profile_index=eq.${encodeURIComponent(profileId)}`, token, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
      return NextResponse.json({ ok: true, kind, profileId })
    }

    if (kind === 'profiles') {
      const profiles = Array.isArray(body?.profiles) ? body.profiles : null
      if (!profiles || profiles.length < 1 || profiles.length > 6) return NextResponse.json({ error: 'A conta deve ter de 1 a 6 perfis.' }, { status: 400 })
      const seen = new Set<number>()
      const normalized = profiles.map((p:any) => {
        const id = Number(p?.profile_index)
        const name = String(p?.name || '').trim()
        if (!Number.isInteger(id) || id < 1 || id > 6 || !name || seen.has(id)) throw new Error('Índice ou nome de perfil inválido.')
        seen.add(id)
        return {
          profile_index: id, name,
          avatar_color_hex: String(p?.avatar_color_hex || '#8b5cf6'),
          uses_primary_addons: p?.uses_primary_addons === true,
          uses_primary_plugins: p?.uses_primary_plugins === true,
          avatar_id: String(p?.avatar_id || '').trim() || null,
          avatar_url: String(p?.avatar_url || '').trim() || null,
          profile_background_id: String(p?.profile_background_id || '').trim() || null,
          profile_background_url: String(p?.profile_background_url || '').trim() || null,
        }
      })
      await nuvioCall('/rest/v1/rpc/sync_push_profiles', token, { method:'POST', body:JSON.stringify({ p_client_max_profiles:6, p_profiles:normalized }) })
      return NextResponse.json({ ok:true, kind, count:normalized.length })
    }

    if (kind === 'profile-pin') {
      const pin = String(body?.pin || '').trim()
      if (!/^\d{4,8}$/.test(pin)) return NextResponse.json({ error:'Use um PIN numérico de 4 a 8 dígitos.' }, { status:400 })
      await nuvioCall('/rest/v1/rpc/set_profile_pin', token, { method:'POST', body:JSON.stringify({ p_profile_id:profileId, p_pin:pin, ...(String(body?.currentPin || '').trim() ? { p_current_pin:String(body.currentPin).trim() } : {}) }) })
      return NextResponse.json({ ok:true, kind })
    }

    if (kind === 'profile-pin-clear') {
      await nuvioCall('/rest/v1/rpc/clear_profile_pin', token, { method:'POST', body:JSON.stringify({ p_profile_id:profileId, ...(String(body?.currentPin || '').trim() ? { p_current_pin:String(body.currentPin).trim() } : {}) }) })
      return NextResponse.json({ ok:true, kind })
    }

    return NextResponse.json({ error: 'Operação não suportada.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Falha ao salvar alterações.' }, { status: e instanceof RequestJsonError ? e.status : 502 })
  }
}
