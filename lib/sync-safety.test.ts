import { describe, expect, it } from 'vitest'
import { changedSections, findProfile, findProfileIndex, planSave, sameProfiles, verifySavedSections } from './sync-safety'
import type { ProfileRecord } from './nuvio'

const profile = (id: number, addonUrl: string): ProfileRecord => ({
  profile: { profile_index: id }, addons: [{ url: addonUrl, enabled: true, sort_order: 0 }],
  plugins: [], collections: [], watchProgress: [], watchedItems: [], library: [], catalogSettings: { items: [] },
})

describe('protection de sincronização', () => {
  it('detecta alterações remotas apenas nas seções que seriam gravadas', () => {
    const base = profile(1, 'https://a.example')
    const remote = { ...profile(1, 'https://b.example'), library: [{ id: 'cloud-change' }] }
    expect(changedSections(base, remote, ['addons'])).toEqual(['addons'])
    expect(changedSections(base, remote, ['plugins', 'collections'])).toEqual([])
  })

  it('localiza o perfil por índice mesmo se a ordem da lista mudar', () => {
    const profiles = [profile(3, 'https://c.example'), profile(1, 'https://a.example')]
    expect(findProfileIndex(profiles, 1)).toBe(1)
    expect(findProfile({ profiles }, 3)?.profile.profile_index).toBe(3)
  })

  it('trata um perfil ausente como conflito em vez de autorizar a gravação', () => {
    expect(changedSections(profile(1, 'https://a.example'), undefined, ['addons'])).toEqual(['addons'])
  })

  it('bloqueia a gravação se a nuvem mudou desde a última leitura', () => {
    const base = profile(1, 'https://a.example')
    const local = profile(1, 'https://b.example')
    const cloud = profile(1, 'https://c.example')
    expect(planSave(base, local, cloud, ['addons']).conflicts).toEqual(['addons'])
  })

  it('só considera a gravação confirmada quando a releitura coincide', () => {
    const expected = profile(1, 'https://b.example')
    expect(verifySavedSections(expected, profile(1, 'https://b.example'), ['addons'])).toEqual([])
    expect(verifySavedSections(expected, profile(1, 'https://c.example'), ['addons'])).toEqual(['addons'])
  })

  it('detecta criação ou edição remota de perfis antes de gravar a lista inteira', () => {
    const baseline={profiles:[profile(1,'https://a.example')]}
    expect(sameProfiles(baseline,{profiles:[profile(1,'https://a.example')]})).toBe(true)
    expect(sameProfiles(baseline,{profiles:[profile(1,'https://a.example'),profile(2,'https://b.example')]})).toBe(false)
  })
})
