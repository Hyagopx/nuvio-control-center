'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addonKey, addonUrl, catalogCloudKey, catalogSettingsForManifests, flattenManifestCatalogs,
  getField, mediaTitle, mediaType, normalizeCollections, normalizeInventory, profileId, seriesKey, watchRecordMatches,
  type Addon, type CatalogSettings, type Inventory, type ProfileRecord,
} from '../lib/nuvio'
import { changedSections, describeSections, findProfile, findProfileIndex, planSave, sameProfiles, verifySavedSections, type WritableSection } from '../lib/sync-safety'
import { LEGACY_SNAPSHOT_STORAGE_KEY, readIndexedSnapshots, readLocalSnapshots, storeIndexedSnapshot, storeLocalSnapshot } from '../lib/local-snapshots'
import { parseJsonFile, parseLegacySnapshots, serializeJsonBlob } from '../lib/browser-json'
import { LibraryPage, WatchPage } from '../components/screens/ProfileDataScreens'
import { Brand } from '../components/ui/Brand'
import { Icon, type IconName } from '../components/ui/Icon'
import { ManagementToolbar } from '../components/ui/ManagementToolbar'

const NAV = [
  ['overview', 'Visão geral', 'Resumo da conta'],
  ['addons', 'Addons', 'Extensões instaladas'],
  ['catalogs', 'Catálogos', 'Todos os catálogos'],
  ['plugins', 'Plugins', 'Extensões de serviço'],
  ['collections', 'Coleções', 'Coleções e organização'],
  ['watch', 'Progresso', 'Progresso e histórico'],
  ['library', 'Biblioteca', 'Itens salvos e Trakt'],
] as const
const NAV_ICONS: Record<(typeof NAV)[number][0], IconName> = {
  overview: 'grid', addons: 'addons', catalogs: 'catalogs', plugins: 'plugins',
  collections: 'collections', watch: 'progress', library: 'library',
}

const EMPTY_PROFILE: ProfileRecord = { profile: {}, addons: [], plugins: [], collections: [], watchProgress: [], watchedItems: [], library: [], catalogSettings: null }
type Snapshot = { schemaVersion: number; exportedAt: string; source: string; inventory: Inventory }
type Health = { health?: 'healthy' | 'attention' | 'fail' | 'unknown'; latencyMs?: number; error?: string; healthReason?: string; manifest?: any; catalogTests?: any[]; summary?: any; phase?: string }
type Session = { email?: string; remember?: boolean; refresh_token?: string }

function recordManifestChange(profile:number,url:string,manifest:any){
  const fingerprint=(value:any)=>{const stable=(v:any):string=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o:any,key)=>{o[key]=x[key];return o},{ }):x);let hash=2166136261;for(const char of stable(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(16)}
  const key=`nuvio-manifest:${profile}:${addonKey(url)}`,version=String(manifest?.version||'');const next={fingerprint:fingerprint(manifest),version,observedAt:new Date().toISOString()}
  try{const previous=JSON.parse(localStorage.getItem(key)||'null');localStorage.setItem(key,JSON.stringify(next));if(!previous)return{state:'first',version};return{state:previous.fingerprint===next.fingerprint?'same':'changed',previousVersion:String(previous.version||''),version,observedAt:previous.observedAt}}catch{return{state:'unavailable',version}}
}


export default function Home() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
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
  const [compare, setCompare] = useState<Inventory | null>(null)
  const [snapshotCount, setSnapshotCount] = useState(0)
  const [backupStatus, setBackupStatus] = useState('')
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
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null)
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
    let session: Session | null = null
    try {
      const raw = localStorage.getItem('nuvio-session')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') session = parsed as Session
        if (session?.email) setEmail(session.email)
        setRemember(session?.remember === true || Boolean(session?.refresh_token))
      }
    } catch { localStorage.removeItem('nuvio-session') }
    const restore = async () => {
      try {
        const response = await fetch('/api/nuvio/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          // Supports a one-time migration from the old localStorage session.
          body: JSON.stringify({ remember: session?.remember === true || Boolean(session?.refresh_token), ...(session?.refresh_token ? { refresh_token: session.refresh_token } : {}) }),
        })
        const data = await response.json()
        if (!response.ok) {
          if (response.status === 400 || response.status === 401) {
            localStorage.removeItem('nuvio-session')
            await fetch('/api/nuvio/logout', { method: 'POST' }).catch(() => undefined)
          }
          return
        }
        const emailAddress = data.user?.email || session?.email || ''
        setEmail(emailAddress)
        setToken(data.access_token)
        if (session?.remember === true || session?.refresh_token) {
          localStorage.setItem('nuvio-session', JSON.stringify({ email: emailAddress, remember: true }))
          setRemember(true)
        } else {
          localStorage.removeItem('nuvio-session')
          setRemember(false)
        }
        const next = await fetchInventoryStatic(data.access_token)
        installServerInventory(next)
      } catch { /* Preserve a potentially valid cookie during temporary network failures. */ }
      finally { setBooting(false) }
    }
    void restore()
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

  useEffect(() => {
    if (!mobileNavOpen) return
    const previousOverflow = document.body.style.overflow
    const sidebar = document.getElementById('primary-sidebar')
    const focusable = () => Array.from(sidebar?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || []).filter(item => item.getClientRects().length > 0)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
      if (event.key === 'Tab') {
        const items = focusable()
        if (!items.length) return
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || !sidebar?.contains(document.activeElement))) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !sidebar?.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    const closeOnDesktopResize = () => {
      if (window.innerWidth > 820) setMobileNavOpen(false)
    }
    document.body.style.overflow = 'hidden'
    focusable()[0]?.focus()
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnDesktopResize)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnDesktopResize)
      mobileNavTriggerRef.current?.focus()
    }
  }, [mobileNavOpen])

  async function fetchInventoryStatic(accessToken: string) {
    const r = await fetch('/api/nuvio/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: accessToken }) })
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha ao carregar inventário')
    return normalizeInventory(d)
  }
  async function fetchInventory(accessToken = token) { if (!accessToken) throw new Error('Sessão Nuvio não disponível.'); return fetchInventoryStatic(accessToken) }

  async function fetchAllProfileData(kind:'library'|'history', id:number, report:(message:string)=>void=()=>{}) {
    const all:any[]=[]
    for(let page=1;page<=500;page++){
      report(`Carregando ${kind==='library'?'biblioteca':'histórico'} · página ${page}…`)
      const response=await fetch('/api/nuvio/profile-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,profileId:id,kind,page})})
      const data=await response.json();if(!response.ok)throw new Error(data.error||`Falha ao exportar ${kind}.`)
      all.push(...data.items)
      if(!data.hasMore)return all
    }
    throw new Error(`O limite de páginas foi atingido ao exportar ${kind}.`)
  }

  async function completeInventoryForBackup(source:Inventory, report:(message:string)=>void=()=>{}) {
    if(!token)return source
    const profiles=[]
    for(const record of source.profiles){
      const next={...record}
      const name=String(record.profile?.name||`Perfil ${profileId(record)}`)
      if(next.libraryLoaded===false){report(`Coletando biblioteca de ${name}…`);next.library=await fetchAllProfileData('library',profileId(record),report);next.libraryLoaded=true;next.libraryPage=Math.ceil(next.library.length/100);next.libraryHasMore=false}
      if(next.watchedItemsLoaded===false){report(`Coletando histórico de ${name}…`);next.watchedItems=await fetchAllProfileData('history',profileId(record),report);next.watchedItemsLoaded=true;next.watchedItemsPage=Math.ceil(next.watchedItems.length/100);next.watchedItemsHasMore=false}
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
      const r = await fetch('/api/nuvio/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, remember }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha no login')
      const next = await fetchInventory(d.access_token)
      setToken(d.access_token); installServerInventory(next); setPassword(''); setActive(0); setTab('overview'); setDirty(false)
      if (remember) localStorage.setItem('nuvio-session', JSON.stringify({ email, remember: true }))
      else localStorage.removeItem('nuvio-session')
    } catch (e: any) { setError(e.message || 'Erro') } finally { setLoading(false) }
  }

  function makeSnapshot(customInv = inv): Snapshot { return { schemaVersion: 4, exportedAt: new Date().toISOString(), source: 'Nuvio Control Center v0.12.0', inventory: customInv || { fetchedAt: new Date().toISOString(), profiles: [] } } }
  async function storeComparisonSnapshot(snapshot:any) {
    try { return await storeIndexedSnapshot(snapshot) }
    catch { const result=storeLocalSnapshot(localStorage,snapshot);if(!result.saved)throw new Error('O navegador não conseguiu guardar o ponto local. Exporte um backup para manter uma cópia.');return{count:result.count} }
  }
  async function persistSnapshot(customInv = inv, label = '') {
    if (!customInv) return false
    const partialSections=partialSectionsFor(customInv)
    try { const result=await storeComparisonSnapshot({ ...makeComparisonSnapshot(customInv), label, partialSections });setSnapshotCount(result.count);return true }
    catch { return false }
  }
  function partialSectionsFor(customInv:Inventory) { return customInv.profiles.flatMap(profile=>[
      ...(profile.libraryLoaded===false?[`library:${profileId(profile)}`]:[]),
      ...(profile.watchedItemsLoaded===false?[`watchedItems:${profileId(profile)}`]:[]),
    ]) }
  async function saveSnapshotLocal() {
    if (!inv) return
    setBackupStatus('Salvando um ponto de comparação local…')
    setSnapshotOpen(true)
    setCompare(null)
    try {
      const partial=partialSectionsFor(inv)
      const result=await storeComparisonSnapshot({...makeComparisonSnapshot(inv),label:'ponto de comparação',partialSections:partial})
      setSnapshotCount(result.count)
      setNotice(partial.length?'Ponto de comparação salvo. Biblioteca ou histórico ainda não carregados ficam indicados como parciais.':'Ponto de comparação local salvo.')
    } catch(e:any) { setNotice(e.message||'Não foi possível salvar o ponto de comparação local.') }
    finally { setBackupStatus('') }
  }
  async function downloadSnapshot(customInv = inv) {
    if (!customInv) return
    setBackupStatus('Preparando backup completo…')
    try { const complete=await completeInventoryForBackup(customInv,setBackupStatus); const partial=partialSectionsFor(complete); setBackupStatus('Montando arquivo de backup…'); const b=await serializeJsonBlob({...makeSnapshot(complete),partialSections:partial},2); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `nuvio-backup-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); if(partial.length)setNotice('Backup exportado parcialmente; ele indica os dados que não estavam carregados.') } catch(e:any) { setError(e.message||'Falha ao exportar backup completo.') } finally { setBackupStatus('') }
  }
  async function importSnapshot(file: File) {
    setBackupStatus('Lendo backup em segundo plano…')
    try { const raw=await parseJsonFile(file); const data = normalizeInventory(raw?.inventory?.profiles ? raw.inventory : raw); serverBaselineRef.current = null; setInv(data); setToken(''); localStorage.removeItem('nuvio-session'); void fetch('/api/nuvio/logout',{method:'POST'}); setEmail(''); setActive(0); setTab('overview'); setSelected(null); setDirty(false); setError(''); setNotice('Backup aberto somente para consulta. Ele não altera a conta.') } catch(e:any) { setError(e.message||'Backup inválido.') } finally { setBackupStatus('') }
  }
  async function loadSnapshotHistory() {
    let saved:any[]=[]
    try { saved=await readIndexedSnapshots() } catch {}
    if(!saved.length)saved=readLocalSnapshots(localStorage)
    if(!saved.length){const legacy=localStorage.getItem(LEGACY_SNAPSHOT_STORAGE_KEY);if(legacy){setBackupStatus('Lendo snapshots anteriores em segundo plano…');try{saved=await parseLegacySnapshots(legacy)}catch(e:any){setError(e.message||'Não foi possível ler os snapshots anteriores.')}}}
    return saved
  }
  async function openSnapshotHub() {
    setSnapshotOpen(true);setCompare(null);setBackupStatus('Carregando snapshots…')
    const saved=await loadSnapshotHistory()
    setSnapshotCount(saved.length);setBackupStatus('')
  }
  async function openCompare() {
    setSnapshotOpen(true);setCompare(null);setBackupStatus('Carregando pontos de comparação…')
    const saved=await loadSnapshotHistory()
    setBackupStatus('')
    setSnapshotCount(saved.length)
    if(saved.length){setCompare(saved[0].inventory as Inventory);setNotice(saved[0].partialSections?.length?`Este ponto local é parcial; não incluía ${saved[0].partialSections.length} conjunto(s) ainda não carregados.`:'Ponto local mais recente carregado para comparação.')}else{setCompare(null);setError('Ainda não há pontos de comparação locais.')}
    setSnapshotOpen(true)
  }

  function sanitizeTransferPart(kind: string, value: any) {
    if (kind === 'addons') return (Array.isArray(value) ? value : []).map((x:any,i:number)=>({ url: addonUrl(x?.url || ''), name: String(x?.name || x?.display_name || ''), enabled: x?.enabled !== false, sort_order: i })).filter((x:any)=>x.url)
    if (kind === 'plugins') return (Array.isArray(value) ? value : []).map((x:any,i:number)=>({ url: String(x?.url || x?.repository || ''), name: String(x?.name || x?.display_name || ''), enabled: x?.enabled !== false, sort_order: i })).filter((x:any)=>x.url)
    return value ?? []
  }
  async function downloadTransferPackage(parts: Record<string,boolean>) {
    if (!inv) return
    setBackupStatus('Montando pacote de transferência…')
    try { const source=p;const packageData = { schemaVersion: 1, kind: 'nuvio-transfer-package', exportedAt: new Date().toISOString(), source: 'Nuvio Control Center v0.12.0', profile: { name: profileLabel, profile_index: profileId(source) }, parts: Object.fromEntries(Object.entries(parts).filter(([,v])=>v).map(([k])=>[k, sanitizeTransferPart(k, (source as any)[k === 'catalogs' ? 'catalogSettings' : k])])), note: 'Pacote sem senhas. Addons são exportados somente com URL, nome, estado e ordem.' };const b=await serializeJsonBlob(packageData,2);const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=`nuvio-transfer-${String(profileLabel).replace(/[^a-z0-9_-]+/gi,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000) } catch(e:any) { setError(e.message||'Não foi possível montar o pacote.') } finally { setBackupStatus('') }
  }
  async function openTransferPackage(file: File) {
    setBackupStatus('Lendo pacote em segundo plano…')
    try { const raw=await parseJsonFile(file); if(raw?.kind!=='nuvio-transfer-package' || !raw?.parts) throw new Error('Este arquivo não é um pacote de transferência do Nuvio Control Center.'); setTransferPackage(raw); setTransferFileOpen(true) } catch(e:any) { setError(e.message||'Pacote inválido.') } finally { setBackupStatus('') }
  }
  async function applyTransferPackage(pkg:any, selectedParts: Record<string,boolean>, mode:'merge'|'replace') {
    if (!token) { setError('Conecte uma conta Nuvio destino antes de importar.'); return }
    setSaving(true); setError(''); setBackupStatus('Preparando ponto de segurança…'); let completed:string[]=[]
    try {
      setBackupStatus('Salvando ponto de segurança…')
      await persistSnapshot(inv, 'backup antes da importação de pacote')
      setBackupStatus('Conferindo perfil de destino…')
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
      if (selectedParts.library && Array.isArray(part('library'))) { next.library = await fetchAllProfileData('library',profileId(p),setBackupStatus); next.library = mode==='replace' ? part('library') : mergeByIdentity(next.library, part('library')); next.libraryLoaded=true }
      if (selectedParts.progress && Array.isArray(part('watchProgress'))) next.watchProgress = mode==='replace' ? part('watchProgress') : mergeByIdentity(next.watchProgress, part('watchProgress'))
      if (selectedParts.history && Array.isArray(part('watchedItems'))) { next.watchedItems = await fetchAllProfileData('history',profileId(p),setBackupStatus); next.watchedItems = mode==='replace' ? part('watchedItems') : mergeByIdentity(next.watchedItems, part('watchedItems')); next.watchedItemsLoaded=true }
      if (selectedParts.catalogs && part('catalogs')) next.catalogSettings = mergeCatalogSettings(next.catalogSettings, part('catalogs'), mode)
      const kinds: Array<[string,any]> = [['addons',next.addons],['plugins',next.plugins],['collections',next.collections],['catalog-settings',next.catalogSettings],['library',next.library],['watch-progress',next.watchProgress],['watched-items',next.watchedItems]]
      for (const [kind,items] of kinds) { const key = kind==='catalog-settings'?'catalogs':kind==='watch-progress'?'progress':kind==='watched-items'?'history':kind; if (!selectedParts[key]) continue;setBackupStatus(`Aplicando ${labelPart(key).toLowerCase()}…`);const r=await fetch('/api/nuvio/mutate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,profileId:profileId(p),kind,items,settings:kind==='catalog-settings'?items:undefined})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||`Falha ao importar ${key}`);completed.push(key) }
      const fresh=await fetchInventory(token),savedProfile=findProfile(fresh,profileId(p))
      if(savedProfile&&selectedParts.library){savedProfile.library=await fetchAllProfileData('library',profileId(p),setBackupStatus);savedProfile.libraryLoaded=true}
      if(savedProfile&&selectedParts.history){savedProfile.watchedItems=await fetchAllProfileData('history',profileId(p),setBackupStatus);savedProfile.watchedItemsLoaded=true}
      const differences=verifySavedSections(next,savedProfile,selectedSections)
      if(differences.length)throw new Error(`A nuvem foi relida, mas não confirmou: ${describeSections(differences)}.`)
      installServerInventory(fresh); setDirty(false); setTransferFileOpen(false); setTransferPackage(null); setNotice('Pacote importado, salvo e verificado na conta atual.')
    } catch(e:any){if(completed.length){try{const fresh=await fetchInventory(token);installServerInventory(fresh)}catch{};setError(`${e.message||'Falha na importação'} Partes enviadas: ${completed.join(', ')}. A conta foi relida; confira as partes restantes antes de tentar novamente.`)}else setError(e.message||'Falha na importação')} finally {setSaving(false);setBackupStatus('')}
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
      await persistSnapshot(inv, `antes de salvar ${kind}`)
      const items = itemsOverride || (kind === 'addons' ? p.addons : kind === 'plugins' ? p.plugins : p.collections)
      const r = await fetch('/api/nuvio/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, profileId: profileId(p), kind, items }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Falha ao salvar')
      const fresh = await fetchInventory(token); installServerInventory(fresh); setDirty(false); setNotice(`${kind === 'addons' ? 'Addons' : kind === 'plugins' ? 'Plugins' : 'Collections'} salvos e relidos da conta.`)
    } catch (e: any) { setError(e.message || 'Falha ao salvar') } finally { setSaving(false) }
  }
  async function saveCatalogSettings(settings: CatalogSettings) {
    if (!token) { setError('Snapshot é somente leitura.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      await persistSnapshot(inv, 'antes de salvar catálogos')
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
      await persistSnapshot(inv, 'backup antes de salvar todas as alterações')
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

  async function removeWatchRecords(target?:any) {
    if (!token) throw new Error('Entre na conta Nuvio para remover registros de progresso.')
    if (dirty) throw new Error('Salve ou descarte as alterações pendentes antes de remover progresso.')
    const id=profileId(p), completed:string[]=[]
    setSaving(true);setError('');setNotice('')
    try {
      await persistSnapshot(inv, target?'antes de remover progresso':'antes de limpar progresso e histórico')
      const latest=await fetchInventory(token),remote=findProfile(latest,id)
      if(!remote)throw new Error('O perfil não foi encontrado na conta atualizada.')
      const history=await fetchAllProfileData('history',id)
      const nextProgress=target?remote.watchProgress.filter(x=>!watchRecordMatches(x,target)):[]
      const nextHistory=target?history.filter(x=>!watchRecordMatches(x,target)):[]
      const progressRemoved=remote.watchProgress.length-nextProgress.length,historyRemoved=history.length-nextHistory.length
      if(target&&!progressRemoved&&!historyRemoved)throw new Error('Este registro não foi encontrado na conta. Atualize o histórico e tente novamente.')
      const operations:[string,any[]][]=[['watch-progress',nextProgress],['watched-items',nextHistory]]
      for(const [kind,items] of operations){
        const response=await fetch('/api/nuvio/mutate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,profileId:id,kind,items})})
        const data=await response.json();if(!response.ok)throw new Error(data.error||`Falha ao atualizar ${kind==='watch-progress'?'progresso':'histórico'}.`)
        completed.push(kind)
      }
      const fresh=await fetchInventory(token),saved=findProfile(fresh,id)
      if(!saved)throw new Error('Não foi possível reler o perfil após a remoção.')
      const savedHistory=await fetchAllProfileData('history',id)
      if(target){
        if(saved.watchProgress.length!==nextProgress.length||savedHistory.length!==nextHistory.length||saved.watchProgress.some(x=>watchRecordMatches(x,target))||savedHistory.some(x=>watchRecordMatches(x,target)))throw new Error('A conta recebeu a alteração, mas a releitura não confirmou a remoção completa.')
      }else if(saved.watchProgress.length||savedHistory.length)throw new Error('A conta recebeu a solicitação, mas ainda há registros na releitura.')
      const profileIndex=findProfileIndex(fresh.profiles,id)
      fresh.profiles[profileIndex]={...saved,watchedItems:savedHistory,watchedItemsLoaded:true,watchedItemsPage:Math.ceil(savedHistory.length/100),watchedItemsHasMore:false}
      installServerInventory(fresh);setDirty(false)
      setNotice(target?'Registro removido do progresso e do histórico.':`Progresso e histórico limpos (${remote.watchProgress.length+history.length} registro(s)).`)
    } catch(e:any) {
      if(completed.length){try{const fresh=await fetchInventory(token),saved=findProfile(fresh,id),history=await fetchAllProfileData('history',id),index=findProfileIndex(fresh.profiles,id);if(saved&&index>=0)fresh.profiles[index]={...saved,watchedItems:history,watchedItemsLoaded:true,watchedItemsPage:Math.ceil(history.length/100),watchedItemsHasMore:false};installServerInventory(fresh);setDirty(false)}catch{};throw new Error(`${e.message||'Falha ao remover registros'} Parte da atualização foi enviada (${completed.join(', ')}); confira o progresso e o histórico atualizados.`)}
      throw e
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
      await persistSnapshot(inv, 'antes de copiar addon entre perfis')
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

  async function deleteManagedProfile(profileIndex:number) {
    if (!token || !inv) { setError('Conecte uma conta Nuvio para gerenciar perfis.'); return }
    const target = findProfile(inv, profileIndex)
    if (!target) { setError('O perfil não foi encontrado nesta leitura.'); return }
    if (profileIndex === 1) { setError('O perfil principal não pode ser excluído.'); return }
    if (inv.profiles.length <= 1) { setError('A conta precisa manter pelo menos um perfil.'); return }
    if (dirty) { setError('Salve ou descarte as alterações pendentes antes de excluir um perfil.'); return }
    const name = String(target.profile?.name || `Perfil ${profileIndex}`)
    if (!window.confirm(`Excluir o perfil “${name}” da conta Nuvio? Os dados associados a esse perfil poderão ser removidos permanentemente.`)) return
    await persistSnapshot(inv, `antes de excluir ${name}`)
    setSaving(true); setError(''); setNotice('')
    try {
      const latest = await fetchInventory(token)
      if (!sameProfiles(serverBaselineRef.current, latest)) throw new Error('A lista de perfis mudou em outro dispositivo. Nenhum perfil foi excluído; releia a conta antes de tentar novamente.')
      if (!findProfile(latest, profileIndex)) throw new Error('O perfil já não existe na conta atualizada.')
      const response = await fetch('/api/nuvio/mutate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token,profileId:profileIndex,kind:'profile-delete'}) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Falha ao excluir perfil.')
      const fresh = await fetchInventory(token)
      if (findProfile(fresh, profileIndex)) throw new Error('A exclusão foi enviada, mas o perfil ainda aparece na releitura da Cloud.')
      const nextActiveId = profileId(p) === profileIndex ? profileId(fresh.profiles[0]) : profileId(p)
      installServerInventory(fresh)
      setActive(Math.max(0, fresh.profiles.findIndex(x=>profileId(x)===nextActiveId)))
      setDiagnosticsByProfile(previous=>{const next={...previous};delete next[String(profileIndex)];return next})
      setDiagnosticLoadingByProfile(previous=>{const next={...previous};delete next[String(profileIndex)];return next})
      setDiagnosticProgressByProfile(previous=>{const next={...previous};delete next[String(profileIndex)];return next})
      setSelected(null); setDirty(false); setProfileManagerOpen(false); setProfileFormOpen(false); setNotice(`Perfil “${name}” excluído e confirmado por releitura.`)
    } catch (e:any) { setError(e.message || 'Falha ao excluir perfil.') }
    finally { setSaving(false) }
  }

  function mergeByUrl(target:any[], incoming:any[]){ const out=[...target]; for(const x of incoming){ const i=out.findIndex((y:any)=>addonKey(y?.url||y?.repository||'')===addonKey(x?.url||x?.repository||'')); if(i>=0) out[i]={...out[i],...x}; else out.push(x) } return out.map((x:any,i:number)=>({...x,sort_order:i})) }
  function mergeByIdentity(target:any[], incoming:any[]){ const out=[...target]; for(const x of incoming){ const key=String(x?.content_id||x?.contentId||x?.videoId||x?.id||x?.imdb_id||x?.tmdb_id||JSON.stringify(x)); const i=out.findIndex((y:any)=>String(y?.content_id||y?.contentId||y?.videoId||y?.id||y?.imdb_id||y?.tmdb_id||JSON.stringify(y))===key); if(i>=0) out[i]={...out[i],...x}; else out.push(x) } return out }
  function mergeCollections(target:any[], incoming:any[]){ const out=[...target]; for(const x of incoming){ const key=String(x?.id||x?.title||x?.name||''); const i=out.findIndex((y:any)=>String(y?.id||y?.title||y?.name||'')===key); if(i>=0) out[i]=x; else out.push(x) } return out }
  function mergeCatalogSettings(target:CatalogSettings|null, incoming:CatalogSettings, mode:'merge'|'replace'):CatalogSettings { if(mode==='replace') return structuredClone(incoming); const base:CatalogSettings = target || {hide_unreleased_content:false,items:[]}; const map=new Map(base.items.map(x=>[catalogCloudKey(x.addon_id,x.type,x.catalog_id),x])); for(const x of incoming.items||[]) map.set(catalogCloudKey(x.addon_id,x.type,x.catalog_id),x); return {...base, ...incoming, items:Array.from(map.values())} }

  function navigate(id: string) { setTab(id); setQuery(''); setSelected(null); setProfileDataError(''); setMobileNavOpen(false) }
  function logout() { diagnosticSessionRef.current++; diagnosticRunsRef.current.clear(); localStorage.removeItem('nuvio-session'); void fetch('/api/nuvio/logout',{method:'POST'}); setInv(null); setToken(''); setDiagnosticsByProfile({}); setDiagnosticLoadingByProfile({}); setDiagnosticProgressByProfile({}); setSelected(null); setCompare(null); setDirty(false); setNotice('') }

  if (booting) return <div className="login-wrap"><div className="login-card"><div className="brand large"><Brand /></div><div className="login-copy"><h1>Restaurando sessão…</h1><p>Verificando a sessão salva sem pedir sua senha novamente.</p></div></div></div>
  if (!inv) return <Login email={email} setEmail={setEmail} password={password} setPassword={setPassword} loading={loading} error={error} backupStatus={backupStatus} remember={remember} setRemember={setRemember} onSubmit={login} onImport={() => fileRef.current?.click()} fileRef={fileRef} importSnapshot={importSnapshot} />

  const profileLabel = p.profile?.name || `Perfil ${active + 1}`
  return <div className={`app-shell${sidebarCollapsed?' sidebar-collapsed':''}${mobileNavOpen?' mobile-nav-open':''}`}>
    <aside id="primary-sidebar" className={`sidebar${mobileNavOpen?' mobile-open':''}`} role={mobileNavOpen?'dialog':'complementary'} aria-label="Navegação e conta" aria-modal={mobileNavOpen||undefined}>
      <div className="brand"><Brand className="brand-wordmark" /><Brand variant="mark" className="brand-mark" /><button type="button" className="sidebar-collapse" aria-label={mobileNavOpen?'Fechar menu':sidebarCollapsed?'Expandir menu':'Recolher menu'} title={mobileNavOpen?'Fechar menu':sidebarCollapsed?'Expandir menu':'Recolher menu'} onClick={()=>{if(window.matchMedia('(max-width: 820px)').matches)setMobileNavOpen(false);else setSidebarCollapsed(v=>!v)}}><Icon name={mobileNavOpen?'close':sidebarCollapsed?'chevron-right':'chevron-left'} size={19}/></button></div>
      <div className="account-card"><div className="eyebrow">CONTA</div><div className="account-email">{email || 'Snapshot importado'}</div><small>{token ? 'Sessão ativa' : 'Somente leitura'}</small></div>
      <nav className="nav" aria-label="Navegação principal"><div className="nav-label">PAINEL</div>{NAV.map(([id,label]) => <button key={id} type="button" title={sidebarCollapsed?label:undefined} aria-current={tab===id?'page':undefined} className={tab===id?'active':''} onClick={() => navigate(id)}><span className="nav-mark"><Icon name={NAV_ICONS[id]} size={19}/></span><span className="nav-text">{label}</span><em>{id==='addons'?counts.addons:id==='catalogs'?catalogCount(p,diag):id==='plugins'?counts.plugins:id==='collections'?counts.collections:id==='watch'?counts.progress:id==='library'?counts.library:''}</em></button>)}</nav>
      <div className={`sidebar-utilities${utilitiesOpen?' open':''}`}><div className="nav-label utility-section-title">CONTA E FERRAMENTAS</div><button type="button" className="utilities-toggle" aria-expanded={utilitiesOpen} onClick={()=>setUtilitiesOpen(v=>!v)}><span>Conta e ferramentas</span><Icon name={utilitiesOpen?'chevron-down':'chevron-right'} size={17}/></button><div className="sidebar-tools"><button type="button" title="Transferência por arquivo" aria-label="Transferência por arquivo" onClick={() => setTransferOpen(true)}><span className="utility-mark"><Icon name="transfer" size={17}/></span><span>Transferência por arquivo</span></button><button type="button" title="Backup e snapshots" aria-label="Backup e snapshots" onClick={()=>void openSnapshotHub()}><span className="utility-mark"><Icon name="backup" size={17}/></span><span>Backup e snapshots</span></button><button type="button" title="Comparar backup" aria-label="Comparar backup" onClick={()=>void openCompare()}><span className="utility-mark"><Icon name="grid" size={17}/></span><span>Comparar backup</span></button></div><div className="sidebar-bottom"><button type="button" title="Exportar backup" aria-label="Exportar backup" onClick={() => downloadSnapshot()}><span className="utility-mark"><Icon name="external" size={17}/></span><span>Exportar backup</span></button><button type="button" title={token ? 'Sair da conta' : 'Fechar snapshot'} aria-label={token ? 'Sair da conta' : 'Fechar snapshot'} onClick={logout}><span className="utility-mark"><Icon name="user" size={17}/></span><span>{token ? 'Sair da conta' : 'Fechar snapshot'}</span></button></div></div>
    </aside>
    {mobileNavOpen&&<button className="mobile-nav-backdrop" aria-label="Fechar menu" onClick={()=>setMobileNavOpen(false)} />}
    <main className="content">
      <div className="mobile-topbar"><button ref={mobileNavTriggerRef} className="mobile-nav-trigger" type="button" aria-label="Abrir menu" aria-expanded={mobileNavOpen} aria-controls="primary-sidebar" onClick={()=>setMobileNavOpen(true)}><Icon name="menu"/></button><Brand className="mobile-wordmark" /></div>
      <div className="profile-strip"><div className="profile-label">PERFIS</div><div className="profile-tabs">{inv.profiles.map((x,i)=>{const avatar=getProfileAvatarUrl(x.profile,inv.avatarCatalog);return <button key={x.profile?.id || x.profile?.profile_index || i} className={i===active?'active':''} disabled={saving} onClick={() => void selectProfile(i)}><span className={`profile-dot${avatar?' has-image':''}`}>{avatar?<img src={avatar} alt=""/>:(x.profile?.name || `P${i+1}`).slice(0,1).toUpperCase()}</span><span className="profile-name">{x.profile?.name || `Perfil ${i+1}`}</span></button>})}</div><button className="ghost profile-manage-button" disabled={!token} onClick={()=>setProfileManagerOpen(true)}>Gerenciar perfis</button></div>
      <div className="page-head"><div><div className="eyebrow">CENTRO DE CONTROLE NUVIO</div><h1>{NAV.find(x=>x[0]===tab)?.[1] || 'Visão geral'}</h1><p>{profileLabel} · {NAV.find(x=>x[0]===tab)?.[2]}</p></div><div className="head-actions">{dirty && <span className="status-pill">ALTERAÇÕES LOCAIS</span>} {error && <button className="ghost" onClick={() => setError('')}>Fechar erro</button>}</div></div>
      {notice && <div className="notice" role="status" aria-live="polite">✓ {notice}</div>}{error && <div className="alert" role="alert">{error}</div>}
      {dirty && <div className="pending-bar pending-global"><div><b>Há alterações não salvas</b><span>{token ? 'Você pode continuar editando. Ao sair, também será lembrado de salvar.' : 'O arquivo está em modo somente leitura.'}</span></div><div className="pending-actions"><button className="ghost" disabled={saving||!token} onClick={async()=>{try{const fresh=await fetchInventory(token);installServerInventory(fresh);setDirty(false);setNotice('Alterações locais descartadas.')}catch(e:any){setError(e.message||'Não foi possível recarregar.')}}}>Descartar</button><button className="primary" disabled={saving||!token} onClick={saveAll}>{saving?'Salvando…':'Salvar todas'}</button></div></div>}
      {tab === 'overview' && <Overview p={p} counts={{...counts,catalogs:catalogCount(p,diag)}} inv={inv} live={!!token} onNavigate={navigate} onRename={() => { setProfileManagerOpen(true); openProfileEditor(active) }} />}
      {tab === 'addons' && <AddonPage profile={p} rows={p.addons} diag={diag} loading={diagLoading} diagnose={() => diagnose(p.addons)} q={query} setQ={setQuery} selected={selected} setSelected={setSelected} update={(items:any[]) => updateProfile(x => ({ ...x, addons: items }))} onAdd={() => setAddonModal({ mode:'add' })} onEdit={(item: Addon) => setAddonModal({ mode:'edit', item })} onCopy={(item:Addon)=>setAddonTransfer({item,sourceIndex:active})} token={!!token} lastSync={inv.fetchedAt} onDiagnosticUpdate={(url:string, patch:any)=>setDiagnosticsByProfile(prev=>({...prev,[activeProfileKey]:{...(prev[activeProfileKey]||{}),[url]:{...(prev[activeProfileKey]?.[url]||{}),...patch}}}))} />}
      {tab === 'catalogs' && <CatalogPage profile={p} diag={diag} diagLoading={diagLoading} diagProgress={diagProgress} q={query} setQ={setQuery} token={!!token} saving={saving} dirty={dirty} onChange={(settings:CatalogSettings) => updateProfile(x => ({ ...x, catalogSettings: settings }))} onRefresh={() => diagnose(p.addons)} />}
      {tab === 'plugins' && <PluginPage rows={p.plugins} q={query} setQ={setQuery} selected={selected} setSelected={setSelected} update={(items:any[]) => updateProfile(x => ({ ...x, plugins: items }))} token={!!token} />}
      {tab === 'collections' && <CollectionPage rows={p.collections} q={query} setQ={setQuery} selected={selected} setSelected={setSelected} update={(items:any[]) => updateProfile(x => ({ ...x, collections: items }))} token={!!token} onAdd={() => setCollectionModal(newCollection())} onImport={() => collectionFileRef.current?.click()} onImportUrl={() => setCollectionImportOpen(true)} onEdit={(x:any)=>setCollectionModal(x)} onExport={(x:any)=>downloadCollection(x)} />}
      {tab === 'watch' && <WatchPage rows={p.watchProgress} history={p.watchedItems} addons={p.addons} loading={profileDataLoading==='history'} error={profileDataError} hasMore={p.watchedItemsHasMore} onLoadMore={()=>void loadProfileData('history')} canDelete={!!token&&!dirty} deleting={saving} onDeleteItem={(item:any)=>removeWatchRecords(item)} onDeleteAll={()=>removeWatchRecords()} />}
      {tab === 'library' && <LibraryPage rows={p.library} token={token} profile={p} onUpdate={(items:any[]) => updateProfile(x => ({ ...x, library: items }))} loading={profileDataLoading==='library'} error={profileDataError} hasMore={p.libraryHasMore} onLoadMore={()=>void loadProfileData('library')} />}
    </main>
    {snapshotOpen && <SnapshotModal compare={compare} current={inv} savedCount={snapshotCount} backupStatus={backupStatus} close={() => { setSnapshotOpen(false); setCompare(null) }} onSave={saveSnapshotLocal} onExport={()=>downloadSnapshot()} onImport={()=>fileRef.current?.click()} onCompare={()=>void openCompare()} />}
    {profileModal && <SimpleModal title="Renomear perfil" close={() => setProfileModal(false)}><label className="form-label">Nome do perfil<input value={profileName} onChange={e=>setProfileName(e.target.value)} /></label><div className="modal-actions"><button className="ghost" onClick={()=>setProfileModal(false)}>Cancelar</button><button className="primary" disabled={saving||!profileName.trim()} onClick={saveProfileName}>{saving?'Salvando…':'Salvar'}</button></div></SimpleModal>}
    {profileManagerOpen&&<ProfileManagerModal profiles={inv.profiles} avatarCatalog={inv.avatarCatalog||[]} saving={saving} draft={profileDraft} setDraft={setProfileDraft} editIndex={profileEditIndex} formOpen={profileFormOpen} openEditor={openProfileEditor} back={()=>setProfileFormOpen(false)} saveProfile={saveManagedProfile} clearPin={clearManagedProfilePin} deleteProfile={deleteManagedProfile} close={()=>{setProfileManagerOpen(false);setProfileFormOpen(false);setProfileEditIndex(null)}} />}
    {addonTransfer && <AddonProfileTransferModal item={addonTransfer.item} sourceIndex={addonTransfer.sourceIndex} profiles={inv.profiles} catalogPreferenceCount={(inv.profiles[addonTransfer.sourceIndex]?.catalogSettings?.items||[]).filter((s:any)=>{const ids=[String(diag[addonTransfer.item.url||'']?.manifest?.id||''),String(addonTransfer.item.id||''),String(addonTransfer.item.url||''),addonKey(addonTransfer.item.url||'')].map(x=>x.toLowerCase());const saved=String(s.addon_id||s.addonId||'').toLowerCase();return ids.includes(saved)||ids.includes(addonKey(saved))}).length} saving={saving} dirty={dirty} close={()=>setAddonTransfer(null)} onCopy={copyAddonToProfiles} />}
  {addonModal && <AddonEditor modal={addonModal} existing={p.addons} close={()=>setAddonModal(null)} save={(value:any)=>{ const existing=p.addons; if(addonModal.mode==='edit'){updateProfile(x=>({...x,addons:existing.map(a=>sameAddon(a,addonModal.item)?{...a,...value}:a)}))}else{const incoming=value.items.map((entry:any,i:number)=>({...entry.addon,sort_order:existing.length+i}));const previewCatalogs=value.items.flatMap((entry:any)=>flattenManifestCatalogs(entry.addon,entry.manifest));let catalogSettings=p.catalogSettings;if(previewCatalogs.length){catalogSettings=catalogSettingsForManifests(p.catalogSettings,[...allCatalogs(diag,existing),...previewCatalogs]);const chosen=new Set(value.items.flatMap((entry:any)=>entry.activeCatalogKeys||[]));catalogSettings={...catalogSettings,items:catalogSettings.items.map((item:any)=>chosen.has(catalogCloudKey(item.addon_id,item.type,item.catalog_id))?{...item,enabled:true}:item)}}updateProfile(x=>({...x,addons:[...existing,...incoming],catalogSettings}))}setTab('catalogs');setAddonModal(null) }} />}
    {collectionModal && <CollectionEditor value={collectionModal} close={()=>setCollectionModal(null)} catalogs={allCatalogs(diag,p.addons)} save={(x:any)=>{ const old=p.collections; const exists=old.some(v=>String(v.id)===String(x.id)); const next=exists?old.map(v=>String(v.id)===String(x.id)?x:v):[...old,x]; updateProfile(v=>({...v,collections:next})); setCollectionModal(null) }} />}
    {collectionImportOpen && <CollectionUrlModal close={()=>setCollectionImportOpen(false)} onImport={(data:any)=>{ const incoming=normalizeCollections(data); if(incoming.length){ updateProfile(v=>({...v,collections:[...v.collections,...incoming]})); setNotice(`${incoming.length} coleção(ões) importada(s) localmente.`); setCollectionImportOpen(false) } else setError('O JSON não contém coleções reconhecíveis.') }} />}
    {transferOpen && <TransferModal source={p} sourceLabel={profileLabel} close={()=>setTransferOpen(false)} exportPackage={downloadTransferPackage} onImportFile={()=>transferFileRef.current?.click()} backupStatus={backupStatus} />}{transferFileOpen && transferPackage && <TransferImportModal pkg={transferPackage} close={()=>{setTransferFileOpen(false);setTransferPackage(null)}} onApply={applyTransferPackage} saving={saving} backupStatus={backupStatus} />}
    <input ref={transferFileRef} type="file" accept=".json,application/json" hidden onChange={async e=>{const input=e.currentTarget;const f=input.files?.[0];if(f)await openTransferPackage(f);input.value=''}} />
    {backupStatus&&!snapshotOpen&&!transferOpen&&!transferFileOpen&&<div className="backup-toast" role="status"><span className="progress-spinner"/><span>{backupStatus}</span></div>}
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

function Login({email,setEmail,password,setPassword,loading,error,backupStatus,onSubmit,onImport,fileRef,importSnapshot,remember,setRemember}:any){return <div className="login-wrap"><div className="login-card"><div className="brand large"><Brand /></div><div className="login-copy"><h1>Seu centro de operações</h1><p>Gerencie e audite sua configuração Nuvio em um único painel.</p></div><form onSubmit={onSubmit}><label>E-mail Nuvio<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label><label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required /></label><label className="check-line"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} /> Manter sessão neste navegador</label><button className="primary full" disabled={loading}>{loading?'Conectando…':'Conectar ao Nuvio'}</button></form>{error&&<div className="alert">{error}</div>}<div className="login-divider"><span>ou</span></div><button className="ghost full" onClick={onImport} disabled={!!backupStatus}>{backupStatus||'Abrir snapshot'}</button><input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async e=>{const input=e.currentTarget;const file=input.files?.[0];if(file)await importSnapshot(file);input.value=''}}/>{backupStatus&&<div className="backup-progress" role="status"><span className="progress-spinner"/><span>{backupStatus}</span></div>}<p className="security-note">A opção de sessão salva mantém sua conta conectada usando um cookie protegido; sua senha não é salva.</p></div></div>}

function ProfileManagerModal({profiles,avatarCatalog,saving,draft,setDraft,editIndex,formOpen,openEditor,back,saveProfile,clearPin,deleteProfile,close}:any){
  const current=editIndex===null?null:profiles[editIndex]
  const avatarSrc=(item:any)=>item.imageUrl||item.image_url||item.url||(item.storagePath||item.storage_path?`https://api.nuvio.tv/storage/v1/object/public/avatars/${String(item.storagePath||item.storage_path).replace(/^\//,'')}`:'')
  const avatarId=(item:any)=>String(item.id||item.avatar_id||'')
  return <div className="modal-backdrop profile-manager-backdrop"><div className="modal profile-manager-modal" role="dialog" aria-modal="true" aria-labelledby="profile-manager-title"><div className="modal-head"><div><div className="eyebrow">CONTA NUVIO</div><h2 id="profile-manager-title">{formOpen?(editIndex===null?'Adicionar perfil':'Editar perfil'):'Gerenciar perfis'}</h2></div><button className="icon-btn" aria-label={formOpen?'Voltar para perfis':'Fechar gerenciamento de perfis'} onClick={formOpen?back:close}>×</button></div>
    {!formOpen?<><p className="muted">Perfis, avatares e PIN sincronizados com os aplicativos Nuvio conectados à conta.</p><div className="managed-profile-list">{profiles.map((entry:any,i:number)=>{const x=entry.profile||{};const id=Number(x.profile_index||x.id||i+1);const image=x.avatar_url||x.avatarUrl||avatarSrc(avatarCatalog.find((a:any)=>avatarId(a)===String(x.avatar_id||x.avatarId||'')));return <div className="managed-profile-row" key={id}><div className="managed-avatar">{image?<img src={image} alt="" loading="lazy" decoding="async"/>:<span>{String(x.name||`Perfil ${i+1}`).slice(0,1).toUpperCase()}</span>}</div><div className="managed-profile-info"><b>{x.name||`Perfil ${i+1}`}</b><small>{x.pin_enabled?'PIN ativado':'Sem PIN'} · Perfil {id}</small></div><div className="managed-profile-actions"><button className="ghost" disabled={saving} onClick={()=>openEditor(i)}>Editar</button>{x.pin_enabled&&<button className="ghost" disabled={saving} onClick={()=>clearPin(id)}>Remover PIN</button>}{id!==1&&<button className="ghost danger-btn" disabled={saving||profiles.length<=1} onClick={()=>deleteProfile(id)}>Excluir perfil</button>}</div></div>})}</div><div className="modal-actions"><button className="ghost" disabled={saving} onClick={close}>Fechar</button><button className="primary" disabled={saving||profiles.length>=6} onClick={()=>openEditor(null)}>Adicionar perfil</button></div>{profiles.length>=6&&<p className="security-note">Limite de 6 perfis da API Nuvio atingido.</p>}<p className="security-note">O perfil principal não pode ser excluído. A exclusão de outro perfil pode remover seus dados associados da conta.</p></>:<><label className="form-label">Nome do perfil<input autoFocus maxLength={40} value={draft.name} onChange={e=>setDraft((x:any)=>({...x,name:e.target.value}))} placeholder="Ex.: Sala, Crianças…"/></label><div className="avatar-picker"><div className="avatar-picker-head"><b>Avatar</b><span className="muted small">Escolha um avatar do Nuvio ou use uma imagem pública.</span></div><div className="avatar-options">{avatarCatalog.map((a:any)=>{const image=avatarSrc(a);const id=avatarId(a);return <button type="button" key={id||image} className={draft.avatarId===id?'selected':''} aria-pressed={draft.avatarId===id} title={a.displayName||a.display_name||id} onClick={()=>setDraft((x:any)=>({...x,avatarId:id,avatarUrl:''}))}>{image?<img src={image} alt=""/>:<span>{(a.displayName||a.display_name||'?').slice(0,1)}</span>}</button>})}</div><label className="form-label">URL da foto<input type="url" value={draft.avatarUrl} onChange={e=>setDraft((x:any)=>({...x,avatarUrl:e.target.value,avatarId:''}))} placeholder="https://…"/></label><label className="form-label">Cor de destaque<input type="color" value={draft.avatarColorHex} onChange={e=>setDraft((x:any)=>({...x,avatarColorHex:e.target.value}))}/></label></div><div className="profile-pin-fields"><label className="form-label">{current?.profile?.pin_enabled?'Novo PIN (deixe vazio para manter)':'PIN opcional'}<input inputMode="numeric" autoComplete="new-password" type="password" maxLength={8} value={draft.pin} onChange={e=>setDraft((x:any)=>({...x,pin:e.target.value.replace(/\D/g,'')}))} placeholder="4 a 8 dígitos"/></label>{current?.profile?.pin_enabled&&draft.pin&&<label className="form-label">PIN atual<input inputMode="numeric" type="password" maxLength={8} value={draft.currentPin} onChange={e=>setDraft((x:any)=>({...x,currentPin:e.target.value.replace(/\D/g,'')}))}/></label>}</div><p className="security-note">O PIN é validado e armazenado pelo Nuvio. O painel não salva o PIN localmente.</p><div className="modal-actions"><button className="ghost" onClick={back}>Voltar</button><button className="primary" disabled={saving||!draft.name.trim()||Boolean(draft.pin&&draft.pin.length<4)||Boolean(current?.profile?.pin_enabled&&draft.pin&&!draft.currentPin)} onClick={saveProfile}>{saving?'Salvando…':'Salvar e sincronizar'}</button></div></>}
  </div></div>
}

function Overview({p,counts,inv,live,onNavigate,onRename}:any){const cards=[['addons','Addons','addons'],['catalogs','Catálogos','catalogs'],['plugins','Plugins','plugins'],['collections','Coleções','collections'],['progress','Em andamento','watch'],['watched','Assistidos','watch'],['library','Biblioteca','library']];const avatar=getProfileAvatarUrl(p.profile,inv.avatarCatalog);return <div className="stack overview-page"><section className="overview-metrics" aria-label="Resumo do perfil">{cards.map(([k,label,tab])=><button type="button" className="metric metric-link" key={k} onClick={()=>onNavigate(tab)}><span>{label}</span><strong>{counts[k]}</strong><small>Ver detalhes <Icon name="chevron-right" size={14}/></small></button>)}</section><div className="overview-panels"><section className="panel overview-profile"><div className="panel-head"><div><h2>Perfil atual</h2><p>Configurações sincronizadas com o Nuvio.</p></div><span className={'status-pill '+(live?'ok':'')}>{live?'SINCRONIZADO':'SNAPSHOT'}</span></div><div className="profile-summary"><div className="avatar">{avatar?<img src={avatar} alt=""/>:(p.profile?.name||'P').slice(0,1).toUpperCase()}</div><div className="overview-profile-name"><h3>{p.profile?.name||'Perfil sem nome'}</h3><div className="muted">Perfil {p.profile?.profile_index??p.profile?.id??'—'}</div></div><button className="ghost" disabled={!live} onClick={onRename}><Icon name="edit" size={16}/>Editar perfil</button></div></section><section className="panel overview-inventory"><div className="panel-head"><div><h2>Estado do painel</h2><p>Resumo desta sessão.</p></div></div><div className="inventory-meta"><div><span>Última leitura</span><b>{new Date(inv.fetchedAt).toLocaleString('pt-BR')}</b></div><div><span>Perfis</span><b>{inv.profiles.length}</b></div><div><span>Catálogos configurados</span><b>{p.catalogSettings?.items?.filter((item:any)=>item.enabled!==false).length||0}</b></div></div></section></div></div>}

function OrderInput({value,max,disabled,onCommit}:{value:number;max:number;disabled?:boolean;onCommit:(value:number)=>void}){const [draft,setDraft]=useState(String(value+1));useEffect(()=>setDraft(String(value+1)),[value]);function commit(){const parsed=Number(draft);const next=Number.isFinite(parsed)?Math.min(max,Math.max(1,Math.round(parsed))):value+1;setDraft(String(next));if(next!==value+1)onCommit(next-1)}return <input className="order-input" aria-label="Posição na ordem" type="number" inputMode="numeric" min={1} max={Math.max(1,max)} value={draft} disabled={disabled} onClick={e=>e.stopPropagation()} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')e.currentTarget.blur()}} />}
function moveRowTo<T>(rows:T[],from:number,to:number):T[]{const next=[...rows];if(from<0||from>=next.length)return next;const [item]=next.splice(from,1);next.splice(Math.max(0,Math.min(to,next.length)),0,item);return next}
function AddonPage({profile,rows,diag,loading,diagnose,q,setQ,selected,setSelected,update,onAdd,onEdit,onCopy,token,lastSync}:any){
 const [failed,setFailed]=useState(false)
 const filtered=useMemo(()=>rows.filter((x:Addon)=>{const d=diag[x.url||''];return JSON.stringify(x).toLowerCase().includes(q.toLowerCase())&&(!failed||d?.health==='fail'||(Number(d?.summary?.failed)||0)>0)}),[rows,diag,q,failed])
 const healthRows=Object.values(diag) as Health[]
 const healthy=healthRows.filter(x=>x.health==='healthy').length,attention=healthRows.filter(x=>x.health==='attention').length,failedCount=healthRows.filter(x=>x.health==='fail').length,unverifiedCount=healthRows.filter(x=>x.health==='unknown'&&x.phase==='complete').length
 function remove(item:Addon){if(!confirm(`Remover o addon "${item.name||item.display_name||item.url}"?`))return;update(rows.filter((x:Addon)=>!sameAddon(x,item)).map((x:Addon,i:number)=>({...x,sort_order:i})))}
 function move(item:Addon,to:number){const i=rows.findIndex((x:Addon)=>sameAddon(x,item));update(moveRowTo<Addon>(rows,i,to).map((x:Addon,n)=>({...x,sort_order:n})))}
 return <div className="stack management-page">
  <ManagementToolbar value={q} onChange={setQ} label="Buscar addons" placeholder="Buscar addon pelo nome ou endereço…">
    <span className="management-count">{rows.length} {rows.length===1?'addon':'addons'}</span>
    <button type="button" className={`ghost filter-action${failed?' selected':''}`} aria-pressed={failed} onClick={()=>setFailed(!failed)}>{failed?'Mostrar todos':'Com falhas'}</button>
    <button type="button" className="ghost" onClick={onAdd} disabled={!token}><Icon name="plus" size={17}/>Adicionar</button>
    <button type="button" className="primary" disabled={loading} onClick={diagnose}><Icon name="refresh" size={17}/>{loading?'Diagnosticando…':'Diagnosticar'}</button>
  </ManagementToolbar>
  {loading&&<div className="management-summary" role="status"><span className="amber-dot"></span>{healthRows.length} de {rows.filter((x:Addon)=>x.url).length} addons responderam; resultados parciais aparecem durante o diagnóstico.</div>}
  {healthRows.length>0&&<div className="management-summary diagnostic-summary"><span><i className="green-dot"></i>{healthy} informações lidas</span><span><i className="amber-dot"></i>{attention} para revisar</span><span><i className="red-dot"></i>{failedCount} falhas ao ler</span><span>{unverifiedCount} inconclusivos</span></div>}
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
function HealthCell({d}:{d?:Health}){if(!d)return <span className="muted">Ainda não verificado</span>;const label=d.health==='healthy'?'Informações lidas':d.health==='attention'?'Revisar informações':d.health==='fail'?'Não foi possível ler':'Resultado inconclusivo';const reason=d.healthReason||d.error;const color=d.health==='fail'?'bad':d.health==='attention'||d.health==='unknown'?'attention':'ok';return <span title={reason||''} className={color}>{d.health==='healthy'?'✓':d.health==='attention'?'!':d.health==='fail'?'✕':'?'} {label}<small>{reason}</small></span>}
function AddonDrawer({item,diag,close,update,rows,token,profile,lastSync,onCopy,onDiagnosticUpdate}:any){
 const catalogs=flattenManifestCatalogs(item,diag?.manifest||{}),analysis=diag?.manifestAnalysis
 const [tab,setTab]=useState('summary'),[selected,setSelected]=useState<string[]>([]),[checking,setChecking]=useState(false),[error,setError]=useState('')
 const tests=diag?.catalogTests||[],testMap=new Map(tests.map((x:any)=>[String(x.id),x]))
 const configured=catalogs.filter((c:any)=>(profile?.catalogSettings?.items||[]).some((x:any)=>String(x.catalog_id||x.catalogId||'').toLowerCase()===String(c.id||'').toLowerCase()&&addonKey(x.addon_id||x.addonId||'')===addonKey(c.addonUrl||item.url||'')))
 async function check(ids:string[]){if(!ids.length||checking)return;setChecking(true);setError('');try{const chosen=ids.length===catalogs.length?['*']:ids;const r=await fetch('/api/nuvio/diagnose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls:[item.url],action:'check-catalogs',catalogIds:chosen})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Não foi possível verificar os catálogos.');const merged=new Map(tests.map((x:any)=>[String(x.id),x]));for(const x of d.results||[])merged.set(String(x.id),x);onDiagnosticUpdate(item.url,{catalogTests:Array.from(merged.values())});setSelected([])}catch(e:any){setError(e.message||'Falha na verificação.')}finally{setChecking(false)}}
 function toggle(){update(rows.map((x:Addon)=>sameAddon(x,item)?{...x,enabled:x.enabled===false}:x))}
 const health=diag?.health||'unknown',healthLabel=health==='fail'?'Falha ao ler informações':health==='attention'?'Revisar informações':health==='healthy'?'Informações lidas':'Ainda não verificado'
 const responseMs=Number(diag?.latencyMs),responseLabel=Number.isFinite(responseMs)?responseMs<=500?'Rápida':responseMs<=1800?'Regular':'Demorada':'Ainda não medida'
 const responseValue=Number.isFinite(responseMs)?responseMs<1000?`${Math.max(1,Math.round(responseMs))} milissegundos`:`${(responseMs/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} segundo(s)`:'—'
 const tested=tests.filter((x:any)=>Number.isFinite(Number(x.latencyMs))),testedFailed=tests.filter((x:any)=>x.status==='fail').length
 const averageTestMs=tested.length?tested.reduce((sum:number,x:any)=>sum+Number(x.latencyMs),0)/tested.length:null
 const contentTypes=Array.from(new Set([...(diag?.manifest?.types||[]),...catalogs.map((x:any)=>x.type||x.apiType)].filter(Boolean).map((x:any)=>String(x))))
 const contentLabels:Record<string,string>={movie:'Filmes',series:'Séries',tv:'Programas de TV',channel:'Canais de TV',podcast:'Podcasts',audiobook:'Audiolivros',book:'Livros',game:'Jogos'}
 const declared=analysis?.capabilities?.filter((x:any)=>x.declared)||[]
 const featureLabels:Record<string,string>={catalog:'Catálogos para navegar',meta:'Detalhes de filmes e séries',stream:'Links de reprodução',subtitles:'Legendas',addon_catalog:'Lista de outros addons'}
 const knownFeatures=new Set(Object.keys(featureLabels))
 const otherResources=Array.from(new Set((Array.isArray(diag?.manifest?.resources)?diag.manifest.resources:[]).map((x:any)=>String(typeof x==='string'?x:x?.name||'').trim()).filter((x:string)=>x&&!knownFeatures.has(x))))
 return <Drawer title={item.name||item.display_name||diag?.manifest?.name||'Addon'} close={close}>
  <div className={'addon-health-banner '+health}><span>{health==='fail'?'!':health==='healthy'?'✓':'?'}</span><div><b>{healthLabel}</b><p>{diag?.healthReason||'Leia as informações do addon para começar.'}</p></div></div>
  <div className="addon-diagnostic-tabs" role="tablist" aria-label="Informações do addon">{[['summary','Resumo'],['catalogs',`Catálogos (${catalogs.length})`],['resources','Recursos'],['technical','Técnico']].map(([key,label]:any)=><button type="button" role="tab" aria-selected={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)} key={key}>{label}</button>)}</div>
  {tab==='summary'&&<section className="addon-tab-panel"><div className="addon-summary-grid">
   <div className="addon-summary-speed"><span>Tempo para ler as informações do addon</span><b>{responseValue} · {diag?.ok===false?'com falha':responseLabel.toLowerCase()}</b><small>Este tempo mede a resposta inicial do serviço a partir do servidor do painel. Não mede o tempo para abrir ou reproduzir um vídeo.</small></div>
   <div><span>Estado deste perfil</span><b>{item.enabled===false?'Desativado':'Ativo'}</b></div>
   <div><span>Catálogos encontrados</span><b>{catalogs.length}{catalogs.some((x:any)=>x.isCollection)?` · ${catalogs.filter((x:any)=>x.isCollection).length} coleções`:''}</b></div>
   <div><span>Tipos de conteúdo informados</span><b>{contentTypes.length?contentTypes.map((x:string)=>contentLabels[x.toLowerCase()]||x).join(', '):'Não informado pelo addon'}</b></div>
   <div className="addon-summary-features"><span>O que o addon informa oferecer</span>{declared.length||otherResources.length?<div>{declared.map((x:any)=><span className="addon-feature-chip" key={x.name}>{featureLabels[x.name]||x.name}</span>)}{otherResources.map((x:any)=><span className="addon-feature-chip" key={x}>{x} (declarado)</span>)}</div>:<b>Nenhum recurso foi identificado</b>}</div>
   <div><span>Testes manuais de catálogos</span><b>{tested.length?`${tested.length} de ${catalogs.length} testados · ${testedFailed} falhas`:'Ainda não testados'}</b>{averageTestMs!==null&&<small>Tempo médio de resposta: {averageTestMs<1000?`${Math.round(averageTestMs)} milissegundos`:`${(averageTestMs/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} segundos`}</small>}</div>
  </div><p className="addon-plain-note">Os recursos acima são declarados pelo addon; a presença deles não garante que estejam funcionando. Para testar a conexão dos catálogos, escolha um ou todos na aba Catálogos. Os tempos variam conforme a rede e a disponibilidade do serviço.</p>{analysis?.warnings?.length>0&&<div className="addon-next-step"><b>Há itens para revisar</b><span>Veja a aba Recursos para entender o que pode estar incompleto.</span></div>}<div className="drawer-actions"><button className="ghost" disabled={!token} onClick={toggle}>{item.enabled===false?'Ativar addon':'Desativar addon'}</button><button className="ghost" disabled={!token||!onCopy} onClick={()=>onCopy(item)}>Copiar para perfil…</button></div></section>}
  {tab==='catalogs'&&<section className="addon-tab-panel"><p className="muted">Selecione catálogos para verificar se a conexão funciona. Você pode testar um, vários ou todos.</p><div className="catalog-check-toolbar"><label><input type="checkbox" checked={catalogs.length>0&&selected.length===catalogs.length} onChange={e=>setSelected(e.target.checked?catalogs.map((c:any)=>String(c.id)):[])}/> Selecionar todos</label><span>{selected.length} selecionado(s)</span><button className="primary" disabled={checking||!selected.length} onClick={()=>void check(selected)}>{checking?'Verificando…':'Testar selecionados'}</button></div>{error&&<div className="notice error" role="alert">{error}</div>}<div className="addon-catalog-cards">{catalogs.map((c:any,i:number)=>{const id=String(c.id||''),result=testMap.get(id) as any,resultMs=Number(result?.latencyMs),timing=Number.isFinite(resultMs)?`${resultMs<1000?`${Math.max(1,Math.round(resultMs))} milissegundos`:`${(resultMs/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} segundos`} · ${resultMs<=500?'rápido':resultMs<=1800?'normal':'demorado'}`:'';return <article className="addon-catalog-card" key={`${id}-${i}`}><label><input type="checkbox" checked={selected.includes(id)} onChange={()=>setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])} aria-label={`Selecionar ${c.name||id}`}/></label><div className="addon-catalog-info"><b>{c.name||id||`Catálogo ${i+1}`}</b><span>{c.type||c.apiType||'Tipo não informado'} · {id||'Identificador ausente'}</span></div><div className="addon-catalog-result">{result?<><b className={result.status==='healthy'?'ok':result.status==='fail'?'bad':'attention'}>{result.status==='healthy'?'Conexão confirmada':result.status==='fail'?'Falha de conexão':'Não foi possível confirmar'}</b><span>{result.explanation}</span>{timing&&<span>Tempo de resposta: {timing}</span>}<details><summary>Detalhes técnicos</summary><small>{result.httpStatus?`HTTP ${result.httpStatus} · `:''}{result.error||''}</small></details></>:<span>Ainda não testado</span>}</div><button className="ghost" disabled={checking} onClick={()=>void check([id])}>{result?'Testar novamente':'Testar'}</button></article>})}{!catalogs.length&&<div className="empty">Este addon não informou catálogos.</div>}</div></section>}
  {tab==='resources'&&<section className="addon-tab-panel"><h3>Recursos declarados pelo addon</h3><div className="manifest-capabilities">{analysis?.capabilities?.map((c:any)=><span key={c.name} className={c.declared?'capability-on':'capability-off'}>{c.declared?'✓':'—'} {({catalog:'Catálogos',meta:'Metadata',stream:'Streams',subtitles:'Legendas',addon_catalog:'Catálogo de addons'} as any)[c.name]||c.name}{c.types?.length?' · '+c.types.join(', '):''}</span>)}</div><p><b>Tipos:</b> {analysis?.types?.join(', ')||'Não informados'} · <b>Configuração:</b> {analysis?.configuration?.required?'Obrigatória':analysis?.configuration?.configurable?'Disponível':'Não declarada'}</p>{analysis?.parameters?.length>0&&<div className="manifest-parameters"><b>Parâmetros dos catálogos</b>{analysis.parameters.map((x:any,i:number)=><span key={i}>{x.catalog}: {x.name}{x.required?' · obrigatório':' · opcional'}{x.options?.length?' · opções: '+x.options.join(', '):''}</span>)}</div>}{analysis?.warnings?.length>0?<div className="manifest-warning-list"><b>Itens para revisar</b>{analysis.warnings.map((x:any,i:number)=><span key={i}>{x.message}</span>)}</div>:<p className="manifest-clean">Os campos principais informados estão presentes.</p>}</section>}
  {tab==='technical'&&<section className="addon-tab-panel"><p className="muted">Dados brutos para quem deseja investigar a conexão e o manifesto.</p><details className="manifest-raw" open><summary>Dados técnicos completos</summary><pre>{JSON.stringify({url:item.url,target:diag?.target,finalUrl:diag?.finalUrl,httpStatus:diag?.httpStatus,latencyMs:diag?.latencyMs,error:diag?.error,manifest:diag?.manifest,manifestAnalysis:analysis,catalogTests:tests},null,2)}</pre></details></section>}
 </Drawer>
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
  return <div className="stack management-page catalog-management">
    <ManagementToolbar className="catalog-toolbar" value={q} onChange={setQ} label="Buscar catálogos" placeholder={scope==='home'?'Buscar catálogo do início…':'Buscar catálogo de busca…'}>
      <span className="management-count">{ordered.length} {ordered.length===1?'catálogo':'catálogos'}</span>
      <button type="button" className="ghost" disabled={diagLoading} onClick={onRefresh}><Icon name="refresh" size={17}/>{diagLoading?'Atualizando…':'Atualizar addons'}</button>
    </ManagementToolbar>
    <div className="catalog-overview"><span>{activeHome}/{homeCatalogs.length} no início</span><span>{searchEnabled}/{searchCatalogs.length} disponíveis para busca</span>{diagLoading&&<span role="status">Diagnóstico: {diagProgress.completed}/{diagProgress.total} addons respondidos; catálogos aparecem conforme chegam</span>}<span className={'status-pill '+(token&&!dirty?'ok':'')}>{!token?'Snapshot':dirty?'Pendente':'Sincronizado'}</span></div>
    <div className="catalog-scope-tabs"><button type="button" className={scope==='home'?'active':''} aria-pressed={scope==='home'} onClick={()=>setScope('home')}>Início <span>{homeCatalogs.length}</span></button><button type="button" className={scope==='search'?'active':''} aria-pressed={scope==='search'} onClick={()=>setScope('search')}>Busca <span>{searchCatalogs.length}</span></button></div>
    {scope==='home'&&<div className="toolbar catalog-bulk-actions"><label>Ações por addon<select className="toolbar-select" value={bulkAddon} onChange={e=>setBulkAddon(e.target.value)}><option value="">Selecione um addon…</option>{addonOptions.map((a:any)=><option key={a.key} value={a.key}>{a.name}</option>)}</select></label><button className="ghost" disabled={!token||!bulkAddon} onClick={()=>setAddonCatalogsEnabled(true)}>Ativar todos</button><button className="ghost" disabled={!token||!bulkAddon} onClick={()=>setAddonCatalogsEnabled(false)}>Desativar todos</button></div>}
    <section className="catalog-list-section" aria-label={scope==='home'?'Catálogos da tela inicial':'Catálogos usados pela busca'}>
      <div className="catalog-section-heading"><div><h2>{scope==='home'?'Catálogos da tela inicial':'Catálogos usados pela busca'}</h2><p>{scope==='home'?'Catálogos novos entram desativados para você decidir manualmente.':'Catálogos consultáveis segundo o manifesto e o estado do addon.'}</p></div></div>
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
    </section>
  </div>
}

function PluginPage({rows,q,setQ,update,token}:any){
 const [editing,setEditing]=useState<any|null>(null),[draft,setDraft]=useState({name:'',url:''}),[formError,setFormError]=useState('')
 const filtered=rows.filter((x:any)=>JSON.stringify(x).toLowerCase().includes(q.toLowerCase()))
 function remove(item:any){if(!confirm(`Remover o plugin "${item.name||item.url||item.id}"?`))return;update(rows.filter((x:any)=>x!==item).map((x:any,i:number)=>({...x,sort_order:i})))}
 function move(item:any,to:number){const i=rows.indexOf(item);update(moveRowTo<any>(rows,i,to).map((x:any,i:number)=>({...x,sort_order:i})))}
 function add(){const url=prompt('URL/repositório do plugin:');if(url?.trim())update([...rows,{url:url.trim(),enabled:true,sort_order:rows.length}])}
 function openEditor(item:any){setEditing(item);setDraft({name:String(item.name||item.display_name||item.title||''),url:String(item.url||item.repository||'')});setFormError('')}
 function closeEditor(){setEditing(null);setFormError('')}
 function save(e:any){e.preventDefault();let parsed:URL;try{parsed=new URL(draft.url.trim());if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname)throw new Error()}catch{setFormError('Informe um endereço completo começando com https:// ou http://.');return}const normalized=parsed.toString();update(rows.map((x:any)=>x===editing?{...x,url:normalized,...('repository' in x?{repository:normalized}:{}),name:draft.name.trim()||null}:x));closeEditor()}
 return <div className="stack management-page"><ManagementToolbar value={q} onChange={setQ} label="Buscar plugins" placeholder="Buscar por nome ou repositório…"><span className="management-count">{rows.length} {rows.length===1?'plugin':'plugins'}</span><button type="button" className="primary" disabled={!token} onClick={add}><Icon name="plus" size={17}/>Adicionar plugin</button></ManagementToolbar>
 <section className="management-list-panel"><div className="table-scroll mobile-card-table plugin-card-table"><table><thead><tr><th>Nome</th><th>Estado</th><th>Ordem</th><th></th></tr></thead><tbody>{filtered.map((x:any,i:number)=><tr key={x.id||x.url||i}><td data-label="Plugin"><div className="item-name">{x.name||x.title||x.display_name||`Plugin ${i+1}`}</div><div className="item-sub">{x.url||x.repository||x.id||''}</div></td><td data-label="Estado"><span className={'status-text '+(x.enabled===false?'off':'on')}><i></i>{x.enabled===false?'Desativado':'Ativo'}</span></td><td data-label="Ordem"><OrderInput value={x.sort_order??i} max={rows.length} disabled={!token} onCommit={(to)=>move(x,to)}/></td><td data-label="Ações"><div className="row-actions"><button className="row-action" onClick={()=>openEditor(x)}>Editar</button><button className="row-action danger" onClick={()=>remove(x)}>Remover</button></div></td></tr>)}</tbody></table></div>{!filtered.length&&<div className="empty">Nenhum plugin encontrado.</div>}</section>
 {editing&&<div className="modal-backdrop plugin-edit-backdrop" onMouseDown={e=>e.target===e.currentTarget&&closeEditor()}><section className="modal plugin-edit-modal" role="dialog" aria-modal="true" aria-labelledby="plugin-edit-title"><div className="modal-head"><div><div className="eyebrow">PLUGINS</div><h2 id="plugin-edit-title">Editar plugin</h2></div><button className="icon-btn" type="button" aria-label="Fechar edição" onClick={closeEditor}>×</button></div><form className="form-grid" onSubmit={save}><label className="form-label">Nome do plugin<input autoFocus value={draft.name} onChange={e=>setDraft(v=>({...v,name:e.target.value}))} placeholder="Nome para identificar o plugin"/></label><label className="form-label">Link do repositório<input type="url" inputMode="url" autoComplete="url" value={draft.url} onChange={e=>{setDraft(v=>({...v,url:e.target.value}));setFormError('')}} placeholder="https://exemplo.com/repositorio" required/><small>O link atualizado será salvo junto às configurações da conta.</small></label>{formError&&<div className="notice error" role="alert">{formError}</div>}<div className="modal-actions"><button type="button" className="ghost" onClick={closeEditor}>Cancelar</button><button type="submit" className="primary" disabled={!token}>Salvar alterações</button></div>{!token&&<p className="security-note">Entre na conta Nuvio para sincronizar alterações.</p>}</form></section></div>}
 </div>
}
function CollectionPage({rows,q,setQ,selected,setSelected,update,token,onAdd,onImport,onImportUrl,onEdit,onExport}:any){const filtered=rows.filter((x:any)=>JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));function title(x:any,i:number){return x?.title||x?.name||x?.label||`Coleção ${i+1}`}function remove(x:any){if(!confirm(`Remover a coleção "${title(x,rows.indexOf(x))}"?`))return;update(rows.filter((v:any)=>v!==x))}function move(x:any,to:number){const i=rows.indexOf(x);update(moveRowTo(rows,i,to))}return <div className="stack management-page"><ManagementToolbar value={q} onChange={setQ} label="Buscar coleções" placeholder="Buscar por nome, pasta ou fonte…"><span className="management-count">{rows.length} {rows.length===1?'coleção':'coleções'}</span><button type="button" className="ghost" disabled={!token} onClick={onImport}><Icon name="upload" size={17}/>Importar JSON</button><button type="button" className="ghost" disabled={!token} onClick={onImportUrl}><Icon name="link" size={17}/>Importar URL</button><button type="button" className="primary" disabled={!token} onClick={onAdd}><Icon name="plus" size={17}/>Nova coleção</button></ManagementToolbar><section className="management-list-panel"><div className="table-scroll mobile-card-table collection-card-table"><table><thead><tr><th>Nome</th><th>Pastas</th><th>Fontes</th><th>Ordem</th><th></th></tr></thead><tbody>{filtered.map((x:any,i:number)=><tr key={x.id||i} onClick={()=>setSelected(x)}><td data-label="Coleção"><div className="item-name">{title(x,i)}</div><div className="item-sub">{x.id||''}</div></td><td data-label="Pastas"><span className="number-chip">{Array.isArray(x.folders)?x.folders.length:0}</span></td><td data-label="Fontes"><span className="number-chip">{collectionSourceCount(x)}</span></td><td data-label="Ordem"><OrderInput value={rows.indexOf(x)} max={rows.length} disabled={!token} onCommit={(to)=>move(x,to)}/></td><td data-label="Ações"><div className="row-actions"><button className="row-action" disabled={!token} onClick={e=>{e.stopPropagation();onEdit(x)}}>Editar</button><button className="row-action" onClick={e=>{e.stopPropagation();onExport(x)}}>Exportar</button><button className="row-action danger" disabled={!token} onClick={e=>{e.stopPropagation();remove(x)}}>Remover</button></div></td></tr>)}</tbody></table></div>{!filtered.length&&<div className="empty">Nenhuma coleção encontrada.</div>}</section>{selected&&<Drawer title={title(selected,rows.indexOf(selected))} close={()=>setSelected(null)}><div className="detail-cards"><div><span>Pastas</span><b>{selected.folders?.length||0}</b></div><div><span>Fontes</span><b>{collectionSourceCount(selected)}</b></div><div><span>Posição</span><b>{rows.indexOf(selected)+1}</b></div><div><span>Modo</span><b>{selected.viewMode||selected.view_mode||'—'}</b></div></div><div className="drawer-actions"><button className="primary" disabled={!token} onClick={()=>{onEdit(selected);setSelected(null)}}>Editar coleção</button></div><details className="collection-raw-data"><summary>Dados técnicos</summary><pre>{JSON.stringify(selected,null,2)}</pre></details></Drawer>}</div>}
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
  return <SimpleModal title="Editor de coleção" close={close}><div className="form-grid collection-editor-form">
    <label className="form-label">Nome<input value={draft.title||''} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
    <div className="editor-list">{(draft.folders||[]).map((f:any,fi:number)=><div className="editor-block" key={f.id||fi}>
      <div className="editor-block-head"><b>Pasta {fi+1}</b><button type="button" className="icon-btn tiny danger-btn" aria-label={`Remover pasta ${f.title||fi+1}`} onClick={()=>removeFolder(fi)}>×</button></div>
      <label className="form-label">Título<input value={f.title||''} onChange={e=>setFolder(fi,{title:e.target.value})}/></label>
      <div className="source-list">{(f.sources||f.catalogSources||[]).map((s:any,si:number)=><div className="editor-block" key={si}>
        {(s.provider||'addon').toLowerCase()==='addon'?<>
          <div className="source-row"><select aria-label={`Escolher catálogo sugerido para a fonte ${si+1} da pasta ${fi+1}`} value="" onChange={e=>chooseCatalog(fi,si,e.target.value)}><option value="">Sugestões do manifesto (opcional)</option>{catalogs.map((c:any)=><option key={c.cloudKey} value={JSON.stringify([c.addonId,c.type,c.id])}>{c.addonName} · {c.name||c.id} ({c.type})</option>)}</select><button type="button" className="icon-btn tiny danger-btn" aria-label={`Remover fonte ${si+1} da pasta ${fi+1}`} onClick={()=>removeSource(fi,si)}>×</button></div>
          <div className="source-meta-grid"><label className="form-label">Addon ID<input value={s.addonId||s.addon_id||''} onChange={e=>updateSource(fi,si,'addonId',e.target.value)} placeholder="ID do manifesto"/></label><label className="form-label">Tipo<input value={s.type||''} onChange={e=>updateSource(fi,si,'type',e.target.value)} placeholder="movie, series…"/></label><label className="form-label">Catalog ID<input value={s.catalogId||s.catalog_id||''} onChange={e=>updateSource(fi,si,'catalogId',e.target.value)} placeholder="ID mesmo se não estiver no manifesto"/></label><label className="form-label">Título nesta coleção<input value={s.title||''} onChange={e=>updateSource(fi,si,'title',e.target.value)} placeholder="Opcional"/></label></div>
        </>:<div className="source-row"><span className="muted">Fonte {s.provider||'externa'} preservada</span><button type="button" className="icon-btn tiny danger-btn" aria-label={`Remover fonte ${si+1} da pasta ${fi+1}`} onClick={()=>removeSource(fi,si)}>×</button></div>}
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

function TransferModal({source,sourceLabel,close,exportPackage,onImportFile,backupStatus}:any){
  const [parts,setParts]=useState({addons:true,plugins:true,collections:true,catalogs:true,library:false,watchProgress:false,watchedItems:false})
  const toggle=(k:string)=>setParts((p:any)=>({...p,[k]:!p[k]}))
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal transfer-modal transfer-hub" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
    <div className="modal-head"><div><div className="eyebrow">CONTA E FERRAMENTAS</div><h2 id="transfer-modal-title">Transferir configuração</h2><p>Leve as preferências deste perfil para outro dispositivo ou conta.</p></div><button className="icon-btn" aria-label="Fechar janela" onClick={close}>×</button></div>
    <div className="transfer-source"><Icon name="user" size={18}/><span>Perfil de origem</span><b title={sourceLabel}>{sourceLabel}</b></div>
    <section className="transfer-card"><div className="transfer-card-heading"><span className="transfer-card-icon"><Icon name="external" size={18}/></span><div><h3>Exportar um pacote</h3><p>Escolha quais partes deste perfil incluir no arquivo.</p></div></div>
      <div className="transfer-checks">{Object.entries(parts).map(([k,v])=><label key={k} className="check-line"><input type="checkbox" checked={v} onChange={()=>toggle(k)}/><span>{labelPart(k)}</span></label>)}</div>
      <p className="transfer-safe-note">Senhas e tokens não são incluídos. Addons levam somente URL, nome, estado e ordem.</p>
      <button className="primary full" disabled={!!backupStatus} onClick={()=>exportPackage(parts)}>{backupStatus||'Exportar partes selecionadas'}</button>
    </section>
    <div className="transfer-or"><span>ou</span></div>
    <section className="transfer-card transfer-import-card"><div className="transfer-card-heading"><span className="transfer-card-icon"><Icon name="transfer" size={18}/></span><div><h3>Importar um pacote</h3><p>Selecione um arquivo JSON e escolha o que aplicar no perfil conectado.</p></div></div><button className="ghost full" disabled={!!backupStatus} onClick={onImportFile}>{backupStatus||'Selecionar arquivo JSON'}</button></section>
  </div></div>
}
function TransferImportModal({pkg,close,onApply,saving,backupStatus}:any){
  const available=Object.keys(pkg.parts||{})
  const [mode,setMode]=useState<'merge'|'replace'>('merge')
  const [selected,setSelected]=useState<Record<string,boolean>>(()=>Object.fromEntries(available.map(k=>[k,true])))
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&!saving&&close()}><div className="modal transfer-modal transfer-import-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-import-title"><div className="modal-head"><div><div className="eyebrow">PRÉVIA DO ARQUIVO</div><h2 id="transfer-import-title">Importar configuração</h2><p>Confira o conteúdo antes de aplicar no perfil conectado.</p></div><button className="icon-btn" aria-label="Fechar janela" disabled={saving} onClick={close}>×</button></div>
    <div className="transfer-preview"><span className="eyebrow">PERFIL NO PACOTE</span><b title={pkg.profile?.name||'Perfil sem nome'}>{pkg.profile?.name||'Perfil sem nome'}</b><small>Exportado em {pkg.exportedAt?new Date(pkg.exportedAt).toLocaleString('pt-BR'):'data não informada'}</small></div>
    <label className="form-label transfer-mode">Como combinar os dados?<select value={mode} onChange={e=>setMode(e.target.value as any)}><option value="merge">Mesclar com o perfil atual</option><option value="replace">Substituir cada parte selecionada</option></select></label>
    <p className="transfer-safe-note">Mesclar preserva o que já existe. Substituir troca a parte escolhida e salva um ponto de segurança antes.</p>
    <div className="transfer-checks">{available.map(k=><label key={k} className="check-line"><input type="checkbox" checked={selected[k]!==false} onChange={e=>setSelected({...selected,[k]:e.target.checked})}/><span>{labelPart(k)}</span><small>{Array.isArray(pkg.parts[k])?`${pkg.parts[k].length} itens`:pkg.parts[k]?.items?`${pkg.parts[k].items.length} catálogos`:'configuração'}</small></label>)}</div>
    {backupStatus&&<div className="backup-progress" role="status"><span className="progress-spinner"/><span>{backupStatus}</span></div>}<div className="modal-actions"><button className="ghost" disabled={saving} onClick={close}>Cancelar</button><button className="primary" disabled={saving||!Object.values(selected).some(Boolean)} onClick={()=>onApply(pkg,selected,mode)}>{saving?(backupStatus||'Importando…'):'Importar para a conta atual'}</button></div>
  </div></div>
}
function labelPart(k:string){return ({addons:'Addons',plugins:'Plugins',collections:'Coleções',catalogs:'Catálogos',library:'Biblioteca',watchProgress:'Progresso',watchedItems:'Histórico de assistidos',progress:'Progresso',history:'Histórico'} as any)[k]||k}
function makeComparisonSnapshot(inv:Inventory){
  const sampleLimit=250
  const categories=['addons','plugins','collections','watchProgress','library','watchedItems'] as const
  const profiles=(inv?.profiles||[]).map((record:any,index:number)=>{
    const profile={profile_index:profileId(record)||index+1,id:record.profile?.id,name:String(record.profile?.name||`Perfil ${index+1}`)}
    const snapshotCounts:Record<string,number>={}
    const compact=(item:any)=>({id:item?.id??item?.uuid??null,url:item?.url??item?.repository??null,name:String(item?.name||item?.display_name||item?.title||item?.name_en||item?.url||item?.id||'Item sem nome')})
    const next:any={profile,snapshotCounts}
    for(const key of categories){const values=Array.isArray(record?.[key])?record[key]:[];snapshotCounts[key]=values.length;next[key]=values.slice(0,sampleLimit).map(compact)}
    const settings=record?.catalogSettings?.items||[]
    snapshotCounts.catalogs=settings.length
    next.catalogSettings={...record?.catalogSettings,items:settings.slice(0,sampleLimit).map((item:any)=>({addon_id:item.addon_id,type:item.type,catalog_id:item.catalog_id,collection_id:item.collection_id,is_collection:item.is_collection,enabled:item.enabled,order:item.order,custom_title:item.custom_title}))}
    return next
  })
  return{schemaVersion:1,exportedAt:new Date().toISOString(),source:'Nuvio Control Center v0.12.0',inventory:{fetchedAt:inv?.fetchedAt||new Date().toISOString(),profiles}}
}

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
function SnapshotModal({current,compare,close,onSave,onExport,onImport,onCompare,savedCount,backupStatus}:any){
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&!backupStatus&&close()}><div className="modal snapshot-modal" role="dialog" aria-modal="true" aria-labelledby="snapshot-modal-title"><div className="modal-head"><div><div className="eyebrow">CONTA E FERRAMENTAS</div><h2 id="snapshot-modal-title">{compare?'Comparar versões':'Backups e snapshots'}</h2><p>Proteja uma cópia ou veja o que mudou na configuração.</p></div><button className="icon-btn" aria-label="Fechar janela" disabled={!!backupStatus} onClick={close}>×</button></div>
    {compare?<Compare current={current} previous={compare}/>:<><div className="snapshot-overview"><div className="snapshot-overview-mark"><Icon name="backup" size={21}/></div><div><b>Escolha como proteger seus dados</b><p>O ponto local serve para comparar versões. O backup exportado inclui os dados disponíveis e pode ser guardado como arquivo.</p></div></div>
      <div className="snapshot-stats"><div><span>Perfis</span><b>{current.profiles.length}</b></div><div><span>Pontos locais</span><b>{savedCount}</b></div><div><span>Retenção</span><b>30 versões</b></div></div>
      {backupStatus&&<div className="backup-progress" role="status"><span className="progress-spinner"/><span>{backupStatus}</span></div>}
      <div className="snapshot-action-grid"><section><span className="eyebrow">PONTO LOCAL</span><h3>Salvar para comparar depois</h3><p>Guarda uma amostra compacta dos perfis, sem carregar todo o histórico nem travar a tela.</p><button className="ghost" disabled={!!backupStatus} onClick={onSave}>Salvar ponto local</button></section><section><span className="eyebrow">COMPARAÇÃO</span><h3>Ver diferenças</h3><p>Compara o ponto salvo mais recente com o que está carregado agora.</p><button className="ghost" disabled={!!backupStatus||!savedCount} onClick={onCompare}>{savedCount?'Comparar versões':'Salve um ponto primeiro'}</button></section><section><span className="eyebrow">ARQUIVO COMPLETO</span><h3>Exportar backup</h3><p>Prepara um arquivo JSON com os dados do perfil, incluindo biblioteca e histórico disponíveis.</p><button className="primary" disabled={!!backupStatus} onClick={onExport}>{backupStatus||'Preparar e exportar backup'}</button></section></div>
      <div className="snapshot-import-row"><div><b>Abrir um backup existente</b><small>O arquivo abre em modo de consulta e não altera sua conta.</small></div><button className="ghost" disabled={!!backupStatus} onClick={onImport}>Selecionar arquivo</button></div>
      <div className="snapshot-footnote">Para aplicar configurações em outra conta, use <b>Transferência por arquivo</b>. Ela permite selecionar partes e mesclar ou substituir cada uma.</div>
    </>}
  </div></div>
}
const COMPARE_KEYS = [['addons','Addons'],['plugins','Plugins'],['collections','Coleções'],['catalogs','Catálogos'],['watchProgress','Progresso'],['library','Biblioteca'],['watchedItems','Histórico']] as const
function compareRows(profile:any,key:string){return key==='catalogs'?(profile?.catalogSettings?.items||[]):(profile?.[key]||[])}
function compareLabel(item:any){return String(item?.name||item?.display_name||item?.title||item?.name_en||item?.url||item?.repository||item?.catalog_id||item?.id||'Item sem nome')}
function compareIdentity(item:any){return String(item?.url||item?.repository||item?.addon_id||item?.catalog_id||item?.id||item?.uuid||compareLabel(item).trim().toLocaleLowerCase())}
function Compare({current,previous}:any){
  const [result,setResult]=useState<any>(null)
  useEffect(()=>{let active=true;const timer=window.setTimeout(()=>{
    const build=(inventory:any,key:string)=>{const items=new Map<string,string>();let total=0;(inventory?.profiles||[]).forEach((profile:any,index:number)=>{const rows=compareRows(profile,key),profileName=String(profile?.profile?.name||`Perfil ${index+1}`),profileKey=String(profile?.profile?.profile_index||profile?.profile?.id||index+1);total+=Number(profile?.snapshotCounts?.[key]??rows.length);for(const item of rows.slice(0,250)){const id=compareIdentity(item),label=compareLabel(item);items.set(`${profileKey}/${id}`,`${profileName} · ${label}`)}});return{items,total}}
    const rows=COMPARE_KEYS.map(([key,label])=>{const before=build(previous,key),after=build(current,key);const added:string[]=[],removed:string[]=[];after.items.forEach((name,id)=>{if(!before.items.has(id)&&added.length<12)added.push(name)});before.items.forEach((name,id)=>{if(!after.items.has(id)&&removed.length<12)removed.push(name)});return{key,label,before:before.total,after:after.total,added,removed}})
    if(active)setResult(rows)
  },30);return()=>{active=false;window.clearTimeout(timer)}},[current,previous])
  if(!result)return <div className="compare-loading" role="status"><span className="progress-spinner"/><span>Preparando a comparação…</span></div>
  return <div className="compare-content"><p className="compare-intro">Ponto local mais recente comparado com o estado atual. As contagens são completas; para manter a tela rápida, as diferenças analisam até 250 itens por perfil e exibem até 12 exemplos por seção.</p><div className="compare-grid">{result.map((item:any)=><div key={item.key}><span>{item.label}</span><b>{item.before.toLocaleString('pt-BR')} <i>→</i> {item.after.toLocaleString('pt-BR')}</b><small>{item.after===item.before?'Sem alteração':`${item.after-item.before>0?'+':''}${(item.after-item.before).toLocaleString('pt-BR')} itens`}</small></div>)}</div><div className="diff-list">{result.map((item:any)=>!item.added.length&&!item.removed.length?null:<section className="diff-block" key={item.key}><h3>{item.label}</h3>{item.added.length>0&&<div><span className="diff-added">Adicionados</span>{item.added.map((name:string,i:number)=><small key={`${name}-${i}`}>+ {name}</small>)}</div>}{item.removed.length>0&&<div><span className="diff-removed">Removidos</span>{item.removed.map((name:string,i:number)=><small key={`${name}-${i}`}>− {name}</small>)}</div>}</section>)}</div>{result.every((item:any)=>!item.added.length&&!item.removed.length)&&<div className="compare-empty">Nenhuma diferença foi encontrada na amostra comparada.</div>}</div>
}
