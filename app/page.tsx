'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addonKey, addonUrl, catalogCloudKey, catalogSettingsForManifests, flattenManifestCatalogs,
  getField, mediaTitle, mediaType, normalizeCollections, normalizeInventory, profileId, seriesKey,
  type Addon, type CatalogSettings, type Inventory, type ProfileRecord,
} from '../lib/nuvio'
import { changedSections, describeSections, findProfile, findProfileIndex, planSave, sameProfiles, verifySavedSections, type WritableSection } from '../lib/sync-safety'
import { readLocalSnapshots, storeLocalSnapshot } from '../lib/local-snapshots'
import { LibraryPage, WatchPage } from '../components/screens/ProfileDataScreens'

const NAV = [
  ['overview', 'Visão geral', 'Resumo da conta'],
  ['addons', 'Addons', 'Extensões instaladas'],
  ['catalogs', 'Catálogos', 'Todos os catálogos'],
  ['plugins', 'Plugins', 'Extensões de serviço'],
  ['collections', 'Coleções', 'Coleções e organização'],
  ['watch', 'Progresso', 'Progresso e histórico'],
  ['library', 'Biblioteca', 'Itens salvos e Trakt'],
] as const

const EMPTY_PROFILE: ProfileRecord = { profile: {}, addons: [], plugins: [], collections: [], watchProgress: [], watchedItems: [], library: [], catalogSettings: null }
type Snapshot = { schemaVersion: number; exportedAt: string; source: string; inventory: Inventory }
type Health = { health?: 'healthy' | 'attention' | 'fail' | 'unknown'; latencyMs?: number; error?: string; healthReason?: string; manifest?: any; catalogTests?: any[]; summary?: any; phase?: string }
type Session = { email: string; refresh_token: string }

function recordManifestChange(profile:number,url:string,manifest:any){
  const fingerprint=(value:any)=>{const stable=(v:any):string=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o:any,key)=>{o[key]=x[key];return o},{ }):x);let hash=2166136261;for(const char of stable(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(16)}
  const key=`nuvio-manifest:${profile}:${addonKey(url)}`,version=String(manifest?.version||'');const next={fingerprint:fingerprint(manifest),version,observedAt:new Date().toISOString()}
  try{const previous=JSON.parse(localStorage.getItem(key)||'null');localStorage.setItem(key,JSON.stringify(next));if(!previous)return{state:'first',version};return{state:previous.fingerprint===next.fingerprint?'same':'changed',previousVersion:String(previous.version||''),version,observedAt:previous.observedAt}}catch{return{state:'unavailable',version}}
}


export default function Home() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [booting, setBooting] = useState(true)
  const [inv, setInv] = useState<Inventory | null>(null)
  const [active, setActive] = useState(0)
  const [tab, setTab] = useState('overview')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [utilitiesOpen, setUtilitiesOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [profileDataLoading, setProfileDataLoading] = useState<'library'|'history'|null>(null)
  const [profileDataError, setProfileDataError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [diagnosticsByProfile, setDiagnosticsByProfile] = useState<Record<string, Record<string, Health>>>({})
  const [diagnosticLoadingByProfile, setDiagnosticLoadingByProfile] = useState<Record<string, boolean>>({})
  const [diagnosticProgressByProfile, setDiagnosticProgressByProfile] = useState<Record<string, { completed: number; total: number }>>({})
  const diagnosticRunsRef = useRef(new Map<string, number>())
  const diagnosticSessionRef = useRef(0)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<any | null>(null)
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [compare, setCompare] = useState<Inventory | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profileModal, setProfileModal] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileManagerOpen, setProfileManagerOpen] = useState(false)
  const [profileFormOpen, setProfileFormOpen] = useState(false)
  const [profileEditIndex, setProfileEditIndex] = useState<number | null>(null)
  const [profileDraft, setProfileDraft] = useState({ name: '', avatarId: '', avatarUrl: '', avatarColorHex: '#8b5cf6', pin: '', currentPin: '' })
  const [addonModal, setAddonModal] = useState<{ mode: 'add' | 'edit'; item?: Addon } | null>(null)
  const [addonTransfer, setAddonTransfer] = useState<{ item: Addon; sourceIndex: number } | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [collectionModal, setCollectionModal] = useState<any | null>(null)
  const [collectionImportOpen, setCollectionImportOpen] = useState(false)
  const [transferFileOpen, setTransferFileOpen] = useState(false)
  const [transferPackage, setTransferPackage] = useState<any | null>(null)
  const transferFileRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const collectionFileRef = useRef<HTMLInputElement>(null)
  const serverBaselineRef = useRef<Inventory | null>(null)
  const profileDataRequestRef = useRef<string | null>(null)

  const p = inv?.profiles?.[active] || inv?.profiles?.[0] || EMPTY_PROFILE
  const activeProfileKey = String(profileId(p))
  const diag = diagnosticsByProfile[activeProfileKey] || {}
  const diagLoading = diagnosticLoadingByProfile[activeProfileKey] === true
  const diagProgress = diagnosticProgressByProfile[activeProfileKey] || { completed: 0, total: 0 }
  const counts = { addons: p.addons.length, plugins: p.plugins.length, collections: p.collections.length, progress: p.watchProgress.length, library: p.libraryLoaded === false ? '—' : p.library.length, watched: p.watchedItemsLoaded === false ? '—' : p.watchedItems.length }
  function installServerInventory(fresh:Inventory) { serverBaselineRef.current = structuredClone(fresh); setInv(fresh) }

  useEffect(() => {
    const raw = localStorage.getItem('nuvio-session')
    if (!raw) { setBooting(false); return }
    try {
      const session: Session = JSON.parse(raw)
      setEmail(session.email)
      fetch('/api/nuvio/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) })
        .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Sessão expirada'); return d })
        .then(async d => {
          setToken(d.access_token); setRefreshToken(d.refresh_token || session.refresh_token)
          localStorage.setItem('nuvio-session', JSON.stringify({ email: session.email, refresh_token: d.refresh_token || session.refresh_token }))
          const next = await fetchInventoryStatic(d.access_token)
          installServerInventory(next)
        })
        .catch(() => localStorage.removeItem('nuvio-session'))
        .finally(() => setBooting(false))
    } catch { localStorage.removeItem('nuvio-session'); setBooting(false) }
  }, [])

  useEffect(() => {
    const handler=(e:BeforeUnloadEvent)=>{ if(dirty){ e.preventDefault(); e.returnValue='Você tem alterações não salvas.' } }
    window.addEventListener('beforeunload',handler)
    return ()=>window.removeEventListener('beforeunload',handler)
  },[dirty])

  useEffect(() => {
    if (!inv || !token || (tab !== 'catalogs' && tab !== 'addons')) return
    if (!p.addons.some(addon => addon.url && !diag[addon.url])) return
    void diagnose(p.addons, true)
  }, [tab, inv, token, activeProfileKey, diag])

  useEffect(() => {
    if (tab === 'library' && p.libraryLoaded === false && !profileDataLoading && !profileDataError) void loadProfileData('library', false)
    if (tab === 'watch' && p.watchedItemsLoaded === false && !profileDataLoading && !profileDataError) void loadProfileData('history', false)
  }, [tab, active, token, p.libraryLoaded, p.watchedItemsLoaded, profileDataLoading, profileDataError])

  async function fetchInventoryStatic(accessToken: string) {
    const r = await fetch('/api/nuvio/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: accessToken }) })
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha ao carregar inventário')
    return normalizeInventory(d)
  }
  async function fetchInventory(accessToken = token) { if (!accessToken) throw new Error('Sessão Nuvio não disponível.'); return fetchInventoryStatic(accessToken) }

  async function fetchAllProfileData(kind:'library'|'history', id:number) {
    const all:any[]=[]
    for(let page=1;page<=500;page++){
      const response=await fetch('/api/nuvio/profile-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,profileId:id,kind,page})})
      const data=await response.json();if(!response.ok)throw new Error(data.error||`Falha ao exportar ${kind}.`)
      all.push(...data.items)
      if(!data.hasMore)return all
    }
    throw new Error(`O limite de páginas foi atingido ao exportar ${kind}.`)
  }

  async function completeInventoryForBackup(source:Inventory) {
    if(!token)return source
    const profiles=[]
    for(const record of source.profiles){
      const next={...record}
      if(next.libraryLoaded===false){next.library=await fetchAllProfileData('library',profileId(record));next.libraryLoaded=true;next.libraryPage=Math.ceil(next.library.length/100);next.libraryHasMore=false}
      if(next.watchedItemsLoaded===false){next.watchedItems=await fetchAllProfileData('history',profileId(record));next.watchedItemsLoaded=true;next.watchedItemsPage=Math.ceil(next.watchedItems.length/100);next.watchedItemsHasMore=false}
      profiles.push(next)
    }
    return {...source,profiles}
  }

  async function loadProfileData(kind:'library'|'history', append=true) {
    if (!token || !inv || profileDataRequestRef.current) return
    const profile = inv.profiles[active]
    if (!profile) return
    const id = profileId(profile)
    const loaded = kind === 'library' ? profile.libraryLoaded : profile.watchedItemsLoaded
    const hasMore = kind === 'library' ? profile.libraryHasMore : profile.watchedItemsHasMore
    if (append && loaded && !hasMore) return
    const page = append ? ((kind === 'library' ? profile.libraryPage : profile.watchedItemsPage) || 0) + 1 : 1
    profileDataRequestRef.current=`${id}:${kind}:${page}`
    setProfileDataLoading(kind); setProfileDataError('')
    try {
      const response = await fetch('/api/nuvio/profile-data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token,profileId:id,kind,page}) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Falha ao carregar os dados do perfil.')
      setInv(current => {
        if (!current) return current
        const index = findProfileIndex(current.profiles, id)
        if (index < 0) return current
        const profiles = [...current.profiles], existing = profiles[index]
        if (kind === 'library') profiles[index] = { ...existing, library: append ? [...existing.library, ...data.items] : data.items, libraryLoaded:true, libraryPage:data.page, libraryHasMore:data.hasMore }
        else profiles[index] = { ...existing, watchedItems: append ? [...existing.watchedItems, ...data.items] : data.items, watchedItemsLoaded:true, watchedItemsPage:data.page, watchedItemsHasMore:data.hasMore }
        return { ...current, profiles }
      })
    } catch (e:any) { setProfileDataError(e.message || 'Falha ao carregar os dados do perfil.') }
    finally { profileDataRequestRef.current=null; setProfileDataLoading(null) }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(''); setNotice('')
    diagnosticSessionRef.current++
    diagnosticRunsRef.current.clear()
    setDiagnosticsByProfile({}); setDiagnosticLoadingByProfile({}); setDiagnosticProgressByProfile({})
    try {
      const r = await fetch('/api/nuvio/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha no login')
      const next = await fetchInventory(d.access_token)
      setToken(d.access_token); setRefreshToken(d.refresh_token || ''); installServerInventory(next); setPassword(''); setActive(0); setTab('overview'); setDirty(false)
      if (remember && d.refresh_token) localStorage.setItem('nuvio-session', JSON.stringify({ email, refresh_token: d.refresh_token }))
      else localStorage.removeItem('nuvio-session')
    } catch (e: any) { setError(e.message || 'Erro') } finally { setLoading(false) }
  }

  function makeSnapshot(customInv = inv): Snapshot { return { schemaVersion: 4, exportedAt: new Date().toISOString(), source: 'Nuvio Control Center v0.11.5', inventory: customInv || { fetchedAt: new Date().toISOString(), profiles: [] } } }
  function persistSnapshot(customInv = inv, label = '') {
    if (!customInv) return false
    const partialSections=partialSectionsFor(customInv)
    return storeLocalSnapshot(localStorage, { ...makeSnapshot(customInv), label, partialSections }).saved
  }
  function partialSectionsFor(customInv:Inventory) { return customInv.profiles.flatMap(profile=>[
      ...(profile.libraryLoaded===false?[`library:${profileId(profile)}`]:[]),
      ...(profile.watchedItemsLoaded===false?[`watchedItems:${profileId(profile)}`]:[]),
    ]) }
  async function saveSnapshotLocal() { if (!inv) return; setNotice('Preparando backup local…'); try { const complete=await completeInventoryForBackup(inv), partial=partialSectionsFor(complete), result=storeLocalSnapshot(localStorage,{...makeSnapshot(complete),label:'backup manual',partialSections:partial}); setNotice(!result.saved?'O navegador não tem espaço livre para guardar este backup. Exporte um arquivo para manter uma cópia.':partial.length?'Backup local salvo, mas é parcial porque alguns dados não estão disponíveis nesta sessão.':'Backup local completo salvo no navegador.') } catch(e:any) { setNotice(e.message||'Não foi possível concluir o backup local.') } setSnapshotOpen(true) }
  async function downloadSnapshot(customInv = inv) {
    if (!customInv) return
    try { const complete=await completeInventoryForBackup(customInv); const partial=partialSectionsFor(complete); const b = new Blob([JSON.stringify({...makeSnapshot(complete),partialSections:partial}, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `nuvio-backup-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 500); if(partial.length)setNotice('Backup exportado parcialmente; ele indica os dados que não estavam carregados.') } catch(e:any) { setError(e.message||'Falha ao exportar backup completo.') }
  }
  function importSnapshot(file: File) {
    const reader = new FileReader(); reader.onload = () => { try { const raw = JSON.parse(String(reader.result)); const data = normalizeInventory(raw?.inventory?.profiles ? raw.inventory : raw); serverBaselineRef.current = null; setInv(data); setToken(''); setRefreshToken(''); setEmail(''); setActive(0); setTab('overview'); setSelected(null); setImportOpen(false); setDirty(false); setError(''); setNotice('Backup aberto somente para consulta. Ele não altera a conta.'); } catch (e: any) { setError(e.message || 'Backup inválido.') } }; reader.readAsText(file)
  }
  function openCompare() { const saved = readLocalSnapshots(localStorage); if (saved.length) { setCompare(normalizeInventory(saved[0].inventory)); setNotice(saved[0].partialSections?.length?`Este snapshot local é parcial; ainda não incluía ${saved[0].partialSections.length} conjunto(s) que não haviam sido carregados.`:'Snapshot completo carregado para comparação.'); setSnapshotOpen(true) } else setError('Ainda não há backups locais.') }

  function sanitizeTransferPart(kind: string, value: any) {
    if (kind === 'addons') return (Array.isArray(value) ? value : []).map((x:any,i:number)=>({ url: addonUrl(x?.url || ''), name: String(x?.name || x?.display_name || ''), enabled: x?.enabled !== false, sort_order: i })).filter((x:any)=>x.url)
    if (kind === 'plugins') return (Array.isArray(value) ? value : []).map((x:any,i:number)=>({ url: String(x?.url || x?.repository || ''), name: String(x?.name || x?.display_name || ''), enabled: x?.enabled !== false, sort_order: i })).filter((x:any)=>x.url)
    return structuredClone(value ?? [])
  }
  function downloadTransferPackage(parts: Record<string,boolean>) {
    if (!inv) return
    const source = p
    const packageData = { schemaVersion: 1, kind: 'nuvio-transfer-package', exportedAt: new Date().toISOString(), source: 'Nuvio Control Center v0.11.5', profile: { name: profileLabel, profile_index: profileId(source) }, parts: Object.fromEntries(Object.entries(parts).filter(([,v])=>v).map(([k])=>[k, sanitizeTransferPart(k, (source as any)[k === 'catalogs' ? 'catalogSettings' : k])])), note: 'Pacote sem senhas. Addons são exportados somente com URL, nome, estado e ordem.' }
    const b = new Blob([JSON.stringify(packageData,null,2)], {type:'application/json'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=`nuvio-transfer-${String(profileLabel).replace(/[^a-z0-9_-]+/gi,'-')}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(u),500)
  }
  function openTransferPackage(file: File) {
    const reader = new FileReader(); reader.onload=()=>{ try { const raw=JSON.parse(String(reader.result)); if(raw?.kind!=='nuvio-transfer-package' || !raw?.parts) throw new Error('Este arquivo não é um pacote de transferência do Nuvio Control Center.'); setTransferPackage(raw); setTransferFileOpen(true) } catch(e:any){setError(e.message||'Pacote inválido.')} }; reader.readAsText(file)
  }
  async function applyTransferPackage(pkg:any, selectedParts: Record<string,boolean>, mode:'merge'|'replace') {
    if (!token) { setError('Conecte uma conta Nuvio destino antes de importar.'); return }
    setSaving(true); setError(''); let completed:string[]=[]
    try {
      const completeBackup=await completeInventoryForBackup(inv!)
      persistSnapshot(completeBackup, 'backup antes da importação de pacote')
      const latest=await fetchInventory(token), cloudProfile=findProfile(latest,profileId(p))
      if(!cloudProfile)throw new Error('O perfil destino não existe mais na conta.')
      const baselineProfile=findProfile(serverBaselineRef.current||{profiles:[]},profileId(p))
      const selectedSections:WritableSection[]=[]
      if(selectedParts.addons)selectedSections.push('addons')
      if(selectedParts.plugins)selectedSections.push('plugins')
      if(selectedParts.collections)selectedSections.push('collections')
      if(selectedParts.catalogs)selectedSections.push('catalogSettings')
      if(selectedParts.library)selectedSections.push('library')
      if(selectedParts.progress)selectedSections.push('watchProgress')
      if(selectedParts.history)selectedSections.push('watchedItems')
      const conflicts=changedSections(baselineProfile,cloudProfile,selectedSections.filter(x=>x!=='library'&&x!=='watchedItems'))
      if(conflicts.length)throw new Error(`O perfil mudou na nuvem (${describeSections(conflicts)}). Nenhuma parte do pacote foi aplicada; releia a conta antes de tentar novamente.`)
      const next = structuredClone(cloudProfile) as ProfileRecord
      const part = (k:string) => pkg.parts?.[k]
      if (selectedParts.addons && Array.isArray(part('addons'))) next.addons = mode==='replace' ? part('addons') : mergeByUrl(next.addons, part('addons'))
      if (selectedParts.plugins && Array.isArray(part('plugins'))) next.plugins = mode==='replace' ? part('plugins') : mergeByUrl(next.plugins, part('plugins'))
      if (selectedParts.collections && Array.isArray(part('collections'))) next.collections = mode==='replace' ? part('collections') : mergeCollections(next.collections, part('collections'))
      if (selectedParts.library && Array.isArray(part('library'))) { next.library = await fetchAllProfileData('library',profileId(p)); next.library = mode==='replace' ? part('library') : mergeByIdentity(next.library, part('library')); next.libraryLoaded=true }
      if (selectedParts.progress && Array.isArray(part('watchProgress'))) next.watchProgress = mode==='replace' ? part('watchProgress') : mergeByIdentity(next.watchProgress, part('watchProgress'))
      if (selectedParts.history && Array.isArray(part('watchedItems'))) { next.watchedItems = await fetchAllProfileData('history',profileId(p)); next.watchedItems = mode==='replace' ? part('watchedItems') : mergeByIdentity(next.watchedItems, part('watchedItems')); next.watchedItemsLoaded=true }
      if (selectedParts.catalogs && part('catalogs')) next.catalogSettings = mergeCatalogSettings(next.catalogSettings, part('catalogs'), mode)
      const kinds: Array<[string,any]> = [['addons',next.addons],['plugins',next.plugins],['collections',next.collections],['catalog-settings',next.catalogSettings],['library',next.library],['watch-progress',next.watchProgress],['watched-items',next.watchedItems]]
      for (const [kind,items] of kinds) { const key = kind==='catalog-settings'?'catalogs':kind==='watch-progress'?'progress':kind==='watched-items'?'history':kind; if (!selectedParts[key]) continue; const r=await fetch('/api/nuvio/mutate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,profileId:profileId(p),kind,items,settings:kind==='catalog-settings'?items:undefined})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||`Falha ao importar ${key}`);completed.push(key) }
      const fresh=await fetchInventory(token),savedProfile=findProfile(fresh,profileId(p))
      if(savedProfile&&selectedParts.library){savedProfile.library=await fetchAllProfileData('library',profileId(p));savedProfile.libraryLoaded=true}
      if(savedProfile&&selectedParts.history){savedProfile.watchedItems=await fetchAllProfileData('history',profileId(p));savedProfile.watchedItemsLoaded=true}
      const differences=verifySavedSections(next,savedProfile,selectedSections)
      if(differences.length)throw new Error(`A nuvem foi relida, mas não confirmou: ${describeSections(differences)}.`)
      installServerInventory(fresh); setDirty(false); setTransferFileOpen(false); setTransferPackage(null); setNotice('Pacote importado, salvo e verificado na conta atual.')
    } catch(e:any){if(completed.length){try{const fresh=await fetchInventory(token);installServerInventory(fresh)}catch{};setError(`${e.message||'Falha na importação'} Partes enviadas: ${completed.join(', ')}. A conta foi relida; confira as partes restantes antes de tentar novamente.`)}else setError(e.message||'Falha na importação')} finally {setSaving(false)}
  }

  async function diagnose(rows: Addon[], onlyMissing = false) {
    const urls = rows.map(x => x.url).filter((url): url is string => typeof url === 'string' && url.length > 0); if (!urls.length) return
    const profileKey = activeProfileKey
    if (diagnosticRunsRef.current.has(profileKey)) return
    const existing = diagnosticsByProfile[profileKey] || {}
    const targets = onlyMissing ? urls.filter(url => !existing[url]) : urls
    if (!targets.length) return
    const diagnosticSession = diagnosticSessionRef.current
    diagnosticRunsRef.current.set(profileKey, diagnosticSession)
    setDiagnosticLoadingByProfile(previous => ({ ...previous, [profileKey]: true })); setError(''); setNotice('')
    const setRunProgress = (progress: { completed: number; total: number }) => {
      if (diagnosticSessionRef.current === diagnosticSession) setDiagnosticProgressByProfile(previous => ({ ...previous, [profileKey]: progress }))
    }
    setRunProgress({ completed: 0, total: targets.length })
    const applyResult = (raw: any, phase = 'complete') => {
      if (diagnosticSessionRef.current !== diagnosticSession) return
      const result = { ...raw, phase: raw.phase || phase }
      if (result.manifest) result.manifestChange = recordManifestChange(Number(profileKey), result.url, result.manifest)
      setDiagnosticsByProfile(previous => ({ ...previous, [profileKey]: { ...(previous[profileKey] || {}), [result.url]: result } }))
    }
    try {
      const r = await fetch('/api/nuvio/diagnose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: targets }) })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Falha no diagnóstico') }
      if (!r.body || typeof r.body.getReader !== 'function') {
        const fallback = await fetch('/api/nuvio/diagnose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: targets, stream: false }) })
        const data = await fallback.json()
        if (!fallback.ok) throw new Error(data.error || 'Falha no diagnóstico')
        for (const result of data.results || []) applyResult(result)
        setRunProgress({ completed: targets.length, total: targets.length })
        if (diagnosticSessionRef.current === diagnosticSession) setNotice(`Diagnóstico atualizado para ${(data.results || []).length} addon(s).`)
        return
      }
      const reader = r.body.getReader(), decoder = new TextDecoder()
      let buffer = '', receivedDone = false
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || ''
        for (const event of events) {
          const dataLine = event.split(/\r?\n/).find(line => line.startsWith('data:'))
          if (!dataLine) continue
          const message = JSON.parse(dataLine.slice(5).trim())
          if (message.type === 'progress') setRunProgress({ completed: message.completed, total: message.total })
          if (message.type === 'result') {
            applyResult(message.result, message.phase)
          }
          if (message.type === 'error') throw new Error(message.error || 'Falha no diagnóstico')
          if (message.type === 'done') {
            receivedDone = true
            setRunProgress({ completed: message.completed, total: message.total })
            if (diagnosticSessionRef.current === diagnosticSession) setNotice(`Diagnóstico atualizado para ${message.completed} addon(s).`)
          }
        }
        if (done) break
      }
      if (!receivedDone) throw new Error('O fluxo do diagnóstico terminou antes de confirmar todos os resultados.')
    } catch (e: any) {
      try {
        const fallback = await fetch('/api/nuvio/diagnose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: targets, stream: false }) })
        const data = await fallback.json()
        if (!fallback.ok) throw new Error(data.error || 'Falha no diagnóstico')
        for (const result of data.results || []) applyResult(result)
        setRunProgress({ completed: targets.length, total: targets.length })
        if (diagnosticSessionRef.current === diagnosticSession) setNotice(`Diagnóstico atualizado para ${(data.results || []).length} addon(s).`)
      } catch (fallbackError: any) { if (diagnosticSessionRef.current === diagnosticSession) setError(fallbackError.message || e.message || 'Falha no diagnóstico') }
    } finally {
      if (diagnosticRunsRef.current.get(profileKey) === diagnosticSession) diagnosticRunsRef.current.delete(profileKey)
      if (diagnosticSessionRef.current === diagnosticSession) setDiagnosticLoadingByProfile(previous => ({ ...previous, [profileKey]: false }))
    }
  }
  function updateProfile(mutator: (current: ProfileRecord) => ProfileRecord) { if (!inv) return; const profiles = inv.profiles.map((x, i) => i === active ? mutator(x) : x); setInv({ ...inv, fetchedAt: new Date().toISOString(), profiles }); setDirty(true) }
  async function selectProfile(index:number) {
    if (index === active) return
    if (dirty) {
      if (!token || !window.confirm('Há alterações não salvas. Deseja descartá-las e trocar de perfil?')) return
      try {
        const targetId = inv?.profiles[index] ? profileId(inv.profiles[index]) : null
        const fresh = await fetchInventory(token)
        const freshIndex = fresh.profiles.findIndex(x => profileId(x) === targetId)
        if (freshIndex < 0) throw new Error('O perfil selecionado não foi encontrado na conta atualizada.')
        installServerInventory(fresh); setActive(freshIndex); setDirty(false); setNotice('Alterações locais descartadas; dados atualizados da conta.')
      } catch (e:any) { setError(e.message || 'Não foi possível descartar as alterações.'); return }
    } else setActive(index)
    setSelected(null); setQuery(''); setProfileDataError('')
  }

  async function saveKind(kind: 'addons' | 'plugins' | 'collections', itemsOverride?: any[]) {
    if (!token) { setError('Snapshot é somente leitura.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      persistSnapshot(inv, `antes de salvar ${kind}`)
      const items = itemsOverride || (kind === 'addons' ? p.addons : kind === 'plugins' ? p.plugins : p.collections)
      const r = await fetch('/api/nuvio/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, profileId: profileId(p), kind, items }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha ao salvar')
      const fresh = await fetchInventory(token); installServerInventory(fresh); setDirty(false); setNotice(`${kind === 'addons' ? 'Addons' : kind === 'plugins' ? 'Plugins' : 'Collections'} salvos e relidos da conta.`)
    } catch (e: any) { setError(e.message || 'Falha ao salvar') } finally { setSaving(false) }
  }
  async function saveCatalogSettings(settings: CatalogSettings) {
    if (!token) { setError('Snapshot é somente leitura.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      persistSnapshot(inv, 'antes de salvar catálogos')
      const baseline = serverBaselineRef.current
      const latest = await fetchInventory(token)
      const baselineProfile = findProfile(baseline || { profiles: [] }, profileId(p))
      const cloudProfile = findProfile(latest, profileId(p))
      const conflicts = changedSections(baselineProfile, cloudProfile, ['catalogSettings'])
      if (conflicts.length) throw new Error(`A nuvem mudou os ${describeSections(conflicts)} em outro dispositivo. Seu rascunho foi mantido; releia a conta antes de tentar novamente.`)
      const r = await fetch('/api/nuvio/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, profileId: profileId(p), kind: 'catalog-settings', settings }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha ao salvar catálogos')
      const fresh = await fetchInventory(token)
      const savedProfile = findProfile(fresh, profileId(p))
      if (changedSections({ ...p, catalogSettings: settings }, savedProfile, ['catalogSettings']).length) throw new Error('Os catálogos foram enviados, mas a releitura não confirmou os mesmos dados. O rascunho foi mantido.')
      installServerInventory(fresh); setDirty(false); setNotice('Catálogos salvos e confirmados por releitura da conta.')
    } catch (e: any) { setError(e.message || 'Falha ao salvar catálogos') } finally { setSaving(false) }
  }
  async function saveAll() {
    if (!token) { setError('Snapshot é somente leitura.'); return }
    setSaving(true); setError(''); setNotice('')
    let completed: string[] = []
    try {
      persistSnapshot(inv, 'backup antes de salvar todas as alterações')
      const settings = buildCatalogSettings(p,diag)
      const candidate = { ...p, catalogSettings: settings }
      const sections: WritableSection[] = ['addons','plugins','collections','catalogSettings']
      const baseline = serverBaselineRef.current
      const latest = await fetchInventory(token)
      const baselineProfile = findProfile(baseline || { profiles: [] }, profileId(p))
      const cloudProfile = findProfile(latest, profileId(p))
      const { intended, conflicts } = planSave(baselineProfile, candidate, cloudProfile, sections)
      if (conflicts.length) throw new Error(`A nuvem mudou ${describeSections(conflicts)} em outro dispositivo. Nenhuma alteração foi enviada; seu rascunho foi mantido. Releia a conta para resolver o conflito.`)
      const kindBySection: Record<WritableSection,string> = { addons:'addons', plugins:'plugins', collections:'collections', catalogSettings:'catalog-settings', library:'library', watchProgress:'watch-progress', watchedItems:'watched-items' }
      const valueBySection: Record<WritableSection,any> = { addons:p.addons, plugins:p.plugins, collections:p.collections, catalogSettings:settings, library:p.library, watchProgress:p.watchProgress, watchedItems:p.watchedItems }
      const operations = intended.map(section => ({kind:kindBySection[section], items:valueBySection[section], settings:section==='catalogSettings'?settings:undefined}))
      if (!operations.length) { installServerInventory(latest); setDirty(false); setNotice('A conta já contém as alterações atuais.'); return }
      for (const op of operations) {
        const r=await fetch('/api/nuvio/mutate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,profileId:profileId(p),kind:op.kind,items:op.items,settings:op.settings})})
        const d=await r.json(); if(!r.ok) throw new Error(d.error||`Falha ao salvar ${op.kind}`)
        completed.push(op.kind)
      }
      const fresh=await fetchInventory(token)
      const confirmed=fresh.profiles.find(x=>profileId(x)===profileId(p))
      const differences=verifySavedSections(candidate,confirmed,intended)
      if(differences.length) throw new Error(`A nuvem foi relida, mas não confirmou: ${describeSections(differences)}. Seu rascunho foi mantido.`)
      installServerInventory(fresh); setDirty(false); setNotice('Alterações salvas, relidas e confirmadas na conta.')
    } catch(e:any){
      if (completed.length) {
        try { const fresh = await fetchInventory(token); serverBaselineRef.current = structuredClone(fresh) } catch {}
        setError(`${e.message||'Falha ao salvar as alterações'}${completed.length ? ` Salvamento parcial concluído: ${completed.join(', ')}. O restante continua como rascunho e pode ser salvo novamente.` : ''}`)
      } else setError(e.message||'Falha ao salvar todas as alterações')
    } finally {setSaving(false)}
  }

  async function copyAddonToProfiles(targetIndexes: number[], includeCatalogSettings: boolean) {
    if (!token || !inv || !addonTransfer) { setError('Conecte uma conta Nuvio para copiar addons entre perfis.'); return }
    if (dirty) { setError('Salve ou descarte as alterações pendentes antes de copiar o addon entre perfis.'); return }
    const source = inv.profiles[addonTransfer.sourceIndex]
    const item = addonTransfer.item
    const url = addonKey(item.url || '')
    const targets = targetIndexes.map(index => ({ index, profile: inv.profiles[index] })).filter(x => x.profile && x.index !== addonTransfer.sourceIndex)
    if (!targets.length) { setError('Selecione pelo menos um perfil de destino.'); return }
    const eligible = targets.filter(({ profile }) => !profile.addons.some((x: Addon) => addonKey(x.url || '') === url))
    if (!eligible.length) { setNotice('O addon já existe em todos os perfis selecionados.'); setAddonTransfer(null); return }
    const manifest = diag[item.url || '']?.manifest || {}
    const aliases = new Set([String(manifest.id || ''), String(item.id || ''), String(item.url || ''), addonKey(item.url || '')].map(x => x.trim().toLowerCase()).filter(Boolean))
    const belongsToAddon = (setting: any) => { const saved = String(setting.addon_id || setting.addonId || '').trim().toLowerCase(); return aliases.has(saved) || aliases.has(addonKey(saved)) }
    const copiedSettings = (source.catalogSettings?.items || []).filter(belongsToAddon)
    setSaving(true); setError(''); setNotice('')
    let completedProfiles = 0
    let completedWrites:string[]=[]
    try {
      persistSnapshot(inv, 'antes de copiar addon entre perfis')
      const latest = await fetchInventory(token)
      const baseline = serverBaselineRef.current
      const writeSections: WritableSection[] = includeCatalogSettings ? ['addons','catalogSettings'] : ['addons']
      const sourceConflict = changedSections(findProfile(baseline || {profiles:[]}, profileId(source)), findProfile(latest, profileId(source)), writeSections)
      if (sourceConflict.length) throw new Error(`O perfil de origem mudou em outro dispositivo (${describeSections(sourceConflict)}). Releia a conta antes de copiar.`)
      for (const { profile } of eligible) {
        const conflicts = changedSections(findProfile(baseline || {profiles:[]}, profileId(profile)), findProfile(latest, profileId(profile)), writeSections)
        if (conflicts.length) throw new Error(`O perfil ${profile.profile?.name || profileId(profile)} mudou em outro dispositivo (${describeSections(conflicts)}). Nenhum addon foi copiado.`)
      }
      let skipped = targets.length - eligible.length
      for (const { profile } of eligible) {
        const nextAddons = [...profile.addons, { url: item.url, name: item.name || item.display_name || '', enabled: item.enabled !== false, sort_order: profile.addons.length }]
        const addonsResponse = await fetch('/api/nuvio/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, profileId: profileId(profile), kind: 'addons', items: nextAddons }) })
        const addonsResult = await addonsResponse.json(); if (!addonsResponse.ok) throw new Error(addonsResult.error || `Falha ao copiar para ${profile.profile?.name || 'perfil'}.`)
        completedWrites.push(`${profile.profile?.name||profileId(profile)}: addon`)
        if (includeCatalogSettings && copiedSettings.length) {
          const currentSettings = profile.catalogSettings || { hide_unreleased_content: false, items: [] }
          const nextItems = [...currentSettings.items]
          let nextOrder = nextItems.reduce((highest: number, entry: any) => Math.max(highest, Number(entry.order) || 0), -1) + 1
          for (const setting of [...copiedSettings].sort((a: any, b: any) => (Number(a.order) || 0) - (Number(b.order) || 0))) {
            const key = catalogCloudKey(setting.addon_id, setting.type, setting.catalog_id).toLowerCase()
            const at = nextItems.findIndex((x: any) => catalogCloudKey(x.addon_id || x.addonId, x.type, x.catalog_id || x.catalogId).toLowerCase() === key)
            if (at >= 0) nextItems[at] = { ...nextItems[at], ...setting, order: nextItems[at].order }
            else nextItems.push({ ...setting, order: nextOrder++ })
          }
          const settingsResponse = await fetch('/api/nuvio/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, profileId: profileId(profile), kind: 'catalog-settings', settings: { ...currentSettings, items: nextItems } }) })
          const settingsResult = await settingsResponse.json(); if (!settingsResponse.ok) throw new Error(`Addon copiado para ${profile.profile?.name || 'perfil'}, mas as preferências dos catálogos falharam: ${settingsResult.error || 'erro ao salvar'}`)
          completedWrites.push(`${profile.profile?.name||profileId(profile)}: preferências de catálogos`)
        }
        completedProfiles++
      }
      const fresh = await fetchInventory(token)
      for(const {profile} of eligible){const saved=findProfile(fresh,profileId(profile));if(!saved?.addons.some((addon:Addon)=>addonKey(addon.url||'')===url))throw new Error(`A nuvem não confirmou o addon no perfil ${profile.profile?.name||profileId(profile)}.`)}
      installServerInventory(fresh); setDirty(false); setAddonTransfer(null); setSelected(null)
      setNotice(`${completedProfiles} addon(s) copiado(s) e sincronizado(s)${skipped ? `; ${skipped} perfil(is) ignorado(s) porque já tinham o addon` : ''}${includeCatalogSettings && copiedSettings.length ? ', com preferências de catálogos' : ''}.`)
    } catch (e: any) {
      try { const fresh = await fetchInventory(token); installServerInventory(fresh) } catch {}
      setError(`${e.message || 'Falha ao copiar addon entre perfis.'}${completedWrites.length ? ` Gravações concluídas: ${completedWrites.join(', ')}. A conta foi relida; revise o resultado antes de repetir.` : ''}`)
    } finally { setSaving(false) }
  }
  async function saveProfileName() {
    if (!token) { setError('Snapshots são somente leitura.'); return }
    setSaving(true); setError(''); try { const latest=await fetchInventory(token); if(!sameProfiles(serverBaselineRef.current,latest))throw new Error('Os perfis mudaram em outro dispositivo. Releia a conta antes de renomear para não sobrescrever alterações.'); const r = await fetch('/api/nuvio/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, profileId: profileId(p), kind: 'profile-name', name: profileName }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha'); const fresh = await fetchInventory(token), saved=findProfile(fresh,profileId(p)); if(String(saved?.profile?.name||'')!==profileName.trim())throw new Error('O nome foi enviado, mas a releitura da nuvem não confirmou a alteração.'); installServerInventory(fresh); setProfileModal(false); setDirty(false); setNotice('Nome do perfil salvo e confirmado por releitura.') } catch (e: any) { setError(e.message || 'Falha') } finally { setSaving(false) }
  }

  function openProfileEditor(index: number | null) {
    const source = index === null ? null : inv?.profiles[index]?.profile
    setProfileEditIndex(index)
    setProfileFormOpen(true)
    setProfileDraft({
      name: String(source?.name || ''), avatarId: String(source?.avatar_id || source?.avatarId || ''),
      avatarUrl: String(source?.avatar_url || source?.avatarUrl || ''), avatarColorHex: String(source?.avatar_color_hex || source?.avatarColorHex || '#8b5cf6'), pin: '', currentPin: '',
    })
  }

  async function saveManagedProfile() {
    if (!token || !inv) { setError('Conecte uma conta Nuvio para gerenciar perfis.'); return }
    const name = profileDraft.name.trim()
    if (!name) { setError('Informe o nome do perfil.'); return }
    const isNew = profileEditIndex === null
    if (isNew && inv.profiles.length >= 6) { setError('O Nuvio permite até 6 perfis por conta.'); return }
    const profileIndex = isNew ? ([1,2,3,4,5,6].find(id => !inv.profiles.some(x => profileId(x) === id)) || 0) : profileId(inv.profiles[profileEditIndex!])
    if (!profileIndex) { setError('Não foi possível reservar um índice para o novo perfil.'); return }
    const previous = isNew ? {} : inv.profiles[profileEditIndex!].profile
    const nextProfile = {
      ...previous, profile_index: profileIndex, name, avatar_color_hex: profileDraft.avatarColorHex,
      avatar_id: profileDraft.avatarId || null, avatar_url: profileDraft.avatarUrl.trim() || null,
      uses_primary_addons: previous?.uses_primary_addons === true, uses_primary_plugins: previous?.uses_primary_plugins === true,
      profile_background_id: previous?.profile_background_id ?? null, profile_background_url: previous?.profile_background_url ?? null,
    }
    const allProfiles = inv.profiles.map(x => x.profile)
    const payload = isNew ? [...allProfiles, nextProfile] : allProfiles.map((x,i)=>i===profileEditIndex?nextProfile:x)
    setSaving(true); setError(''); setNotice('')
    let profileSaved=false
    try {
      const latest=await fetchInventory(token)
      if(!sameProfiles(serverBaselineRef.current,latest))throw new Error('A lista de perfis mudou em outro dispositivo. Nenhum perfil foi salvo; releia a conta para evitar sobrescrever alterações.')
      const push = await fetch('/api/nuvio/mutate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token,profileId:profileIndex,kind:'profiles',profiles:payload}) })
      const pushed = await push.json(); if (!push.ok) throw new Error(pushed.error || 'Falha ao salvar perfil.')
      profileSaved=true
      if (profileDraft.pin.trim()) {
        const pinResponse = await fetch('/api/nuvio/mutate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token,profileId:profileIndex,kind:'profile-pin',pin:profileDraft.pin.trim(),currentPin:profileDraft.currentPin.trim()}) })
        const pinResult = await pinResponse.json(); if (!pinResponse.ok) throw new Error(pinResult.error || 'Perfil salvo, mas não foi possível atualizar o PIN.')
      }
      const fresh = await fetchInventory(token)
      const savedProfile=findProfile(fresh,profileIndex)
      if(!savedProfile||String(savedProfile.profile?.name||'')!==name||String(savedProfile.profile?.avatar_id||'')!==String(nextProfile.avatar_id||'')||String(savedProfile.profile?.avatar_url||'')!==String(nextProfile.avatar_url||''))throw new Error('O perfil foi enviado, mas a releitura da nuvem não confirmou nome e avatar.')
      if(profileDraft.pin.trim()&&savedProfile.profile?.pin_enabled!==true)throw new Error('Perfil confirmado, mas a releitura não confirmou a ativação do PIN.')
      installServerInventory(fresh); setActive(Math.max(0,fresh.profiles.findIndex(x=>profileId(x)===profileIndex))); setProfileManagerOpen(false); setProfileFormOpen(false); setDirty(false)
      setNotice(isNew ? `Perfil “${name}” criado e sincronizado.` : `Perfil “${name}” atualizado e sincronizado.`)
    } catch (e:any) { if(profileSaved){try{const fresh=await fetchInventory(token);installServerInventory(fresh)}catch{};setError(`${e.message || 'Falha ao salvar perfil.'} O perfil já foi enviado; confira o nome/avatar e conclua o PIN se necessário.`)}else setError(e.message || 'Falha ao salvar perfil.') } finally { setSaving(false) }
  }

  async function clearManagedProfilePin(profileIndex:number) {
    const entered = window.prompt('Informe o PIN atual para removê-lo (deixe vazio se o perfil não tinha PIN).')
    if (entered === null) return
    const currentPin = entered
    setSaving(true); setError('')
    try {
      const r=await fetch('/api/nuvio/mutate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,profileId:profileIndex,kind:'profile-pin-clear',currentPin})})
      const d=await r.json(); if(!r.ok) throw new Error(d.error||'Não foi possível remover o PIN.')
      const fresh=await fetchInventory(token),updated=findProfile(fresh,profileIndex);if(updated?.profile?.pin_enabled===true)throw new Error('O PIN foi removido no envio, mas a releitura ainda informa que está ativo.');installServerInventory(fresh); setNotice('PIN removido e confirmado por releitura.');
    } catch(e:any){setError(e.message||'Falha ao remover PIN.')} finally {setSaving(false)}
  }

  function mergeByUrl(target:any[], incoming:any[]){ const out=[...target]; for(const x of incoming){ const i=out.findIndex((y:any)=>addonKey(y?.url||y?.repository||'')===addonKey(x?.url||x?.repository||'')); if(i>=0) out[i]={...out[i],...x}; else out.push(x) } return out.map((x:any,i:number)=>({...x,sort_order:i})) }
  function mergeByIdentity(target:any[], incoming:any[]){ const out=[...target]; for(const x of incoming){ const key=String(x?.content_id||x?.contentId||x?.videoId||x?.id||x?.imdb_id||x?.tmdb_id||JSON.stringify(x)); const i=out.findIndex((y:any)=>String(y?.content_id||y?.contentId||y?.videoId||y?.id||y?.imdb_id||y?.tmdb_id||JSON.stringify(y))===key); if(i>=0) out[i]={...out[i],...x}; else out.push(x) } return out }
  function mergeCollections(target:any[], incoming:any[]){ const out=[...target]; for(const x of incoming){ const key=String(x?.id||x?.title||x?.name||''); const i=out.findIndex((y:any)=>String(y?.id||y?.title||y?.name||'')===key); if(i>=0) out[i]=x; else out.push(x) } return out }
  function mergeCatalogSettings(target:CatalogSettings|null, incoming:CatalogSettings, mode:'merge'|'replace'):CatalogSettings { if(mode==='replace') return structuredClone(incoming); const base:CatalogSettings = target || {hide_unreleased_content:false,items:[]}; const map=new Map(base.items.map(x=>[catalogCloudKey(x.addon_id,x.type,x.catalog_id),x])); for(const x of incoming.items||[]) map.set(catalogCloudKey(x.addon_id,x.type,x.catalog_id),x); return {...base, ...incoming, items:Array.from(map.values())} }

  function navigate(id: string) { setTab(id); setQuery(''); setSelected(null); setProfileDataError(''); setMobileNavOpen(false) }
  function logout() { diagnosticSessionRef.current++; diagnosticRunsRef.current.clear(); localStorage.removeItem('nuvio-session'); setInv(null); setToken(''); setRefreshToken(''); setDiagnosticsByProfile({}); setDiagnosticLoadingByProfile({}); setDiagnosticProgressByProfile({}); setSelected(null); setCompare(null); setDirty(false); setNotice('') }

  if (booting) return <div className="login-wrap"><div className="login-card"><div className="brand large"><b>NUVIO</b><span>CONTROL</span></div><div className="login-copy"><h1>Restaurando sessão…</h1><p>Verificando a sessão salva sem pedir sua senha novamente.</p></div></div></div>
  if (!inv) return <Login email={email} setEmail={setEmail} password={password} setPassword={setPassword} loading={loading} error={error} remember={remember} setRemember={setRemember} onSubmit={login} onImport={() => fileRef.current?.click()} fileRef={fileRef} importSnapshot={importSnapshot} />

  const profileLabel = p.profile?.name || `Perfil ${active + 1}`
  return <div className={`app-shell${sidebarCollapsed?' sidebar-collapsed':''}${mobileNavOpen?' mobile-nav-open':''}`}>
    <aside className={`sidebar${mobileNavOpen?' mobile-open':''}`}>
      <div className="brand"><div className="brand-wordmark"><b>NUVIO</b><span>CONTROL</span></div><button className="sidebar-collapse" aria-label={mobileNavOpen?'Fechar menu':sidebarCollapsed?'Expandir menu':'Recolher menu'} title={mobileNavOpen?'Fechar menu':sidebarCollapsed?'Expandir menu':'Recolher menu'} onClick={()=>{if(window.matchMedia('(max-width: 820px)').matches)setMobileNavOpen(false);else setSidebarCollapsed(v=>!v)}}>{mobileNavOpen?'×':sidebarCollapsed?'›':'‹'}</button></div>
      <div className="account-card"><div className="eyebrow">CONTA CONECTADA</div><div className="account-email">{email || 'Snapshot importado'}</div><small>{token ? 'Sessão ativa' : 'Somente leitura'}</small></div>
      <div className="nav"><div className="nav-label">PAINEL</div>{NAV.map(([id,label]) => <button key={id} title={sidebarCollapsed?label:undefined} className={tab===id?'active':''} onClick={() => navigate(id)}><span className="nav-mark" aria-hidden="true">{id==='overview'?'⌂':id==='addons'?'◉':id==='catalogs'?'▤':id==='plugins'?'◇':id==='collections'?'▣':id==='watch'?'◷':'▧'}</span><span className="nav-text">{label}</span><em>{id==='addons'?counts.addons:id==='catalogs'?catalogCount(p,diag):id==='plugins'?counts.plugins:id==='collections'?counts.collections:id==='watch'?counts.progress:id==='library'?counts.library:''}</em></button>)}</div>
      <div className={`sidebar-utilities${utilitiesOpen?' open':''}`}><button className="utilities-toggle" aria-expanded={utilitiesOpen} onClick={()=>setUtilitiesOpen(v=>!v)}><span>Ferramentas e conta</span><span aria-hidden="true">{utilitiesOpen?'−':'+'}</span></button><div className="sidebar-tools"><button onClick={() => setTransferOpen(true)}><span className="utility-mark">⇄</span><span>Transferência por arquivo</span></button><button onClick={saveSnapshotLocal}><span className="utility-mark">▣</span><span>Backup / Snapshot</span></button><button onClick={openCompare}><span className="utility-mark">◫</span><span>Comparar backup</span></button></div><div className="sidebar-bottom"><button onClick={() => downloadSnapshot()}><span className="utility-mark">↓</span><span>Exportar backup</span></button><button onClick={logout}><span className="utility-mark">↪</span><span>{token ? 'Sair / desconectar' : 'Fechar backup'}</span></button></div></div><div className="creator-credit">por <b>ReiThomato</b></div>
    </aside>
    {mobileNavOpen&&<button className="mobile-nav-backdrop" aria-label="Fechar menu" onClick={()=>setMobileNavOpen(false)} />}
    <main className="content">
      <div className="mobile-topbar"><button className="mobile-nav-trigger" aria-label="Abrir menu" onClick={()=>setMobileNavOpen(true)}>☰</button><b>NUVIO <span>CONTROL</span></b></div>
      <div className="profile-strip"><div className="profile-label">PERFIS</div><div className="profile-tabs">{inv.profiles.map((x,i)=>{const avatar=getProfileAvatarUrl(x.profile,inv.avatarCatalog);return <button key={x.profile?.id || x.profile?.profile_index || i} className={i===active?'active':''} disabled={saving} onClick={() => void selectProfile(i)}><span className={`profile-dot${avatar?' has-image':''}`}>{avatar?<img src={avatar} alt=""/>:(x.profile?.name || `P${i+1}`).slice(0,1).toUpperCase()}</span>{x.profile?.name || `Perfil ${i+1}`}</button>})}</div><button className="ghost profile-manage-button" disabled={!token} onClick={()=>setProfileManagerOpen(true)}>Gerenciar perfis</button></div>
      <div className="page-head"><div><div className="eyebrow">CENTRO DE CONTROLE NUVIO</div><h1>{NAV.find(x=>x[0]===tab)?.[1] || 'Visão geral'}</h1><p>{profileLabel} · {NAV.find(x=>x[0]===tab)?.[2]}</p></div><div className="head-actions">{dirty && <span className="status-pill">ALTERAÇÕES LOCAIS</span>} {error && <button className="ghost" onClick={() => setError('')}>Fechar erro</button>}</div></div>
      {notice && <div className="notice" role="status" aria-live="polite">✓ {notice}</div>}{error && <div className="alert" role="alert">{error}</div>}
      {dirty && <div className="pending-bar pending-global"><div><b>Há alterações não salvas</b><span>{token ? 'Você pode continuar editando. Ao sair, também será lembrado de salvar.' : 'O arquivo está em modo somente leitura.'}</span></div><div className="pending-actions"><button className="ghost" disabled={saving||!token} onClick={async()=>{try{const fresh=await fetchInventory(token);installServerInventory(fresh);setDirty(false);setNotice('Alterações locais descartadas.')}catch(e:any){setError(e.message||'Não foi possível recarregar.')}}}>Descartar</button><button className="primary" disabled={saving||!token} onClick={saveAll}>{saving?'Salvando…':'Salvar todas'}</button></div></div>}
      {tab === 'overview' && <Overview p={p} counts={counts} inv={inv} live={!!token} onRename={() => { setProfileManagerOpen(true); openProfileEditor(active) }} />}
      {tab === 'addons' && <AddonPage profile={p} rows={p.addons} diag={diag} loading={diagLoading} diagnose={() => diagnose(p.addons)} q={query} setQ={setQuery} selected={selected} setSelected={setSelected} update={(items:any[]) => updateProfile(x => ({ ...x, addons: items }))} onAdd={() => setAddonModal({ mode:'add' })} onEdit={(item: Addon) => setAddonModal({ mode:'edit', item })} onCopy={(item:Addon)=>setAddonTransfer({item,sourceIndex:active})} token={!!token} lastSync={inv.fetchedAt} />}
      {tab === 'catalogs' && <CatalogPage profile={p} diag={diag} diagLoading={diagLoading} diagProgress={diagProgress} q={query} setQ={setQuery} token={!!token} saving={saving} dirty={dirty} onChange={(settings:CatalogSettings) => updateProfile(x => ({ ...x, catalogSettings: settings }))} onRefresh={() => diagnose(p.addons)} />}
      {tab === 'plugins' && <PluginPage rows={p.plugins} q={query} setQ={setQuery} selected={selected} setSelected={setSelected} update={(items:any[]) => updateProfile(x => ({ ...x, plugins: items }))} token={!!token} />}
      {tab === 'collections' && <CollectionPage rows={p.collections} q={query} setQ={setQuery} selected={selected} setSelected={setSelected} update={(items:any[]) => updateProfile(x => ({ ...x, collections: items }))} token={!!token} onAdd={() => setCollectionModal(newCollection())} onImport={() => collectionFileRef.current?.click()} onImportUrl={() => setCollectionImportOpen(true)} onEdit={(x:any)=>setCollectionModal(x)} onExport={(x:any)=>downloadCollection(x)} />}
      {tab === 'watch' && <WatchPage rows={p.watchProgress} history={p.watchedItems} addons={p.addons} loading={profileDataLoading==='history'} error={profileDataError} hasMore={p.watchedItemsHasMore} onLoadMore={()=>void loadProfileData('history')} />}
      {tab === 'library' && <LibraryPage rows={p.library} token={token} profile={p} onUpdate={(items:any[]) => updateProfile(x => ({ ...x, library: items }))} loading={profileDataLoading==='library'} error={profileDataError} hasMore={p.libraryHasMore} onLoadMore={()=>void loadProfileData('library')} />}
    </main>
    {snapshotOpen && <SnapshotModal compare={compare} current={inv} close={() => { setSnapshotOpen(false); setCompare(null) }} onExport={()=>downloadSnapshot()} onImport={()=>fileRef.current?.click()} />}
    {importOpen && <ImportModal close={() => setImportOpen(false)} fileRef={fileRef} importSnapshot={importSnapshot} />}
    {profileModal && <SimpleModal title="Renomear perfil" close={() => setProfileModal(false)}><label className="form-label">Nome do perfil<input value={profileName} onChange={e=>setProfileName(e.target.value)} /></label><div className="modal-actions"><button className="ghost" onClick={()=>setProfileModal(false)}>Cancelar</button><button className="primary" disabled={saving||!profileName.trim()} onClick={saveProfileName}>{saving?'Salvando…':'Salvar'}</button></div></SimpleModal>}
    {profileManagerOpen&&<ProfileManagerModal profiles={inv.profiles} avatarCatalog={inv.avatarCatalog||[]} saving={saving} draft={profileDraft} setDraft={setProfileDraft} editIndex={profileEditIndex} formOpen={profileFormOpen} openEditor={openProfileEditor} back={()=>setProfileFormOpen(false)} saveProfile={saveManagedProfile} clearPin={clearManagedProfilePin} close={()=>{setProfileManagerOpen(false);setProfileFormOpen(false);setProfileEditIndex(null)}} />}
    {addonTransfer && <AddonProfileTransferModal item={addonTransfer.item} sourceIndex={addonTransfer.sourceIndex} profiles={inv.profiles} catalogPreferenceCount={(inv.profiles[addonTransfer.sourceIndex]?.catalogSettings?.items||[]).filter((s:any)=>{const ids=[String(diag[addonTransfer.item.url||'']?.manifest?.id||''),String(addonTransfer.item.id||''),String(addonTransfer.item.url||''),addonKey(addonTransfer.item.url||'')].map(x=>x.toLowerCase());const saved=String(s.addon_id||s.addonId||'').toLowerCase();return ids.includes(saved)||ids.includes(addonKey(saved))}).length} saving={saving} dirty={dirty} close={()=>setAddonTransfer(null)} onCopy={copyAddonToProfiles} />}
  {addonModal && <AddonEditor modal={addonModal} existing={p.addons} close={()=>setAddonModal(null)} save={(value:any)=>{ const existing=p.addons; if(addonModal.mode==='edit'){updateProfile(x=>({...x,addons:existing.map(a=>sameAddon(a,addonModal.item)?{...a,...value}:a)}))}else{const incoming=value.items.map((entry:any,i:number)=>({...entry.addon,sort_order:existing.length+i}));const previewCatalogs=value.items.flatMap((entry:any)=>flattenManifestCatalogs(entry.addon,entry.manifest));let catalogSettings=p.catalogSettings;if(previewCatalogs.length){catalogSettings=catalogSettingsForManifests(p.catalogSettings,[...allCatalogs(diag,existing),...previewCatalogs]);const chosen=new Set(value.items.flatMap((entry:any)=>entry.activeCatalogKeys||[]));catalogSettings={...catalogSettings,items:catalogSettings.items.map((item:any)=>chosen.has(catalogCloudKey(item.addon_id,item.type,item.catalog_id))?{...item,enabled:true}:item)}}updateProfile(x=>({...x,addons:[...existing,...incoming],catalogSettings}))}setTab('catalogs');setAddonModal(null) }} />}
    {collectionModal && <CollectionEditor value={collectionModal} close={()=>setCollectionModal(null)} catalogs={allCatalogs(diag,p.addons)} save={(x:any)=>{ const old=p.collections; const exists=old.some(v=>String(v.id)===String(x.id)); const next=exists?old.map(v=>String(v.id)===String(x.id)?x:v):[...old,x]; updateProfile(v=>({...v,collections:next})); setCollectionModal(null) }} />}
    {collectionImportOpen && <CollectionUrlModal close={()=>setCollectionImportOpen(false)} onImport={(data:any)=>{ const incoming=normalizeCollections(data); if(incoming.length){ updateProfile(v=>({...v,collections:[...v.collections,...incoming]})); setNotice(`${incoming.length} coleção(ões) importada(s) localmente.`); setCollectionImportOpen(false) } else setError('O JSON não contém coleções reconhecíveis.') }} />}
    {transferOpen && <TransferModal source={p} sourceLabel={profileLabel} close={()=>setTransferOpen(false)} exportPackage={downloadTransferPackage} onImportFile={()=>transferFileRef.current?.click()} />}{transferFileOpen && transferPackage && <TransferImportModal pkg={transferPackage} close={()=>{setTransferFileOpen(false);setTransferPackage(null)}} onApply={applyTransferPackage} saving={saving} />}
    <input ref={transferFileRef} type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)openTransferPackage(f);e.currentTarget.value=''}} />
    <input ref={collectionFileRef} type="file" accept=".json,application/json" hidden onChange={e=>{ const f=e.target.files?.[0]; if(!f)return; const rd=new FileReader(); rd.onload=()=>{try{const data=normalizeCollections(JSON.parse(String(rd.result))); if(data.length){updateProfile(v=>({...v,collections:[...v.collections,...data]}));setNotice(`${data.length} coleção(ões) importada(s).`)}else setError('JSON sem coleções reconhecíveis.')}catch{setError('Arquivo JSON inválido.')}};rd.readAsText(f);e.currentTarget.value='' }} />
  </div>
}

function allCatalogs(diag: Record<string,Health>, addons: Addon[]) { return addons.flatMap(a=>flattenManifestCatalogs(a,diag[a.url||'']?.manifest||{})) }
function getProfileAvatarUrl(profile:any,catalog:any[]=[]){const direct=String(profile?.avatar_url||profile?.avatarUrl||'').trim();if(direct)return direct;const id=String(profile?.avatar_id||profile?.avatarId||'');const item=catalog.find((a:any)=>String(a.id||a.avatar_id||'')===id);if(!item)return '';const url=item.imageUrl||item.image_url||item.url;if(url)return String(url);const path=item.storagePath||item.storage_path;return path?`https://api.nuvio.tv/storage/v1/object/public/avatars/${String(path).replace(/^\//,'')}`:''}
function homeCatalogSettings(p: ProfileRecord, diag: Record<string,Health>) { return catalogSettingsForManifests(p.catalogSettings,allCatalogs(diag,p.addons)) }
function homeCatalogIsActive(p: ProfileRecord, c: any) { const item=catalogSettingsForManifests(p.catalogSettings,[c]).items.find(x=>catalogCloudKey(x.addon_id,x.type,x.catalog_id).toLowerCase()===String(c.cloudKey).toLowerCase()); return item?.enabled===true }
function catalogCount(p: ProfileRecord, diag: Record<string,Health>) { return homeCatalogSettings(p,diag).items.filter(x=>x.enabled!==false).length }
function buildCatalogSettings(p: ProfileRecord, diag: Record<string,Health>): CatalogSettings { return homeCatalogSettings(p,diag) }
function verifyCoreProfile(expected:ProfileRecord,actual:ProfileRecord,diag:Record<string,Health>):string[]{
  const differences:string[]=[]
  const compareRows=(label:string,left:any[],right:any[],identity:(x:any)=>string)=>{
    const key=(x:any)=>identity(x),a=left.map(key),b=right.map(key)
    if(a.length!==b.length||a.some((value,i)=>value!==b[i])) differences.push(`${label} (itens/ordem)`)
    const actualByKey=new Map(right.map(x=>[key(x),x]))
    for(const item of left){const saved:any=actualByKey.get(key(item));if(!saved)continue;if((item.enabled!==false)!==(saved.enabled!==false))differences.push(`${label} (estado)`);if(item.name&&String(item.name)!==String(saved.name||saved.display_name||''))differences.push(`${label} (nome)`)}
  }
  compareRows('addons',expected.addons,actual.addons,(x:any)=>addonKey(x.url||''))
  compareRows('plugins',expected.plugins,actual.plugins,(x:any)=>addonKey(x.url||x.repository||''))
  const stable=(value:any):string=>JSON.stringify(value,(key,val)=>val&&typeof val==='object'&&!Array.isArray(val)?Object.keys(val).sort().reduce((out:any,k)=>{out[k]=val[k];return out},{ }):val)
  if(stable(expected.collections)!==stable(actual.collections)) differences.push('coleções')
  if(stable(expected.library)!==stable(actual.library)) differences.push('biblioteca')
  if(stable(expected.watchProgress)!==stable(actual.watchProgress)) differences.push('progresso')
  if(stable(expected.watchedItems)!==stable(actual.watchedItems)) differences.push('histórico de assistidos')
  const desired=catalogSettingsForManifests(expected.catalogSettings,allCatalogs(diag,expected.addons))
  const received=catalogSettingsForManifests(actual.catalogSettings,allCatalogs(diag,actual.addons))
  const key=(x:any)=>x.is_collection?`collection/${String(x.collection_id||'').toLowerCase()}`:catalogCloudKey(x.addon_id,x.type,x.catalog_id).toLowerCase()
  const byKey=new Map(received.items.map(x=>[key(x),x]))
  for(const item of desired.items){const saved=byKey.get(key(item));if(!saved||((saved.enabled!==false)!==(item.enabled!==false))||Number(saved.order??0)!==Number(item.order??0)||String(saved.custom_title||'')!==String(item.custom_title||'')||(saved.is_collection===true)!==(item.is_collection===true)||String(saved.collection_id||'')!==String(item.collection_id||'')){differences.push('catálogos');break}}
  if((desired.hide_unreleased_content===true)!==(received.hide_unreleased_content===true))differences.push('preferência de conteúdo não lançado')
  return Array.from(new Set(differences))
}
function sameAddon(a:Addon,b?:Addon){return addonKey(a.url||'')===addonKey(b?.url||'')||String(a.id||'')===String(b?.id||'')}
function newCollection(){return{id:`collection-${crypto.randomUUID()}`,title:'Nova coleção',viewMode:'GRID',showAllTab:true,pinToTop:false,focusGlowEnabled:false,backdropImageUrl:'',folders:[]}}
function downloadCollection(x:any){const b=new Blob([JSON.stringify(x,null,2)],{type:'application/json'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=`collection-${String(x.title||x.id||'nuvio').replace(/[^a-z0-9_-]+/gi,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),500)}

function Login({email,setEmail,password,setPassword,loading,error,onSubmit,onImport,fileRef,importSnapshot,remember,setRemember}:any){return <div className="login-wrap"><div className="login-card"><div className="brand large"><b>NUVIO</b><span>CONTROL</span></div><div className="login-copy"><h1>Seu centro de operações</h1><p>Gerencie e audite sua configuração Nuvio em um único painel.</p></div><form onSubmit={onSubmit}><label>E-mail Nuvio<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label><label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required /></label><label className="check-line"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} /> Manter sessão neste navegador</label><button className="primary full" disabled={loading}>{loading?'Conectando…':'Conectar ao Nuvio'}</button></form>{error&&<div className="alert">{error}</div>}<div className="login-divider"><span>ou</span></div><button className="ghost full" onClick={onImport}>Abrir snapshot</button><input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e=>e.target.files?.[0]&&importSnapshot(e.target.files[0])}/><p className="security-note">A opção de sessão salva guarda o refresh token no armazenamento local do navegador; sua senha não é salva.</p></div></div>}

function ProfileManagerModal({profiles,avatarCatalog,saving,draft,setDraft,editIndex,formOpen,openEditor,back,saveProfile,clearPin,close}:any){
  const current=editIndex===null?null:profiles[editIndex]
  const avatarSrc=(item:any)=>item.imageUrl||item.image_url||item.url||(item.storagePath||item.storage_path?`https://api.nuvio.tv/storage/v1/object/public/avatars/${String(item.storagePath||item.storage_path).replace(/^\//,'')}`:'')
  const avatarId=(item:any)=>String(item.id||item.avatar_id||'')
  return <div className="modal-backdrop"><div className="modal profile-manager-modal"><div className="modal-head"><div><div className="eyebrow">CONTA NUVIO</div><h2>{formOpen?(editIndex===null?'Adicionar perfil':'Editar perfil'):'Gerenciar perfis'}</h2></div><button className="icon-btn" onClick={formOpen?back:close}>×</button></div>
    {!formOpen?<><p className="muted">Perfis, avatares e PIN sincronizados com os aplicativos Nuvio conectados à conta.</p><div className="managed-profile-list">{profiles.map((entry:any,i:number)=>{const x=entry.profile||{};const image=x.avatar_url||x.avatarUrl||avatarSrc(avatarCatalog.find((a:any)=>avatarId(a)===String(x.avatar_id||x.avatarId||'')));return <div className="managed-profile-row" key={x.profile_index||i}><div className="managed-avatar">{image?<img src={image} alt=""/>:<span>{String(x.name||`Perfil ${i+1}`).slice(0,1).toUpperCase()}</span>}</div><div className="managed-profile-info"><b>{x.name||`Perfil ${i+1}`}</b><small>{x.pin_enabled?'PIN ativado':'Sem PIN'} · Perfil {x.profile_index||i+1}</small></div><button className="ghost" onClick={()=>openEditor(i)}>Editar</button>{x.pin_enabled&&<button className="ghost" disabled={saving} onClick={()=>clearPin(Number(x.profile_index))}>Remover PIN</button>}</div>})}</div><div className="modal-actions"><button className="ghost" onClick={close}>Fechar</button><button className="primary" disabled={saving||profiles.length>=6} onClick={()=>openEditor(null)}>Adicionar perfil</button></div>{profiles.length>=6&&<p className="security-note">Limite de 6 perfis da API Nuvio atingido.</p>}</>:<><label className="form-label">Nome do perfil<input autoFocus maxLength={40} value={draft.name} onChange={e=>setDraft((x:any)=>({...x,name:e.target.value}))} placeholder="Ex.: Sala, Crianças…"/></label><div className="avatar-picker"><div className="avatar-picker-head"><b>Avatar</b><span className="muted small">Escolha um avatar do Nuvio ou use uma imagem pública.</span></div><div className="avatar-options">{avatarCatalog.map((a:any)=>{const image=avatarSrc(a);const id=avatarId(a);return <button type="button" key={id||image} className={draft.avatarId===id?'selected':''} title={a.displayName||a.display_name||id} onClick={()=>setDraft((x:any)=>({...x,avatarId:id,avatarUrl:''}))}>{image?<img src={image} alt={a.displayName||a.display_name||'Avatar'}/>:<span>{(a.displayName||a.display_name||'?').slice(0,1)}</span>}</button>})}</div><label className="form-label">URL da foto<input type="url" value={draft.avatarUrl} onChange={e=>setDraft((x:any)=>({...x,avatarUrl:e.target.value,avatarId:''}))} placeholder="https://…"/></label><label className="form-label">Cor de destaque<input type="color" value={draft.avatarColorHex} onChange={e=>setDraft((x:any)=>({...x,avatarColorHex:e.target.value}))}/></label></div><div className="profile-pin-fields"><label className="form-label">{current?.profile?.pin_enabled?'Novo PIN (deixe vazio para manter)':'PIN opcional'}<input inputMode="numeric" autoComplete="new-password" type="password" maxLength={8} value={draft.pin} onChange={e=>setDraft((x:any)=>({...x,pin:e.target.value.replace(/\D/g,'')}))} placeholder="4 a 8 dígitos"/></label>{current?.profile?.pin_enabled&&draft.pin&&<label className="form-label">PIN atual<input inputMode="numeric" type="password" maxLength={8} value={draft.currentPin} onChange={e=>setDraft((x:any)=>({...x,currentPin:e.target.value.replace(/\D/g,'')}))}/></label>}</div><p className="security-note">O PIN é validado e armazenado pelo Nuvio. O painel não salva o PIN localmente.</p><div className="modal-actions"><button className="ghost" onClick={back}>Voltar</button><button className="primary" disabled={saving||!draft.name.trim()||Boolean(draft.pin&&draft.pin.length<4)||Boolean(current?.profile?.pin_enabled&&draft.pin&&!draft.currentPin)} onClick={saveProfile}>{saving?'Salvando…':'Salvar e sincronizar'}</button></div></>}
  </div></div>
}

function Overview({p,counts,inv,live,onRename}:any){const cards=[['addons','Addons'],['plugins','Plugins'],['collections','Coleções'],['progress','Progresso'],['library','Biblioteca'],['watched','Assistidos']];const avatar=getProfileAvatarUrl(p.profile,inv.avatarCatalog);return <div className="stack"><div className="metric-grid">{cards.map(([k,l])=><div className="metric" key={k}><span>{l}</span><strong>{counts[k]}</strong><small>neste perfil</small></div>)}</div><div className="two-col"><div className="panel"><div className="panel-head"><div><h2>Perfil atual</h2><p>Dados da conta recuperados pela API em nuvem.</p></div><span className={'status-pill '+(live?'ok':'')}>{live?'SINCRONIZADO':'SNAPSHOT'}</span></div><div className="profile-summary"><div className="avatar">{avatar?<img src={avatar} alt=""/>:(p.profile?.name||'P').slice(0,1).toUpperCase()}</div><div><h3>{p.profile?.name||'Perfil sem nome'}</h3><div className="muted">Índice {p.profile?.profile_index??p.profile?.id??'—'}</div></div><button className="ghost small-action" disabled={!live} onClick={onRename}>Editar perfil</button></div></div><div className="panel"><div className="panel-head"><div><h2>Inventário</h2><p>Última leitura desta sessão.</p></div></div><div className="inventory-meta"><div><span>Atualizado</span><b>{new Date(inv.fetchedAt).toLocaleString('pt-BR')}</b></div><div><span>Perfis</span><b>{inv.profiles.length}</b></div><div><span>Catálogos</span><b>{p.catalogSettings?.items?.length||'—'}</b></div></div></div></div></div>}

function OrderInput({value,max,disabled,onCommit}:{value:number;max:number;disabled?:boolean;onCommit:(value:number)=>void}){const [draft,setDraft]=useState(String(value+1));useEffect(()=>setDraft(String(value+1)),[value]);function commit(){const parsed=Number(draft);const next=Number.isFinite(parsed)?Math.min(max,Math.max(1,Math.round(parsed))):value+1;setDraft(String(next));if(next!==value+1)onCommit(next-1)}return <input className="order-input" aria-label="Posição na ordem" type="number" inputMode="numeric" min={1} max={Math.max(1,max)} value={draft} disabled={disabled} onClick={e=>e.stopPropagation()} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')e.currentTarget.blur()}} />}
function moveRowTo<T>(rows:T[],from:number,to:number):T[]{const next=[...rows];if(from<0||from>=next.length)return next;const [item]=next.splice(from,1);next.splice(Math.max(0,Math.min(to,next.length)),0,item);return next}
function AddonPage({profile,rows,diag,loading,diagnose,q,setQ,selected,setSelected,update,onAdd,onEdit,onCopy,token,lastSync}:any){
 const [failed,setFailed]=useState(false)
 const filtered=useMemo(()=>rows.filter((x:Addon)=>{const d=diag[x.url||''];return JSON.stringify(x).toLowerCase().includes(q.toLowerCase())&&(!failed||d?.health==='fail'||(Number(d?.summary?.failed)||0)>0)}),[rows,diag,q,failed])
 const healthRows=Object.values(diag) as Health[]
 const healthy=healthRows.filter(x=>x.health==='healthy').length,attention=healthRows.filter(x=>x.health==='attention').length,failedCount=healthRows.filter(x=>x.health==='fail').length,unverifiedCount=healthRows.filter(x=>x.health==='unknown'&&x.phase==='complete').length
 function remove(item:Addon){if(!confirm(`Remover o addon "${item.name||item.display_name||item.url}"?`))return;update(rows.filter((x:Addon)=>!sameAddon(x,item)).map((x:Addon,i:number)=>({...x,sort_order:i})))}
 function move(item:Addon,to:number){const i=rows.findIndex((x:Addon)=>sameAddon(x,item));update(moveRowTo<Addon>(rows,i,to).map((x:Addon,n)=>({...x,sort_order:n})))}
 return <div className="stack">
  <div className="toolbar"><div className="search-wrap">⌕<input placeholder="Buscar addon…" value={q} onChange={e=>setQ(e.target.value)}/></div><button className="ghost" onClick={()=>setFailed(!failed)}>{failed?'Mostrar todos':'Com falhas'}</button><button className="ghost" onClick={onAdd} disabled={!token}>Adicionar</button><button className="primary" disabled={loading} onClick={diagnose}>{loading?'Diagnosticando…':'Diagnosticar addons'}</button></div>
  {loading&&<div className="diag-strip"><span className="amber-dot"></span>{healthRows.length} de {rows.filter((x:Addon)=>x.url).length} addons responderam; diagnósticos parciais já estão disponíveis.</div>}
  {healthRows.length>0&&<div className="diag-strip"><span><i className="green-dot"></i>{healthy} saudáveis</span><span><i className="amber-dot"></i>{attention} atenção</span><span><i className="red-dot"></i>{failedCount} manifesto indisponível</span><span>{unverifiedCount} não verificáveis</span><span className="diag-legend">Ativo = habilitado na conta</span></div>}
  <div className="panel table-panel addon-list-panel"><div className="table-scroll mobile-card-table addon-card-table"><table><thead><tr><th>Addon</th><th>Catálogos</th><th>Estado</th><th>Diagnóstico</th><th>Ordem</th><th></th></tr></thead><tbody>{filtered.map((x:Addon,i:number)=>{const d=diag[x.url||''];const c=Array.isArray(d?.manifest?.catalogs)?d.manifest.catalogs.length:0;const order=x.sort_order??i;return <tr key={x.id||x.url||i} onClick={()=>setSelected(x)}>
   <td data-label="Addon"><div className="item-name">{x.name||x.display_name||d?.manifest?.name||'Sem nome'}</div><div className="item-sub">{x.url||'URL não informada'}</div></td>
   <td data-label="Catálogos"><span className="number-chip">{c||'—'}</span></td>
   <td data-label="Estado"><span className={'status-text '+(x.enabled===false?'off':'on')}><i></i>{x.enabled===false?'Desativado':'Ativo'}</span></td>
   <td data-label="Diagnóstico"><HealthCell d={d}/></td>
   <td data-label="Ordem" className="addon-order-cell" onClick={e=>e.stopPropagation()}><div className="addon-order-controls"><button type="button" className="order-step" aria-label="Mover addon para cima" title="Mover para cima" disabled={!token||order<=0} onClick={()=>move(x,Math.max(0,order-1))}>↑</button><OrderInput value={order} max={rows.length} disabled={!token} onCommit={to=>move(x,to)}/><button type="button" className="order-step" aria-label="Mover addon para baixo" title="Mover para baixo" disabled={!token||order>=rows.length-1} onClick={()=>move(x,Math.min(rows.length-1,order+1))}>↓</button></div></td>
   <td data-label="Ações"><div className="row-actions"><button className="row-action" onClick={e=>{e.stopPropagation();onEdit(x)}}>Editar</button><button className="row-action danger" onClick={e=>{e.stopPropagation();remove(x)}}>Remover</button></div></td>
  </tr>})}</tbody></table></div>{!filtered.length&&<div className="empty">Nenhum addon encontrado.</div>}</div>
  {selected&&<AddonDrawer item={selected} diag={diag[selected.url||'']} close={()=>setSelected(null)} update={update} rows={rows} token={token} profile={profile} lastSync={lastSync} onCopy={onCopy}/>}
 </div>
}
function HealthCell({d}:{d?:Health}){if(!d)return <span className="muted">Não testado</span>;if(d.phase==='manifest'||d.phase==='catalog')return <span className="attention">◌ Verificando… <small>{d.summary?.tested||0}/{d.summary?.catalogs||0} catálogos</small></span>;const label=d.health==='healthy'?'Manifesto OK':d.health==='attention'?'Atenção':d.health==='fail'?'Manifesto indisponível':'Não verificável';const reason=d.healthReason||d.error;const summary=d.summary;const color=d.health==='fail'?'bad':d.health==='attention'||d.health==='unknown'?'attention':'ok';return <span title={reason||''} className={color}>{d.health==='healthy'?'✓':d.health==='attention'?'!':d.health==='fail'?'✕':'?'} {label} <small>{d.latencyMs?`${d.latencyMs} ms`:''}</small>{summary&&<small className="health-breakdown">{summary.tested||0} de {summary.catalogs||0} catálogos · {summary.failed||0} falhas · {summary.unverified||0} não verificáveis{summary.notTestedByLimit?` · ${summary.notTestedByLimit} fora do limite`:''}</small>}{d.health==='fail'&&reason&&<small className="health-reason">{reason}</small>}</span>}
function AddonDrawer({item,diag,close,update,rows,token,profile,lastSync,onCopy}:any){
 const catalogs=flattenManifestCatalogs(item,diag?.manifest||{}),home=catalogs.filter((c:any)=>!c.searchOnly&&!c.isCollection),search=catalogs.filter((c:any)=>!c.isCollection&&(c.searchCapable||c.searchOnly)),analysis=diag?.manifestAnalysis
 const settings=catalogSettingsForManifests(profile?.catalogSettings,catalogs),byKey=new Map(settings.items.map(x=>[catalogCloudKey(x.addon_id,x.type,x.catalog_id).toLowerCase(),x]))
 const configured=home.filter((c:any)=>(profile?.catalogSettings?.items||[]).some((x:any)=>String(x.type||'').toLowerCase()===String(c.type||c.apiType||'').toLowerCase()&&String(x.catalog_id||x.catalogId||'').toLowerCase()===String(c.id||'').toLowerCase()&&(String(x.addon_id||x.addonId||'').toLowerCase()===String(c.addonId).toLowerCase()||addonKey(x.addon_id||x.addonId||'')===addonKey(c.addonUrl||''))))
 const active=configured.filter((c:any)=>byKey.get(c.cloudKey.toLowerCase())?.enabled===true).length
 function toggle(){update(rows.map((x:Addon)=>sameAddon(x,item)?{...x,enabled:x.enabled===false}:x))}
 const manifestStatus=diag?.manifest?'Disponível'+(diag.latencyMs?' · '+diag.latencyMs+' ms':''):diag?.phase==='manifest'?'Verificando…':'Indisponível ou não testado',change=diag?.manifestChange
 return <Drawer title={item.name||item.display_name||diag?.manifest?.name||'Addon'} close={close}>
 <div className="detail-cards"><div><span>Addon</span><b>{item.enabled===false?'Desativado':'Ativo'}</b></div><div><span>Manifesto</span><b>{manifestStatus}</b></div><div><span>Catálogos</span><b>{catalogs.length} · {home.length} Início · {search.length} Busca</b></div><div><span>Estado da conta</span><b>{configured.length} configurados · {active} ativos · {configured.length-active} desativados</b></div></div>
 <div className="detail-cards"><div><span>Metadata</span><b>{analysis?.capabilities?.find((x:any)=>x.name==='meta')?.declared?'Declarado · não testado':'Não declarado ou não verificável'}</b></div><div><span>Streams</span><b>{analysis?.capabilities?.find((x:any)=>x.name==='stream')?.declared?'Declarado · não testado':'Não declarado ou não verificável'}</b></div><div><span>Cloud</span><b>{token?'Sessão ativa':'Snapshot'}</b></div><div><span>Última leitura</span><b>{lastSync?new Date(lastSync).toLocaleString('pt-BR'):'—'}</b></div></div>
 {change&&<div className="manifest-change"><b>Mudança do manifesto neste navegador</b><span>{change.state==='first'?'Primeira verificação (referência criada)':change.state==='changed'?'Alteração detectada · '+(change.previousVersion||'sem versão')+' → '+(change.version||'sem versão'):change.state==='same'?'Sem mudanças desde '+(change.observedAt?new Date(change.observedAt).toLocaleString('pt-BR'):'a verificação anterior'):'Não foi possível comparar'}</span></div>}
 <div className="drawer-actions"><button className="ghost" disabled={!token} onClick={toggle}>{item.enabled===false?'Ativar addon':'Desativar addon'}</button><button className="ghost" disabled={!token||!onCopy} onClick={()=>onCopy(item)}>Copiar para perfil…</button></div>
 <p className="muted">O diagnóstico confirma a disponibilidade do manifesto e dos endpoints de catálogo testáveis sem parâmetros obrigatórios. Metadata e Streams são capacidades declaradas, não testadas por esta verificação.</p>
 {analysis&&<section className="manifest-analysis"><h3>Análise do protocolo</h3><div className="manifest-capabilities">{analysis.capabilities?.map((c:any)=><span key={c.name} className={c.declared?'capability-on':'capability-off'}>{c.declared?'✓':'—'} {c.name}{c.types?.length?' · '+c.types.join(', '):''}</span>)}</div>
 <p><b>Tipos:</b> {analysis.types?.length?analysis.types.join(', '):'Não declarados'} · <b>Configuração:</b> {analysis.configuration?.required?'obrigatória':analysis.configuration?.configurable?'disponível':'não declarada'}</p>
 {analysis.configuration?.fields?.length>0&&<div className="manifest-parameters"><b>Campos de configuração declarados</b>{analysis.configuration.fields.map((f:any,i:number)=><span key={f.key||i}>{f.title||f.key||'Campo'} · {f.type||'tipo ausente'}{f.required?' · obrigatório':''}</span>)}</div>}
 {analysis.parameters?.length>0&&<div className="manifest-parameters"><b>Parâmetros de catálogo</b>{analysis.parameters.map((f:any,i:number)=><span key={f.catalog+'-'+f.name+'-'+i}>{f.catalog}: {f.name}{f.required?' · obrigatório':' · opcional'}{f.options?.length?' · opções: '+f.options.join(', '):''}</span>)}</div>}
 {analysis.warnings?.length>0?<div className="manifest-warning-list"><b>{analysis.warnings.length} alerta(s) · atenção / não verificável</b>{analysis.warnings.map((w:any,i:number)=><span key={w.code+'-'+i}>! {w.message}</span>)}</div>:<p className="manifest-clean">✓ Campos principais do manifesto parecem completos.</p>}</section>}
 <h3>Testes de catálogo</h3>{diag?.catalogTests?.length?<div className="catalog-test-list">{diag.catalogTests.map((test:any,i:number)=><div key={test.id||test.catalogId||i}><b>{test.name||test.id||test.catalogId||'Catálogo '+(i+1)}</b><span className={test.pending?'attention':test.testable===false?'muted':test.protocolStatus==='unverified'?'attention':test.ok?'ok':'bad'}>{test.pending?'Verificando…':test.testable===false||test.protocolStatus==='unverified'?'Não verificável':test.ok?'Disponível':'Falhou'}{test.latencyMs?' · '+test.latencyMs+' ms':''}</span>{(test.error||test.reason)&&<small>{test.error||test.reason}</small>}</div>)}</div>:<p className="muted">Ainda não há testes de catálogo.</p>}
 <details className="manifest-raw"><summary>Dados técnicos completos</summary><pre>{JSON.stringify({manifest:diag?.manifest,manifestAnalysis:analysis,health:diag?.health,healthReason:diag?.healthReason,error:diag?.error,catalogTests:diag?.catalogTests?.map(({url,...test}:any)=>test),summary:diag?.summary},null,2)}</pre></details></Drawer>
}
function CatalogPage({profile,diag,diagLoading,diagProgress,q,setQ,token,saving,dirty,onChange,onRefresh}:any){
  const catalogs=allCatalogs(diag,profile.addons)
  const settings=catalogSettingsForManifests(profile.catalogSettings,catalogs)
  const [scope,setScope]=useState<'home'|'search'>('home')
  const [bulkAddon,setBulkAddon]=useState('')
  const homeCatalogs=catalogs.filter((c:any)=>!c.searchOnly && !c.isCollection)
  const searchCatalogs=catalogs.filter((c:any)=>!c.isCollection && (c.searchCapable || c.searchOnly))
  const addonOptions=Array.from(new Map(homeCatalogs.map((c:any)=>[addonKey(c.addonUrl||''),{key:addonKey(c.addonUrl||''),name:c.addonName,url:c.addonUrl}])).values())
  const filtered=(scope==='home'?homeCatalogs:searchCatalogs).filter((c:any)=>`${c.addonName} ${c.name} ${c.type} ${c.id}`.toLowerCase().includes(q.toLowerCase()))
  const byKey=new Map(settings.items.map(x=>[catalogCloudKey(x.addon_id,x.type,x.catalog_id),x]))
  const ordered=[...filtered].sort((a:any,b:any)=>{
    if(scope==='search') return Number(a.order)-Number(b.order)
    return (byKey.get(a.cloudKey)?.order??999999)-(byKey.get(b.cloudKey)?.order??999999)
  })
  function mutate(key:string,patch:any){onChange({...settings,items:settings.items.map(x=>catalogCloudKey(x.addon_id,x.type,x.catalog_id)===key?{...x,...patch}:x)})}
  function setAddonCatalogsEnabled(enabled:boolean){const keys=new Set(homeCatalogs.filter((c:any)=>addonKey(c.addonUrl||'')===bulkAddon).map((c:any)=>c.cloudKey));if(!keys.size)return;onChange({...settings,items:settings.items.map(x=>keys.has(catalogCloudKey(x.addon_id,x.type,x.catalog_id))?{...x,enabled}:x)})}
  function move(c:any,to:number){const items=[...settings.items].filter(x=>homeCatalogs.some((h:any)=>h.cloudKey===catalogCloudKey(x.addon_id,x.type,x.catalog_id))).sort((a,b)=>(a.order??0)-(b.order??0));const i=items.findIndex(x=>catalogCloudKey(x.addon_id,x.type,x.catalog_id)===c.cloudKey);const reordered=moveRowTo(items,i,to);const moved=new Map(reordered.map((x,n)=>[catalogCloudKey(x.addon_id,x.type,x.catalog_id),n]));onChange({...settings,items:settings.items.map(x=>moved.has(catalogCloudKey(x.addon_id,x.type,x.catalog_id))?{...x,order:moved.get(catalogCloudKey(x.addon_id,x.type,x.catalog_id))}:x)})}
  const addonIsEnabled=(c:any)=>profile.addons.find((a:any)=>addonKey(a.url||'')===addonKey(c.addonUrl||''))?.enabled!==false
  const activeHome=homeCatalogs.filter((c:any)=>addonIsEnabled(c)&&byKey.get(c.cloudKey)?.enabled===true).length
  const configuredHome=homeCatalogs.filter((c:any)=>byKey.has(c.cloudKey)).length
  const searchEnabled=searchCatalogs.filter((c:any)=>addonIsEnabled(c)).length
  return <div className="stack catalog-management">
    <div className="toolbar catalog-toolbar"><div className="search-wrap">⌕<input placeholder={scope==='home'?'Buscar catálogo do início…':'Buscar catálogo de busca…'} value={q} onChange={e=>setQ(e.target.value)}/></div><button className="ghost" disabled={diagLoading} onClick={onRefresh}>{diagLoading?'Atualizando…':'Atualizar addons'}</button>{diagLoading&&<span className="catalog-summary">Diagnóstico: {diagProgress.completed}/{diagProgress.total} addons respondidos; catálogos aparecem conforme chegam</span>}<span className="catalog-summary">{activeHome}/{homeCatalogs.length} no início · {searchEnabled}/{searchCatalogs.length} disponíveis para busca</span></div>
    <div className="catalog-scope-tabs"><button className={scope==='home'?'active':''} onClick={()=>setScope('home')}>Início <span>{homeCatalogs.length}</span></button><button className={scope==='search'?'active':''} onClick={()=>setScope('search')}>Busca <span>{searchCatalogs.length}</span></button></div>
    {scope==='home'&&<div className="toolbar catalog-bulk-actions"><label>Ações por addon<select className="toolbar-select" value={bulkAddon} onChange={e=>setBulkAddon(e.target.value)}><option value="">Selecione um addon…</option>{addonOptions.map((a:any)=><option key={a.key} value={a.key}>{a.name}</option>)}</select></label><button className="ghost" disabled={!token||!bulkAddon} onClick={()=>setAddonCatalogsEnabled(true)}>Ativar todos</button><button className="ghost" disabled={!token||!bulkAddon} onClick={()=>setAddonCatalogsEnabled(false)}>Desativar todos</button></div>}
    <div className="panel"><div className="panel-head"><div><h2>{scope==='home'?'Catálogos da tela inicial':'Catálogos usados pela busca'}</h2><p>{scope==='home'?'Aqui aparece o que o Nuvio pode colocar na tela inicial. Catálogos novos entram desativados para você decidir manualmente.':'Aqui aparecem os catálogos consultáveis pela busca/Discover segundo o manifesto e o estado do addon.'}</p></div><span className={'status-pill '+(token&&!dirty?'ok':'')}>{!token?'Snapshot':dirty?'Pendente':'Sincronizado'}</span></div>
      <div className="catalog-table"><div className="catalog-table-head"><span>Catálogo</span><span>Addon</span><span>Uso</span><span>Estado</span><span>Nome / origem</span><span>Ordem</span></div>
      {ordered.map((c:any,i:number)=>{const key=c.cloudKey;const s=byKey.get(key)||{addon_id:c.addonId,type:c.type,catalog_id:c.id,enabled:false,order:i,custom_title:''};const addonEnabled=addonIsEnabled(c);const searchOn=addonEnabled;const position=settings.items.filter(x=>homeCatalogs.some((h:any)=>h.cloudKey===catalogCloudKey(x.addon_id,x.type,x.catalog_id))).sort((a,b)=>(a.order??0)-(b.order??0)).findIndex(x=>catalogCloudKey(x.addon_id,x.type,x.catalog_id)===key);return <div className={'catalog-line '+((scope==='home'&&(!addonEnabled||s.enabled===false))||(scope==='search'&&!searchOn)?'is-off':'')} key={key}>
        <div className="catalog-main"><b>{s.custom_title||c.name||c.id}</b><small>{c.type} · {c.id}</small></div>
        <div className="item-sub catalog-addon">{c.addonName}</div>
        <div className="catalog-location"><span className="location-chip">{c.isCollection?'Coleção':c.searchOnly?'Busca exclusiva':c.searchCapable?'Início + Busca':'Somente início'}</span></div>
        <div className="catalog-state">{scope==='home'?<><button className={s.enabled===false?'ghost tiny-btn':'primary tiny-btn'} disabled={!token||!addonEnabled} onClick={()=>mutate(key,{enabled:s.enabled===false})}>{!addonEnabled?'Addon desativado':s.enabled===false?'Ativar':'Desativar'}</button>{!byKey.has(key)&&<small className="muted block">Novo · ainda não configurado</small>}</>:<span className={searchOn?'ok':'muted'}>{!addonEnabled?'Addon desativado':searchOn?'Disponível para busca':'Indisponível'}</span>}</div>
        <div className="catalog-custom">{scope==='home'?<details><summary>Personalizar nome</summary><input disabled={!token} value={s.custom_title||''} placeholder={c.name||c.id} onChange={e=>mutate(key,{custom_title:e.target.value})}/></details>:<span className="muted">{c.searchOnly?'Obrigatório para busca no manifesto':'Catálogo consultável pelo Nuvio'}</span>}</div>
        <div className="row-actions catalog-order">{scope==='home'&&<OrderInput value={Math.max(0,position)} max={homeCatalogs.length} disabled={!token} onCommit={to=>move(c,to)}/>}</div>
      </div>})}
      {!ordered.length&&<div className="empty">Nenhum catálogo encontrado neste grupo.</div>}</div>
      <div className="security-note">A classificação segue o manifesto: catálogos com <code>search</code> obrigatório são exclusivos da busca; os demais podem participar do Discover. O Nuvio Cloud não oferece uma configuração separada para ativar/desativar individualmente cada catálogo de busca, então esta lista é apenas informativa. A ativação e a ordem da tela inicial são sincronizadas na conta.</div>
    </div></div>
}

function PluginPage({rows,q,setQ,selected,setSelected,update,token}:any){const filtered=rows.filter((x:any)=>JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));function remove(item:any){if(!confirm(`Remover o plugin "${item.name||item.url||item.id}"?`))return;update(rows.filter((x:any)=>x!==item).map((x:any,i:number)=>({...x,sort_order:i})))}function move(item:any,to:number){const i=rows.indexOf(item);update(moveRowTo<any>(rows,i,to).map((x:any,i:number)=>({...x,sort_order:i})))}function add(){const url=prompt('URL/repositório do plugin:');if(url?.trim())update([...rows,{url:url.trim(),enabled:true,sort_order:rows.length}])}function edit(item:any){const name=prompt('Nome do plugin:',item.name||item.display_name||'');if(name!==null)update(rows.map((x:any)=>x===item?{...x,name}:x))}return <div className="stack"><div className="toolbar"><div><h2>Plugins <span className="count-badge">{rows.length}</span></h2><p>Repositórios associados ao perfil.</p></div><div className="search-wrap compact">⌕<input placeholder="Buscar…" value={q} onChange={e=>setQ(e.target.value)}/></div><button className="ghost" disabled={!token} onClick={add}>Adicionar</button></div><div className="panel table-panel management-list-panel"><div className="table-scroll mobile-card-table plugin-card-table"><table><thead><tr><th>Nome</th><th>Estado</th><th>Ordem</th><th></th></tr></thead><tbody>{filtered.map((x:any,i:number)=><tr key={x.id||x.url||i}><td data-label="Plugin"><div className="item-name">{x.name||x.title||x.display_name||`Plugin ${i+1}`}</div><div className="item-sub">{x.url||x.repository||x.id||''}</div></td><td data-label="Estado"><span className={'status-text '+(x.enabled===false?'off':'on')}><i></i>{x.enabled===false?'Desativado':'Ativo'}</span></td><td data-label="Ordem"><OrderInput value={x.sort_order??i} max={rows.length} disabled={!token} onCommit={(to)=>move(x,to)}/></td><td data-label="Ações"><div className="row-actions"><button className="row-action" onClick={()=>edit(x)}>Editar</button><button className="row-action danger" onClick={()=>remove(x)}>Remover</button></div></td></tr>)}</tbody></table></div>{!filtered.length&&<div className="empty">Nenhum plugin encontrado.</div>}</div></div>}

function CollectionPage({rows,q,setQ,selected,setSelected,update,token,onAdd,onImport,onImportUrl,onEdit,onExport}:any){const filtered=rows.filter((x:any)=>JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));function title(x:any,i:number){return x?.title||x?.name||x?.label||`Coleção ${i+1}`}function remove(x:any){if(!confirm(`Remover a coleção "${title(x,rows.indexOf(x))}"?`))return;update(rows.filter((v:any)=>v!==x))}function move(x:any,to:number){const i=rows.indexOf(x);update(moveRowTo(rows,i,to))}return <div className="stack"><div className="toolbar"><div><h2>Coleções <span className="count-badge">{rows.length}</span></h2><p>Editor visual de coleções, pastas e fontes.</p></div><div className="search-wrap compact">⌕<input placeholder="Buscar coleção…" value={q} onChange={e=>setQ(e.target.value)}/></div><button className="ghost" disabled={!token} onClick={onImport}>Importar JSON</button><button className="ghost" disabled={!token} onClick={onImportUrl}>Importar URL</button><button className="primary" disabled={!token} onClick={onAdd}>Nova coleção</button></div><div className="panel table-panel management-list-panel"><div className="table-scroll mobile-card-table collection-card-table"><table><thead><tr><th>Nome</th><th>Pastas</th><th>Fontes</th><th>Ordem</th><th></th></tr></thead><tbody>{filtered.map((x:any,i:number)=><tr key={x.id||i} onClick={()=>setSelected(x)}><td data-label="Coleção"><div className="item-name">{title(x,i)}</div><div className="item-sub">{x.id||''}</div></td><td data-label="Pastas"><span className="number-chip">{Array.isArray(x.folders)?x.folders.length:0}</span></td><td data-label="Fontes"><span className="number-chip">{collectionSourceCount(x)}</span></td><td data-label="Ordem"><OrderInput value={rows.indexOf(x)} max={rows.length} disabled={!token} onCommit={(to)=>move(x,to)}/></td><td data-label="Ações"><div className="row-actions"><button className="row-action" disabled={!token} onClick={e=>{e.stopPropagation();onEdit(x)}}>Editar</button><button className="row-action" onClick={e=>{e.stopPropagation();onExport(x)}}>Exportar</button><button className="row-action danger" disabled={!token} onClick={e=>{e.stopPropagation();remove(x)}}>Remover</button></div></td></tr>)}</tbody></table></div>{!filtered.length&&<div className="empty">Nenhuma coleção encontrada.</div>}</div>{selected&&<Drawer title={title(selected,rows.indexOf(selected))} close={()=>setSelected(null)}><div className="detail-cards"><div><span>Pastas</span><b>{selected.folders?.length||0}</b></div><div><span>Fontes</span><b>{collectionSourceCount(selected)}</b></div><div><span>Posição</span><b>{rows.indexOf(selected)+1}</b></div><div><span>Modo</span><b>{selected.viewMode||selected.view_mode||'—'}</b></div></div><div className="drawer-actions"><button className="primary" disabled={!token} onClick={()=>{onEdit(selected);setSelected(null)}}>Editar coleção</button></div><pre>{JSON.stringify(selected,null,2)}</pre></Drawer>}</div>}
function collectionSourceCount(x:any){return (x?.folders||[]).reduce((n:number,f:any)=>n+(f?.sources?.length||f?.catalogSources?.length||0),0)}

function CollectionEditor({value,close,save,catalogs}:any){
  const [draft,setDraft]=useState<any>(()=>structuredClone(value))
  function setFolder(i:number,patch:any){setDraft((d:any)=>({...d,folders:d.folders.map((f:any,n:number)=>n===i?{...f,...patch}:f)}))}
  function addFolder(){setDraft((d:any)=>({...d,folders:[...(d.folders||[]),{id:`folder-${crypto.randomUUID()}`,title:'Nova pasta',coverEmoji:'🎬',tileShape:'LANDSCAPE',sources:[]}]}))}
  function removeFolder(i:number){setDraft((d:any)=>({...d,folders:d.folders.filter((_:any,n:number)=>n!==i)}))}
  function changeSources(folder:any,change:(sources:any[])=>any[]){const field=Array.isArray(folder.sources)?'sources':Array.isArray(folder.catalogSources)?'catalogSources':'sources';return {...folder,[field]:change(folder[field]||[])}}
  function addSource(i:number){setDraft((d:any)=>({...d,folders:d.folders.map((f:any,n:number)=>n===i?changeSources(f,sources=>[...sources,{provider:'addon',addonId:'',type:'movie',catalogId:''}]):f)}))}
  function updateSource(fi:number,si:number,key:string,val:string){setDraft((d:any)=>({...d,folders:d.folders.map((f:any,fn:number)=>fn===fi?changeSources(f,sources=>sources.map((s:any,sn:number)=>{if(sn!==si)return s;const next={...s,[key]:val};if(key==='addonId')delete next.addon_id;if(key==='catalogId')delete next.catalog_id;return next})):f)}))}
  function removeSource(fi:number,si:number){setDraft((d:any)=>({...d,folders:d.folders.map((f:any,fn:number)=>fn===fi?changeSources(f,sources=>sources.filter((_:any,n:number)=>n!==si)):f)}))}
  function chooseCatalog(fi:number,si:number,value:string){if(!value)return;const [addonId,type,catalogId]=JSON.parse(value);updateSource(fi,si,'addonId',addonId);updateSource(fi,si,'type',type);updateSource(fi,si,'catalogId',catalogId)}
  function submit(){let invalid='';(draft.folders||[]).forEach((f:any,fi:number)=>{(f.sources||f.catalogSources||[]).forEach((s:any,si:number)=>{if((s.provider||'addon').toLowerCase()==='addon'&&(!(s.addonId||s.addon_id)||!s.type||!(s.catalogId||s.catalog_id)))invalid=`Preencha Addon ID, Tipo e Catalog ID na fonte ${si+1} da pasta ${fi+1}.`})});if(invalid){window.alert(invalid);return}save(draft)}
  return <SimpleModal title="Editor de coleção" close={close}><div className="form-grid">
    <label className="form-label">Nome<input value={draft.title||''} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
    <div className="editor-list">{(draft.folders||[]).map((f:any,fi:number)=><div className="editor-block" key={f.id||fi}>
      <div className="editor-block-head"><b>Pasta {fi+1}</b><button className="icon-btn tiny danger-btn" onClick={()=>removeFolder(fi)}>×</button></div>
      <label className="form-label">Título<input value={f.title||''} onChange={e=>setFolder(fi,{title:e.target.value})}/></label>
      <div className="source-list">{(f.sources||f.catalogSources||[]).map((s:any,si:number)=><div className="editor-block" key={si}>
        {(s.provider||'addon').toLowerCase()==='addon'?<>
          <div className="source-row"><select value="" onChange={e=>chooseCatalog(fi,si,e.target.value)}><option value="">Sugestões do manifesto (opcional)</option>{catalogs.map((c:any)=><option key={c.cloudKey} value={JSON.stringify([c.addonId,c.type,c.id])}>{c.addonName} · {c.name||c.id} ({c.type})</option>)}</select><button className="icon-btn tiny danger-btn" onClick={()=>removeSource(fi,si)}>×</button></div>
          <div className="source-meta-grid"><label className="form-label">Addon ID<input value={s.addonId||s.addon_id||''} onChange={e=>updateSource(fi,si,'addonId',e.target.value)} placeholder="ID do manifesto"/></label><label className="form-label">Tipo<input value={s.type||''} onChange={e=>updateSource(fi,si,'type',e.target.value)} placeholder="movie, series…"/></label><label className="form-label">Catalog ID<input value={s.catalogId||s.catalog_id||''} onChange={e=>updateSource(fi,si,'catalogId',e.target.value)} placeholder="ID mesmo se não estiver no manifesto"/></label><label className="form-label">Título nesta coleção<input value={s.title||''} onChange={e=>updateSource(fi,si,'title',e.target.value)} placeholder="Opcional"/></label></div>
        </>:<div className="source-row"><span className="muted">Fonte {s.provider||'externa'} preservada</span><button className="icon-btn tiny danger-btn" onClick={()=>removeSource(fi,si)}>×</button></div>}
      </div>)}</div>
      <button className="ghost tiny-btn" onClick={()=>addSource(fi)}>+ Fonte de catálogo</button>
    </div>)}</div>
    <button className="ghost" onClick={addFolder}>+ Adicionar pasta</button>
    <div className="modal-actions"><button className="ghost" onClick={close}>Cancelar</button><button className="primary" onClick={submit}>Salvar localmente</button></div>
  </div></SimpleModal>
}


function CollectionUrlModal({close,onImport}:any){const [url,setUrl]=useState('');const [busy,setBusy]=useState(false);async function go(){setBusy(true);try{const r=await fetch('/api/import-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Falha');onImport(d.data)}catch(e:any){alert(e.message||'Falha')}finally{setBusy(false)}}return <SimpleModal title="Importar coleções por URL" close={close}><label className="form-label">URL do JSON<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://.../collections.json" /></label><p className="security-note">A URL é buscada pelo painel e deve retornar JSON de coleções Nuvio.</p><div className="modal-actions"><button className="ghost" onClick={close}>Cancelar</button><button className="primary" disabled={!url||busy} onClick={go}>{busy?'Importando…':'Importar'}</button></div></SimpleModal>}



function AddonEditor({modal,existing=[],close,save}:any){
  const initial=modal.item||{url:'',name:'',enabled:true};const [mode,setMode]=useState<'single'|'batch'>('single');const [url,setUrl]=useState(initial.url||'');const [name,setName]=useState(initial.name||initial.display_name||'');const [enabled,setEnabled]=useState(initial.enabled!==false);const [list,setList]=useState('');const [results,setResults]=useState<any[]>([]);const [busy,setBusy]=useState(false);const [batchActive,setBatchActive]=useState(false);const batchActiveRef=useRef(false)
  async function preview(rawUrls:string[]){const unique=Array.from(new Set(rawUrls.map(x=>{try{return addonUrl(x.trim())}catch{return x.trim()}}).filter(Boolean))).filter(x=>!existing.some((a:any)=>addonKey(a.url||'')===addonKey(x)));if(!unique.length)return;setBusy(true);setResults(unique.map(url=>({url,pending:true,enabled,activeCatalogKeys:[]})));let cursor=0;const workers=Array.from({length:Math.min(4,unique.length)},async()=>{while(cursor<unique.length){const i=cursor++;const target=unique[i];try{const res=await fetch('/api/nuvio/addon-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls:[target]})});const data=await res.json();const result=data.results?.[0]||{url:target,ok:false,error:data.error||'Falha ao consultar manifesto.'};setResults(prev=>prev.map(x=>x.url===target?{...result,pending:false,enabled,activeCatalogKeys:batchActiveRef.current?(result.manifest?.catalogs||[]).filter((c:any)=>!c.searchOnly&&!c.search_only).map((c:any)=>catalogCloudKey(String(result.manifest?.id||target),String(c.type||c.apiType||''),String(c.id||''))):[]}:x))}catch(error:any){setResults(prev=>prev.map(x=>x.url===target?{url:target,pending:false,ok:false,error:error?.message||'Falha de rede',enabled,activeCatalogKeys:[]}:x))}}});await Promise.all(workers);setBusy(false)}
  function setAllCatalogs(active:boolean){batchActiveRef.current=active;setBatchActive(active);setResults(prev=>prev.map(entry=>({...entry,activeCatalogKeys:active?(entry.manifest?.catalogs||[]).filter((c:any)=>!c.searchOnly&&!c.search_only).map((c:any)=>catalogCloudKey(String(entry.manifest?.id||entry.url),String(c.type||c.apiType||''),String(c.id||''))):[]})))}
  function toggleCatalog(entry:any,c:any,checked:boolean){const key=catalogCloudKey(String(entry.manifest?.id||entry.url),String(c.type||c.apiType||''),String(c.id||''));setResults(prev=>prev.map(x=>x.url===entry.url?{...x,activeCatalogKeys:checked?Array.from(new Set([...x.activeCatalogKeys,key])):x.activeCatalogKeys.filter((k:string)=>k!==key)}:x))}
  function submit(e:React.FormEvent){e.preventDefault();if(modal.mode==='edit'){if(url.trim())save({url:addonUrl(url),name:name.trim(),enabled});return}if(!results.length){preview(mode==='single'?[url]:list.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean));return}const valid=results.filter(x=>x.ok&&x.manifest);if(valid.length)save({items:valid.map(entry=>({addon:{url:entry.url,name:entry.manifest.name||'',enabled:entry.enabled!==false},manifest:entry.manifest,activeCatalogKeys:entry.activeCatalogKeys}))})}
  const catalogs=(entry:any)=>(entry.manifest?.catalogs||[]).filter((c:any)=>!c.searchOnly&&!c.search_only)
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal addon-editor-modal"><div className="modal-head"><div><div className="eyebrow">EXTENSÕES</div><h2>{modal.mode==='add'?'Adicionar addons':'Editar addon'}</h2></div><button className="icon-btn" onClick={close}>×</button></div>{modal.mode==='edit'?<form onSubmit={submit} className="form-grid"><label className="form-label">URL do manifesto<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…" required/></label><label className="form-label">Nome personalizado<input value={name} onChange={e=>setName(e.target.value)} placeholder="Opcional"/></label><label className="check-line"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Ativo</label><div className="modal-actions"><button type="button" className="ghost" onClick={close}>Cancelar</button><button className="primary">Salvar</button></div></form>:<form onSubmit={submit} className="form-grid"><div className="addon-mode-tabs"><button type="button" className={mode==='single'?'active':''} onClick={()=>{setMode('single');setResults([])}}>Um addon</button><button type="button" className={mode==='batch'?'active':''} onClick={()=>{setMode('batch');setResults([])}}>Lista de addons</button></div>{mode==='single'?<label className="form-label">URL do manifesto<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…" required/></label>:<label className="form-label">Cole os links, um por linha<textarea rows={4} value={list} onChange={e=>setList(e.target.value)} placeholder="https://addon-um/manifest.json&#10;https://addon-dois/manifest.json" required/></label>}{!results.length&&<><label className="check-line"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Adicionar addon(s) ativo(s)</label><div className="modal-actions"><button type="button" className="ghost" onClick={close}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Consultando…':'Consultar manifestos'}</button></div></>}{results.length>0&&<><div className="batch-catalog-controls"><b>Prévia · {results.filter(x=>x.ok).length} de {results.length} manifestos disponíveis</b><div><button type="button" className="ghost" onClick={()=>setAllCatalogs(true)}>Ativar todos os catálogos</button><button type="button" className="ghost" onClick={()=>setAllCatalogs(false)}>Desativar todos</button></div></div><label className="check-line"><input type="checkbox" checked={results.every(x=>x.enabled!==false)} onChange={e=>setResults(prev=>prev.map(x=>({...x,enabled:e.target.checked})))}/> Adicionar addons ativos</label><div className="batch-preview-list">{results.map((entry:any)=>{const home=catalogs(entry);return <section className="batch-preview-item" key={entry.url}><header><div><b>{entry.manifest?.name||entry.url}</b><small>{entry.manifest?`${entry.manifest.version||'Versão não informada'} · ${home.length} catálogos · ${entry.latencyMs} ms`:entry.error||'Consultando manifesto…'}</small></div><label className="check-line"><input type="checkbox" checked={entry.enabled!==false} disabled={!entry.ok} onChange={e=>setResults(prev=>prev.map(x=>x.url===entry.url?{...x,enabled:e.target.checked}:x))}/> Ativo</label></header>{entry.manifest?.description&&<p>{entry.manifest.description}</p>}{home.length>0&&<div className="batch-catalog-list">{home.map((c:any,i:number)=>{const key=catalogCloudKey(String(entry.manifest.id||entry.url),String(c.type||c.apiType||''),String(c.id||''));return <label key={`${key}-${i}`}><input type="checkbox" checked={entry.activeCatalogKeys.includes(key)} onChange={e=>toggleCatalog(entry,c,e.target.checked)}/><span>{c.name||c.id}</span><small>{c.type||c.apiType} · {c.id}</small></label>})}</div>}</section>})}</div><div className="modal-actions"><button type="button" className="ghost" onClick={()=>setResults([])}>Voltar</button><button type="button" className="ghost" onClick={close}>Cancelar</button><button className="primary" disabled={busy||!results.some(x=>x.ok)}>{busy?'Aguardando manifestos…':`Adicionar ${results.filter(x=>x.ok).length} addon(s)`}</button></div></>}</form>}</div></div>
}

function TransferModal({source,sourceLabel,close,exportPackage,onImportFile}:any){
  const [parts,setParts]=useState({addons:true,plugins:true,collections:true,catalogs:true,library:false,watchProgress:false,watchedItems:false})
  const toggle=(k:string)=>setParts((p:any)=>({...p,[k]:!p[k]}))
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal transfer-modal">
    <div className="modal-head"><div><div className="eyebrow">TRANSFERÊNCIA</div><h2>Pacotes de configuração</h2></div><button className="icon-btn" onClick={close}>×</button></div>
    <p className="muted">Agora você não precisa conectar a conta de origem. Exporte um pacote, leve o arquivo para outro dispositivo/conta e importe somente o que quiser.</p>
    <div className="transfer-section"><h3>1. Criar pacote deste perfil</h3><div className="transfer-checks">{Object.entries(parts).map(([k,v])=><label key={k} className="check-line"><input type="checkbox" checked={v} onChange={()=>toggle(k)}/>{labelPart(k)}</label>)}</div><div className="security-note">O pacote remove senha e tokens. Addons são exportados apenas com URL, nome, estado e ordem, evitando levar APIs salvas em campos extras.</div><button className="primary full" onClick={()=>exportPackage(parts)}>Exportar pacote selecionado</button></div>
    <div className="transfer-divider"><span>ou</span></div>
    <div className="transfer-section"><h3>2. Importar pacote em uma conta conectada</h3><p className="muted">A conta atual será o destino. Depois você escolhe perfil, partes e se deseja mesclar ou substituir cada seção.</p><button className="ghost full" onClick={onImportFile}>Selecionar pacote JSON</button></div>
  </div></div>
}
function TransferImportModal({pkg,close,onApply,saving}:any){
  const available=Object.keys(pkg.parts||{})
  const [profile,setProfile]=useState(0)
  const [mode,setMode]=useState<'merge'|'replace'>('merge')
  const [selected,setSelected]=useState<Record<string,boolean>>(()=>Object.fromEntries(available.map(k=>[k,true])))
  return <div className="modal-backdrop"><div className="modal transfer-modal"><div className="modal-head"><div><div className="eyebrow">PACOTE DE TRANSFERÊNCIA</div><h2>Importar configuração</h2></div><button className="icon-btn" onClick={close}>×</button></div>
    <div className="transfer-preview"><b>{pkg.profile?.name||'Perfil sem nome'}</b><span>Exportado em {pkg.exportedAt?new Date(pkg.exportedAt).toLocaleString('pt-BR'):'—'}</span></div>
    <label className="form-label">Modo de importação<select value={mode} onChange={e=>setMode(e.target.value as any)}><option value="merge">Mesclar com o que já existe</option><option value="replace">Substituir a seção selecionada</option></select></label>
    <p className="security-note">Mesclar é a opção mais segura: itens do pacote são adicionados/atualizados sem apagar o restante. Substituir troca a seção inteira e cria um backup automático antes.</p>
    <div className="transfer-checks">{available.map(k=><label key={k} className="check-line"><input type="checkbox" checked={selected[k]!==false} onChange={e=>setSelected({...selected,[k]:e.target.checked})}/>{labelPart(k)} <small className="muted">{Array.isArray(pkg.parts[k])?`${pkg.parts[k].length} itens`:pkg.parts[k]?.items?`${pkg.parts[k].items.length} catálogos`:'configuração'}</small></label>)}</div>
    <div className="modal-actions"><button className="ghost" onClick={close}>Cancelar</button><button className="primary" disabled={saving||!Object.values(selected).some(Boolean)} onClick={()=>onApply(pkg,selected,mode)}>{saving?'Importando…':'Importar para a conta atual'}</button></div>
  </div></div>
}
function labelPart(k:string){return ({addons:'Addons',plugins:'Plugins',collections:'Coleções',catalogs:'Catálogos',library:'Biblioteca',watchProgress:'Progresso',watchedItems:'Histórico de assistidos',progress:'Progresso',history:'Histórico'} as any)[k]||k}
function persistTransferSnapshot(inv:Inventory){const existing=JSON.parse(localStorage.getItem('nuvio-snapshots')||'[]');existing.unshift({...makeLocalSnapshot(inv),label:'backup automático da conta destino'});localStorage.setItem('nuvio-snapshots',JSON.stringify(existing.slice(0,30)))}
function makeLocalSnapshot(inv:Inventory){return{schemaVersion:3,exportedAt:new Date().toISOString(),source:'Nuvio Control Center v0.11.5',inventory:inv}}

function AddonProfileTransferModal({item,sourceIndex,profiles,catalogPreferenceCount,saving,dirty,close,onCopy}:any){
 const [selected,setSelected]=useState<number[]>([]),[includeSettings,setIncludeSettings]=useState(true)
 const targets=profiles.map((x:any,index:number)=>({x,index})).filter(({index}:any)=>index!==sourceIndex)
 function toggle(index:number){setSelected((prev:number[])=>prev.includes(index)?prev.filter(x=>x!==index):[...prev,index])}
 return <SimpleModal title="Copiar addon entre perfis" close={close}><p className="muted">“{item.name||item.display_name||item.url}” será adicionado aos perfis selecionados sem remover ou alterar o perfil de origem. A cópia será sincronizada na conta.</p>
 {dirty&&<div className="transfer-warning">Salve ou descarte primeiro as alterações pendentes no perfil atual.</div>}
 <div className="addon-profile-targets">{targets.map(({x,index}:any)=><label key={profileId(x)} className="addon-profile-target"><input type="checkbox" checked={selected.includes(index)} onChange={()=>toggle(index)} disabled={saving}/><span>{x.profile?.name||'Perfil '+(index+1)}</span><small>{x.addons?.some((a:any)=>addonKey(a.url||'')===addonKey(item.url||''))?'Já possui este addon':(x.addons?.length||0)+' addons'}</small></label>)}</div>
 <label className="copy-settings-option"><input type="checkbox" checked={includeSettings} onChange={e=>setIncludeSettings(e.target.checked)} disabled={!catalogPreferenceCount||saving}/><span>Copiar preferências dos catálogos</span><small>{catalogPreferenceCount?catalogPreferenceCount+' preferência(s) encontrada(s) no perfil de origem':'Nenhuma preferência identificada para este addon'}</small></label>
 <div className="modal-actions"><button className="ghost" onClick={close} disabled={saving}>Cancelar</button><button className="primary" disabled={saving||dirty||!selected.length} onClick={()=>onCopy(selected,includeSettings)}>{saving?'Copiando e sincronizando…':'Copiar addon'}</button></div></SimpleModal>
}

function Drawer({title,close,children}:any){return <div className="drawer-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="app-drawer-title"><div className="drawer-head"><div><div className="eyebrow">DETALHES</div><h2 id="app-drawer-title">{title}</h2></div><button className="icon-btn" onClick={close} aria-label="Fechar detalhes">×</button></div>{children}</aside></div>}
function SimpleModal({title,close,children}:any){return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="app-modal-title"><div className="modal-head"><div><div className="eyebrow">CONTROLE</div><h2 id="app-modal-title">{title}</h2></div><button className="icon-btn" onClick={close} aria-label="Fechar janela">×</button></div>{children}</div></div>}
function SnapshotModal({current,compare,close,onExport,onImport}:any){
  const saved=typeof window!=='undefined'?JSON.parse(localStorage.getItem('nuvio-snapshots')||'[]'):[]
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal"><div className="modal-head"><div><div className="eyebrow">BACKUP E SNAPSHOT</div><h2>{compare?'Comparação de backup':'Proteção da configuração'}</h2></div><button className="icon-btn" onClick={close}>×</button></div>
    {compare?<Compare current={current} previous={compare}/>:<><div className="snapshot-explain"><div className="big-check">✓</div><div><h3>Seu backup é útil, sim</h3><p>Ele é uma fotografia da configuração naquele momento. O painel cria backups automáticos antes de salvar alterações e também permite exportar/importar um arquivo para guardar fora do navegador.</p></div></div><div className="mini-stats"><span>{current.profiles.length} perfis</span><span>{saved.length} backups locais</span><span>até 30 versões</span></div><div className="snapshot-actions"><button className="primary" onClick={onExport}>Exportar backup</button><button className="ghost" onClick={onImport}>Importar backup</button><button className="ghost" disabled={!saved.length} onClick={()=>alert('O botão Comparar backup usa o backup local mais recente e mostra diferenças de quantidade e itens. Para restaurar uma conta, use a transferência por arquivo e selecione o que deseja importar.')}>Para que serve?</button></div><div className="security-note">Importar um backup pelo botão acima apenas abre o conteúdo para consulta. Ele não altera sua conta automaticamente. Para aplicar dados em outra conta, use <b>Transferência por arquivo</b>.</div></>}
  </div></div>
}
function Compare({current,previous}:any){
  const count=(inv:any,key:string)=>(inv?.profiles||[]).reduce((n:number,p:any)=>n+(p[key]?.length||0),0)
  const label=(x:any)=>String(x?.name||x?.display_name||x?.title||x?.url||x?.id||'Sem nome')
  const diff=(key:string)=>{const a=(previous?.profiles||[]).flatMap((p:any)=>p[key]||[]).map(label);const b=(current?.profiles||[]).flatMap((p:any)=>p[key]||[]).map(label);return {added:b.filter((x:string)=>!a.includes(x)).slice(0,12),removed:a.filter((x:string)=>!b.includes(x)).slice(0,12)}}
  const keys=[['addons','Addons'],['plugins','Plugins'],['collections','Coleções'],['watchProgress','Progresso'],['library','Biblioteca'],['watchedItems','Histórico']]
  return <div><p className="muted">Comparação do backup mais recente com o estado atual. Não é uma previsão: mostra o que mudou entre as duas fotografias.</p><div className="compare-grid">{keys.map(([k,l])=>{const d=count(current,k)-count(previous,k);return <div key={k}><span>{l}</span><b>{count(previous,k)} → {count(current,k)}</b><small>{d===0?'Sem alteração':`${d>0?'+':''}${d} itens`}</small></div>})}</div><div className="diff-list">{keys.map(([k,l])=>{const d=diff(k);if(!d.added.length&&!d.removed.length)return null;return <div className="diff-block" key={k}><b>{l}</b>{d.added.length>0&&<div><span className="diff-added">Adicionados</span>{d.added.map((x:string,i:number)=><small key={i}>+ {x}</small>)}</div>}{d.removed.length>0&&<div><span className="diff-removed">Removidos</span>{d.removed.map((x:string,i:number)=><small key={i}>− {x}</small>)}</div>}</div>})}</div></div>
}
function ImportModal({close,fileRef,importSnapshot}:any){return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal small-modal"><div className="modal-head"><div><div className="eyebrow">IMPORTAÇÃO</div><h2>Abrir snapshot</h2></div><button className="icon-btn" onClick={close}>×</button></div><p className="muted">O arquivo é lido localmente e não altera a conta.</p><button className="primary full" onClick={()=>fileRef.current?.click()}>Selecionar JSON</button><input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e=>e.target.files?.[0]&&importSnapshot(e.target.files[0])}/></div></div>}
