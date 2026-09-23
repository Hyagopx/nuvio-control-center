export type Addon = Record<string, any> & {
  id?: string | number
  url?: string
  name?: string
  display_name?: string
  enabled?: boolean
  sort_order?: number
}

export type Plugin = Record<string, any> & {
  id?: string | number
  url?: string
  name?: string
  display_name?: string
  enabled?: boolean
  sort_order?: number
}

export type CatalogSettingItem = {
  addon_id: string
  type: string
  catalog_id: string
  enabled?: boolean
  order?: number
  custom_title?: string
  is_collection?: boolean
  collection_id?: string
}

export type CatalogSettings = {
  hide_unreleased_content?: boolean
  items: CatalogSettingItem[]
}

export type ProfileRecord = {
  profile: Record<string, any>
  addons: Addon[]
  plugins: Plugin[]
  collections: any[]
  watchProgress: any[]
  watchedItems: any[]
  library: any[]
  catalogSettings: CatalogSettings | null
}

export type Inventory = {
  fetchedAt: string
  account?: any
  profiles: ProfileRecord[]
  avatarCatalog?: any[]
}

export function arr<T = any>(v: any): T[] {
  return Array.isArray(v) ? v : []
}

export function normalizeCollections(raw: any): any[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray(raw.collections)) return raw.collections
  if (typeof raw === 'string') {
    try { return normalizeCollections(JSON.parse(raw)) } catch { return [] }
  }
  return []
}

export function normalizeCatalogSettings(raw: any): CatalogSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const enabledValue = (x: any) => {
    const value = x?.enabled ?? x?.is_enabled ?? x?.isEnabled
    if (typeof value === 'boolean') return value
    if (value === 0 || String(value).toLowerCase() === 'false') return false
    if (value === 1 || String(value).toLowerCase() === 'true') return true
    const disabled = x?.disabled ?? x?.is_disabled ?? x?.isDisabled
    if (typeof disabled === 'boolean') return !disabled
    if (disabled === 0 || String(disabled).toLowerCase() === 'false') return true
    if (disabled === 1 || String(disabled).toLowerCase() === 'true') return false
    return true
  }
  const items = arr(raw.items).map((x: any, i: number) => ({
    addon_id: String(x?.addon_id ?? x?.addonId ?? '').trim(),
    type: String(x?.type ?? '').trim(),
    catalog_id: String(x?.catalog_id ?? x?.catalogId ?? '').trim(),
    enabled: enabledValue(x),
    order: Number.isFinite(Number(x?.order)) ? Number(x.order) : i,
    custom_title: String(x?.custom_title ?? x?.customTitle ?? '').trim(),
    is_collection: Boolean(x?.is_collection ?? x?.isCollection),
    collection_id: String(x?.collection_id ?? x?.collectionId ?? '').trim(),
  })).filter((x: CatalogSettingItem) => x.addon_id || x.is_collection)
  return {
    hide_unreleased_content: raw.hide_unreleased_content === true,
    items,
  }
}

export function normalizeProfile(p: any, index: number): ProfileRecord {
  const profile = (p && typeof p === 'object' && p.profile && typeof p.profile === 'object') ? p.profile : (p && typeof p === 'object' ? p : {})
  return {
    profile: profile || { profile_index: index + 1, name: `Perfil ${index + 1}` },
    addons: arr<Addon>(p?.addons),
    plugins: arr<Plugin>(p?.plugins),
    collections: normalizeCollections(p?.collections),
    watchProgress: arr(p?.watchProgress),
    watchedItems: arr(p?.watchedItems),
    library: arr(p?.library),
    catalogSettings: normalizeCatalogSettings(p?.catalogSettings),
  }
}

export function normalizeInventory(raw: any): Inventory {
  const profiles = arr(raw?.profiles).map(normalizeProfile)
  return {
    fetchedAt: typeof raw?.fetchedAt === 'string' ? raw.fetchedAt : new Date().toISOString(),
    account: raw?.account,
    profiles,
    avatarCatalog: arr(raw?.avatarCatalog),
  }
}

export function profileId(p: ProfileRecord): number {
  return Number(p.profile?.profile_index ?? p.profile?.id ?? 0)
}

export function addonUrl(raw: string): string {
  let value = String(raw || '').trim()
  if (value.startsWith('stremio://')) value = value.replace(/^stremio:\/\//i, 'https://')
  if (value.endsWith('/manifest.json')) value = value.slice(0, -'/manifest.json'.length)
  return value.replace(/\/+$/, '')
}

export function addonKey(raw: string): string {
  return addonUrl(raw).toLowerCase()
}

export function catalogCloudKey(addonId: string, type: string, catalogId: string): string {
  return `${String(addonId || '').trim()}/${String(type || '').trim()}/${String(catalogId || '').trim()}`
}

function normalizedCatalogCloudKey(addonId: any, type: any, catalogId: any): string {
  return catalogCloudKey(String(addonId ?? ''), String(type ?? ''), String(catalogId ?? '')).toLocaleLowerCase()
}

function addonIdentityAliases(addon: any, manifest: any = {}): Set<string> {
  const values = [
    manifest?.id,
    addon?.manifest?.id,
    addon?.id,
    addon?.addon_id,
    addon?.addonId,
    addon?.url,
    addon?.addonUrl,
    addon?.baseUrl,
  ].map(value => String(value ?? '').trim()).filter(Boolean)
  const aliases = new Set<string>()
  for (const value of values) {
    aliases.add(value.replace(/\/+$/, '').toLocaleLowerCase())
    aliases.add(addonUrl(value).toLocaleLowerCase())
  }
  aliases.delete('')
  return aliases
}

export function legacyCatalogDisableKey(addonBaseUrl: string, type: string, catalogId: string, catalogName = ''): string {
  const base = addonUrl(addonBaseUrl).toLowerCase()
  return `${base}/${String(type || '').trim()}/${String(catalogId || '').trim()}/${String(catalogName || '').trim()}`
}

export function catalogDisableKey(addon: Addon, catalog: any, manifest: any = {}): string {
  const addonId = String(manifest?.id ?? addon?.manifest?.id ?? addon?.id ?? addon?.url ?? '').trim()
  return catalogCloudKey(addonId, String(catalog?.type ?? catalog?.apiType ?? ''), String(catalog?.id ?? ''))
}

export function catalogKey(addon: Addon, catalog: any): string {
  const manifestId = String(catalog?.addon_id ?? catalog?.addonId ?? addon?.manifest?.id ?? addon?.id ?? addon?.url ?? '')
  const id = String(catalog?.id ?? catalog?.name ?? '')
  const type = String(catalog?.type ?? '')
  return catalogCloudKey(manifestId, type, id).toLowerCase()
}

export function catalogExtraList(c: any): any[] {
  const raw = c?.extra ?? c?.extras ?? []
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') return Object.entries(raw).map(([name, value]: any) => ({ name, ...(value && typeof value === 'object' ? value : { value }) }))
  return []
}

export function catalogSupportsExtra(c: any, name: string): boolean {
  const wanted = String(name).toLowerCase()
  return catalogExtraList(c).some((x: any) => String(x?.name ?? x?.key ?? '').toLowerCase() === wanted)
    || arr(c?.extraSupported).some((x: any) => String(x).toLowerCase() === wanted)
}

export function catalogIsSearchOnly(c: any): boolean {
  const extras = catalogExtraList(c)
  return Boolean(c?.searchOnly ?? c?.search_only) || extras.some((x: any) => {
    const name = String(x?.name ?? x?.key ?? '').toLowerCase()
    const required = x?.isRequired === true || x?.required === true
    return name === 'search' && required
  })
}

export function flattenManifestCatalogs(addon: Addon, manifest: any): any[] {
  return arr(manifest?.catalogs).map((c: any, i: number) => {
    const extras = catalogExtraList(c)
    const searchOnly = catalogIsSearchOnly(c)
    const searchCapable = catalogSupportsExtra(c, 'search') || searchOnly
    const isCollection = Boolean(c?.isCollection ?? c?.is_collection ?? c?.collectionOnly ?? c?.collection_only)
    const genres = extras.find((item: any) => String(item?.name ?? '').toLowerCase() === 'genre')?.options || []
    return {
      ...c,
      key: catalogKey({ ...addon, manifest }, c),
      cloudKey: catalogCloudKey(String(manifest?.id ?? addon?.id ?? addon?.url ?? ''), String(c?.type ?? c?.apiType ?? ''), String(c?.id ?? '')),
      addonId: String(manifest?.id ?? addon?.id ?? addon?.url ?? ''),
      addonUrl: addon.url,
      addonName: addon.name || addon.display_name || manifest?.name || addon.url,
      order: i,
      searchOnly,
      searchCapable,
      isCollection,
      disableKey: catalogDisableKey(addon, c, manifest),
      legacyDisableKey: legacyCatalogDisableKey(addon.url || '', String(c?.type ?? c?.apiType ?? ''), String(c?.id ?? ''), String(c?.name ?? '')),
      genres,
      location: searchOnly ? 'search' : 'home',
      locationLabel: searchOnly ? 'Busca exclusiva' : (searchCapable ? 'Início + Busca' : 'Início'),
    }
  })
}


export function catalogSettingsForManifests(settings: CatalogSettings | null, catalogs: any[]): CatalogSettings {
  const current = settings?.items || []
  const byKey = new Map(current.map(x => [normalizedCatalogCloudKey(x.addon_id, x.type, x.catalog_id), x]))
  const catalogsByIdentity = new Map<string, any[]>()
  catalogs.forEach(c => {
    const aliases = addonIdentityAliases(c, c?.manifest)
    for (const alias of Array.from(aliases)) {
      const key = normalizedCatalogCloudKey(alias, c?.type ?? c?.apiType, c?.id)
      catalogsByIdentity.set(key, [...(catalogsByIdentity.get(key) || []), c])
    }
  })
  const homeCatalogs = catalogs.filter((c: any) => !c.searchOnly)
  const matchedLegacyKeys = new Set<string>()
  const items: CatalogSettingItem[] = homeCatalogs.map((c: any, i: number) => {
    const aliases = addonIdentityAliases(c, c?.manifest)
    // Nuvio builds the sync payload from its installed addon identity. Older cloud
    // rows can contain the addon's URL instead of manifest.id, so match either
    // representation while keeping the manifest identity as the canonical key.
    const canonicalKey = normalizedCatalogCloudKey(c.addonId, c.type ?? c.apiType, c.id)
    const savedByAlias = byKey.get(canonicalKey) || Array.from(aliases)
      .filter(alias => normalizedCatalogCloudKey(alias, c?.type ?? c?.apiType, c?.id) !== canonicalKey)
      .map(alias => byKey.get(normalizedCatalogCloudKey(alias, c?.type ?? c?.apiType, c?.id)))
      .find(Boolean)
    // Some Cloud rows use an older addon identity that is no longer present in
    // the manifest. Fall back only when type + catalog ID identify one catalog
    // uniquely across the loaded manifests; never guess when IDs collide.
    const descriptorMatches = homeCatalogs.filter(other =>
      String(other?.type ?? other?.apiType ?? '').trim().toLowerCase() === String(c?.type ?? c?.apiType ?? '').trim().toLowerCase()
      && String(other?.id ?? '').trim().toLowerCase() === String(c?.id ?? '').trim().toLowerCase())
    const savedByUniqueDescriptor = !savedByAlias && descriptorMatches.length === 1
      ? current.find(x => !x.is_collection && String(x.type || '').trim().toLowerCase() === String(c?.type ?? c?.apiType ?? '').trim().toLowerCase()
        && String(x.catalog_id || '').trim().toLowerCase() === String(c?.id ?? '').trim().toLowerCase())
      : undefined
    if (savedByUniqueDescriptor) matchedLegacyKeys.add(normalizedCatalogCloudKey(savedByUniqueDescriptor.addon_id, savedByUniqueDescriptor.type, savedByUniqueDescriptor.catalog_id))
    const saved = savedByAlias || savedByUniqueDescriptor
    return {
      addon_id: String(c.addonId),
      type: String(c.type),
      catalog_id: String(c.id),
      enabled: saved ? saved.enabled !== false : false,
      order: saved?.order ?? (current.length + i),
      custom_title: saved?.custom_title || '',
      is_collection: false,
      collection_id: '',
    }
  })
  // Keep cloud settings for catalogs whose current manifest is temporarily unavailable.
  const known = new Set(items.map(x => normalizedCatalogCloudKey(x.addon_id, x.type, x.catalog_id)))
  current.forEach(x => {
    const key = normalizedCatalogCloudKey(x.addon_id, x.type, x.catalog_id)
    if (matchedLegacyKeys.has(key)) return
    const matchingCatalog = (catalogsByIdentity.get(key) || []).find((c: any) => !c.searchOnly)
    if (matchingCatalog) return
    if (!known.has(key)) items.push(x)
  })
  return { hide_unreleased_content: settings?.hide_unreleased_content ?? false, items }
}

export function getField(x: any, keys: string[], fallback: any = undefined): any {
  for (const key of keys) {
    const v = x?.[key]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return fallback
}

export function mediaTitle(x: any): string {
  return String(getField(x, ['title','name','display_name','displayName','show_title','series_title','seriesName','metaTitle','movieTitle'], '') || getField(x?.meta, ['title','name'], '') || 'Sem título')
}

export function mediaType(x: any): string {
  return String(getField(x, ['type','media_type','mediaType','kind'], '') || (x?.series || x?.show ? 'series' : 'movie')).toLowerCase()
}

export function seriesKey(x: any): string {
  const season = getField(x, ['season','season_number','seasonNumber'], undefined)
  const episode = getField(x, ['episode','episode_number','episodeNumber'], undefined)
  const ids = [x?.series_id, x?.seriesId, x?.show_id, x?.showId, x?.series?.id, x?.show?.id, x?.meta?.series_id]
  const id = ids.find(v => v !== undefined && v !== null && String(v).trim())
  if (id) return `id:${String(id).toLowerCase()}`
  if (season !== undefined || episode !== undefined) return `title:${mediaTitle(x).trim().toLowerCase()}`
  return `title:${mediaTitle(x).trim().toLowerCase()}`
}
