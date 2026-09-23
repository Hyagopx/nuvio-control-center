import { addonKey, normalizeCatalogSettings, profileId, type ProfileRecord } from './nuvio'

export type WritableSection = 'addons' | 'plugins' | 'collections' | 'catalogSettings' | 'library' | 'watchProgress' | 'watchedItems'

const labels: Record<WritableSection, string> = {
  addons: 'addons', plugins: 'plugins', collections: 'coleções', catalogSettings: 'catálogos',
  library: 'biblioteca', watchProgress: 'progresso', watchedItems: 'histórico de assistidos',
}

function stable(value: any): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.keys(item).sort().reduce((result: any, key) => { result[key] = item[key]; return result }, {})
    : item)
}

function sectionValue(profile: ProfileRecord, section: WritableSection): any {
  if (section === 'addons') return profile.addons.map((item, index) => ({ key: addonKey(item.url || ''), name: item.name || item.display_name || '', enabled: item.enabled !== false, order: Number(item.sort_order ?? index) }))
  if (section === 'plugins') return profile.plugins.map((item: any, index: number) => ({ key: addonKey(item.url || item.repository || ''), name: item.name || item.display_name || '', enabled: item.enabled !== false, order: Number(item.sort_order ?? index) }))
  if (section === 'catalogSettings') return normalizeCatalogSettings(profile.catalogSettings)
  return (profile as any)[section]
}

export function changedSections(expected: ProfileRecord | undefined, actual: ProfileRecord | undefined, sections: WritableSection[]): WritableSection[] {
  if (!expected || !actual) return [...sections]
  return sections.filter(section => stable(sectionValue(expected, section)) !== stable(sectionValue(actual, section)))
}

export function planSave(baseline: ProfileRecord | undefined, local: ProfileRecord, cloud: ProfileRecord | undefined, sections: WritableSection[]) {
  const intended = changedSections(baseline, local, sections)
  return { intended, conflicts: changedSections(baseline, cloud, intended) }
}

export function verifySavedSections(expected: ProfileRecord, actual: ProfileRecord | undefined, sections: WritableSection[]) {
  return changedSections(expected, actual, sections)
}

export function describeSections(sections: WritableSection[]): string {
  return sections.map(section => labels[section]).join(', ')
}

export function findProfileIndex(profiles: ProfileRecord[], id: number): number {
  return profiles.findIndex(profile => profileId(profile) === id)
}

export function findProfile(inventory: { profiles: ProfileRecord[] }, id: number): ProfileRecord | undefined {
  return inventory.profiles[findProfileIndex(inventory.profiles, id)]
}

export function sameProfiles(left: { profiles: ProfileRecord[] } | null | undefined, right: { profiles: ProfileRecord[] } | null | undefined): boolean {
  if (!left || !right) return false
  const pick = (profile: ProfileRecord) => {
    const p = profile.profile || {}
    return { id: profileId(profile), name: p.name || '', avatarId: p.avatar_id || p.avatarId || '', avatarUrl: p.avatar_url || p.avatarUrl || '', avatarColor: p.avatar_color_hex || p.avatarColorHex || '', usesPrimaryAddons: p.uses_primary_addons === true, usesPrimaryPlugins: p.uses_primary_plugins === true, backgroundId: p.profile_background_id || '', backgroundUrl: p.profile_background_url || '' }
  }
  return stable(left.profiles.map(pick).sort((a,b)=>a.id-b.id)) === stable(right.profiles.map(pick).sort((a,b)=>a.id-b.id))
}
