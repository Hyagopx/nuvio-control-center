import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited, RequestJsonError } from '../../../../lib/request-json'
import { safeExternalFetch } from '../../../../lib/safe-external-fetch'

function normalizeAddonBase(raw: string) {
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('URL inválida')
  u.pathname = u.pathname.replace(/\/manifest\.json$/i, '').replace(/\/+$/, '')
  return u.toString()
}
function manifestUrl(raw: string) { return `${normalizeAddonBase(raw)}/manifest.json` }
function catalogUrl(base: string, c: any) {
  const id = String(c?.id || '').trim(), type = String(c?.type || c?.apiType || '').trim()
  if (!id || !type) return null
  return `${normalizeAddonBase(base)}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
}
function extras(c: any): any[] {
  const raw = c?.extra ?? c?.extras ?? []
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') return Object.entries(raw).map(([name, value]: any) => ({ name, ...(value && typeof value === 'object' ? value : { value }) }))
  return []
}
function isSearchOnly(c: any) {
  return Boolean(c?.searchOnly ?? c?.search_only) || extras(c).some((x: any) => String(x?.name ?? x?.key ?? '').toLowerCase() === 'search' && (x?.isRequired === true || x?.required === true))
}
function supportsSearch(c: any) {
  return isSearchOnly(c) || extras(c).some((x: any) => String(x?.name ?? x?.key ?? '').toLowerCase() === 'search') || (Array.isArray(c?.extraSupported) && c.extraSupported.some((x: any) => String(x).toLowerCase() === 'search'))
}
function analyzeManifest(m: any) {
  const warnings: Array<{ code: string; message: string }> = []
  const requiredText = ['id', 'name', 'version', 'description']
  for (const key of requiredText) if (typeof m?.[key] !== 'string' || !m[key].trim()) warnings.push({ code: `missing-${key}`, message: `Campo obrigatório "${key}" ausente ou vazio.` })
  const resources = Array.isArray(m?.resources) ? m.resources : []
  const types = Array.isArray(m?.types) ? m.types : []
  if (!Array.isArray(m?.resources)) warnings.push({ code: 'invalid-resources', message: '"resources" deveria ser uma lista; capacidades podem não estar declaradas corretamente.' })
  else if (!m.resources.length) warnings.push({ code: 'empty-resources', message: 'Nenhum recurso foi declarado; capacidades do addon não verificáveis.' })
  if (!Array.isArray(m?.types)) warnings.push({ code: 'invalid-types', message: '"types" deveria ser uma lista; tipos de conteúdo suportados não verificáveis.' })
  else if (!m.types.length) warnings.push({ code: 'empty-types', message: 'Nenhum tipo de conteúdo foi declarado.' })
  const catalogs = Array.isArray(m?.catalogs) ? m.catalogs : []
  if (!Array.isArray(m?.catalogs)) warnings.push({ code: 'invalid-catalogs', message: '"catalogs" está ausente ou não é uma lista.' })
  const declaredResources = resources.map((r: any) => typeof r === 'string' ? r : r?.name).filter((x: any) => typeof x === 'string')
  if (declaredResources.includes('catalog') && catalogs.length === 0) warnings.push({ code: 'catalog-resource-empty', message: 'O manifesto declara "catalog", mas não informa catálogos.' })
  if (!declaredResources.includes('catalog') && catalogs.length) warnings.push({ code: 'catalog-resource-undeclared', message: 'Há catálogos listados, mas "catalog" não aparece em "resources".' })
  const incompleteCatalogs: string[] = []
  const parameters: Array<{ catalog: string; name: string; required: boolean; options: string[] }> = []
  catalogs.forEach((c: any, i: number) => {
    const label = String(c?.name || c?.id || `Catálogo ${i + 1}`)
    const missing = ['type', 'id', 'name'].filter(key => typeof c?.[key] !== 'string' || !c[key].trim())
    if (missing.length) { incompleteCatalogs.push(`${label}: faltam ${missing.join(', ')}`); warnings.push({ code: 'incomplete-catalog', message: `${label}: campos obrigatórios incompletos (${missing.join(', ')}).` }) }
    if (c?.extra !== undefined && !Array.isArray(c.extra) && (!c.extra || typeof c.extra !== 'object')) warnings.push({ code: 'invalid-extra-list', message: `${label}: "extra" tem um formato não reconhecido; parâmetros não verificáveis.` })
    for (const extra of extras(c)) {
      const name = String(extra?.name ?? extra?.key ?? '').trim()
      if (!name) { warnings.push({ code: 'invalid-extra', message: `${label}: parâmetro sem nome; não verificável.` }); continue }
      const required = extra?.isRequired === true || extra?.required === true
      if (extra?.isRequired !== undefined && typeof extra.isRequired !== 'boolean') warnings.push({ code: 'invalid-extra-required', message: `${label}: indicador obrigatório de "${name}" não é booleano; requisito não verificável.` })
      if (extra?.options !== undefined && !Array.isArray(extra.options)) warnings.push({ code: 'invalid-extra-options', message: `${label}: opções de "${name}" não estão em uma lista.` })
      parameters.push({ catalog: label, name, required, options: Array.isArray(extra?.options) ? extra.options.filter((x: any) => typeof x === 'string') : [] })
    }
  })
  const hints = m?.behaviorHints && typeof m.behaviorHints === 'object' ? m.behaviorHints : {}
  const configurable = hints.configurable === true
  const configurationRequired = hints.configurationRequired === true
  const config = Array.isArray(m?.config) ? m.config : []
  if (m?.config !== undefined && !Array.isArray(m.config)) warnings.push({ code: 'invalid-config', message: '"config" não é uma lista; parâmetros de configuração não verificáveis.' })
  if (configurationRequired && !configurable) warnings.push({ code: 'required-config-not-configurable', message: 'O manifesto exige configuração, mas não declara "configurable".' })
  if (configurationRequired && !config.length) warnings.push({ code: 'required-config-missing-fields', message: 'A configuração é obrigatória, mas o manifesto não lista os campos em "config".' })
  if (configurable && !config.length) warnings.push({ code: 'config-fields-unknown', message: 'O addon é configurável, mas não declara campos; a configuração pode ser própria do serviço e não é verificável aqui.' })
  for (const field of config) {
    if (!field?.key || !field?.type) warnings.push({ code: 'incomplete-config-field', message: `Campo de configuração incompleto${field?.title ? ` (${field.title})` : ''}: "key" e "type" são necessários.` })
    if (field?.type === 'select' && !Array.isArray(field?.options)) warnings.push({ code: 'incomplete-config-options', message: `Campo de seleção${field?.title ? ` "${field.title}"` : ''} não declara opções.` })
  }
  const capabilities = ['catalog', 'meta', 'stream', 'subtitles', 'addon_catalog'].map(name => ({ name, declared: declaredResources.includes(name) || resources.some((r: any) => r?.name === name), types: resources.find((r: any) => r?.name === name)?.types || types }))
  return { warnings, capabilities, types, parameters, configuration: { configurable, required: configurationRequired, fields: config.map((f: any) => ({ key: f?.key ?? null, title: f?.title ?? null, type: f?.type ?? null, required: f?.required === true, options: Array.isArray(f?.options) ? f.options : [] })) }, incompleteCatalogs }
}
async function getJson(url: string, timeoutMs = 12000) {
  const started = Date.now()
  try {
    const r = await safeExternalFetch(url, { timeoutMs, maxBytes: 2_000_000, accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' })
    let json: any = null
    try { json = JSON.parse(r.body.toString('utf8')) } catch {}
    const validObject = !!json && typeof json === 'object' && !Array.isArray(json)
    const responseOk = r.status >= 200 && r.status < 300
    return { ok: responseOk && validObject, httpStatus: r.status, latencyMs: Date.now() - started, finalUrl: r.url, json: validObject ? json : null, error: !responseOk ? `HTTP ${r.status}` : validObject ? null : 'Resposta não é um objeto JSON válido.' }
  } catch (e: any) {
    return { ok: false, httpStatus: null, latencyMs: Date.now() - started, finalUrl: null, json: null, error: e?.name === 'TimeoutError' ? `Timeout (${timeoutMs / 1000}s)` : (e?.message || 'Falha de rede') }
  }
}

function catalogTest(c: any, raw: string) {
  const url = catalogUrl(raw, c)
  const searchOnly = isSearchOnly(c)
  const requiredExtras = extras(c).filter((x: any) => x?.isRequired === true || x?.required === true).map((x: any) => String(x?.name ?? x?.key ?? '').toLowerCase()).filter(Boolean)
  const needsInput = searchOnly || requiredExtras.some((x: string) => x !== 'skip' && x !== 'search')
  if (!url || needsInput) {
    return { name: c?.name || c?.id || 'Catálogo', id: c?.id, type: c?.type || c?.apiType, url, testable: false, ok: null, searchOnly, searchCapable: supportsSearch(c), requiredExtras, reason: searchOnly ? 'Busca obrigatória' : requiredExtras.length ? `Requer parâmetros: ${requiredExtras.join(', ')}` : 'Endpoint não testável' }
  }
  return { name: c?.name || c?.id || 'Catálogo', id: c?.id, type: c?.type || c?.apiType, url, testable: true, ok: null, pending: true, searchOnly, searchCapable: supportsSearch(c), requiredExtras }
}

function finishHealth(manifestOk: boolean, latencyMs: number, catalogs: any[], tests: any[], analysis?: any) {
  const slow = manifestOk && latencyMs >= 4000
  const tested = tests.filter(x => x.testable && !x.pending && typeof x.ok === 'boolean')
  const unverified = tests.filter(x => x.protocolStatus === 'unverified' || (x.testable === false && !x.pending)).length
  const notTestedByLimit = Math.max(0, catalogs.length - tests.length)
  const failed = tested.filter(x => !x.ok)
  const slowCatalogs = tested.filter(x => x.ok && x.latencyMs >= 4000)
  const allCatalogsFailed = tested.length > 0 && failed.length === tested.length
  let health: 'healthy' | 'attention' | 'fail' | 'unknown'
  let healthReason = ''
  if (!manifestOk) { health = 'fail'; healthReason = 'Manifesto indisponível' }
  else if (tests.some(x => x.pending)) { health = 'unknown'; healthReason = 'Catálogos ainda sendo verificados' }
  else if (allCatalogsFailed) { health = 'attention'; healthReason = 'Manifesto disponível, mas os endpoints de catálogo testados não responderam' }
  else if (slow || slowCatalogs.length || failed.length) { health = 'attention'; healthReason = failed.length ? `${failed.length} catálogo(s) não responderam` : 'Resposta lenta' }
  else if (!catalogs.length) { health = 'attention'; healthReason = 'Manifesto disponível, sem catálogos declarados' }
  else if (tested.length > 0) {
    health = 'healthy'
    const notes = [unverified ? `${unverified} não verificável(is)` : '', notTestedByLimit ? `${notTestedByLimit} além do limite sem teste` : '', analysis?.warnings?.length ? `${analysis.warnings.length} alerta(s) de protocolo` : ''].filter(Boolean)
    healthReason = `Manifesto disponível e ${tested.length} catálogo(s) testado(s) responderam${notes.length ? `; ${notes.join(', ')}` : ''}`
  }
  else if (unverified || analysis?.warnings?.length) { health = 'unknown'; healthReason = `Manifesto disponível; catálogos não verificáveis sem parâmetros${analysis?.warnings?.length ? `; ${analysis.warnings.length} alerta(s) informativo(s)` : ''}` }
  else { health = 'unknown'; healthReason = 'Manifesto disponível, mas nenhum catálogo pôde ser confirmado' }
  return { health, healthReason, summary: { catalogs: catalogs.length, tested: tested.length, failed: failed.length, unverified, notTestedByLimit, warnings: analysis?.warnings?.length || 0, slow: slowCatalogs.length, searchOnly: catalogs.filter(isSearchOnly).length, searchCapable: catalogs.filter(supportsSearch).length } }
}

async function runAddon(raw: string, emit: (result: any, phase: string) => void) {
  let target = raw
  try { target = manifestUrl(raw) } catch {}
  const manifest = await getJson(target, 15000)
  const m = manifest.json
  const catalogs = Array.isArray(m?.catalogs) ? m.catalogs : []
  const manifestAnalysis = m ? analyzeManifest(m) : null
  const catalogTests = catalogs.slice(0, 20).map((c: any) => catalogTest(c, raw))
  const base = {
    url: raw, target, ok: manifest.ok, httpStatus: manifest.httpStatus, latencyMs: manifest.latencyMs, finalUrl: manifest.finalUrl,
    error: manifest.error,
    manifest: m ? { id: m.id ?? null, name: m.name ?? null, version: m.version ?? null, description: m.description ?? null, resources: m.resources ?? [], types: m.types ?? [], catalogs, behaviorHints: m.behaviorHints ?? {}, config: Array.isArray(m.config) ? m.config.map((f: any) => ({ key: f?.key ?? null, title: f?.title ?? null, type: f?.type ?? null, required: f?.required === true, options: Array.isArray(f?.options) ? f.options : [] })) : [] } : null,
    manifestAnalysis,
  }

  if (!manifest.ok) {
    const state = finishHealth(false, manifest.latencyMs, catalogs, catalogTests)
    emit({ ...base, ...state, catalogTests }, 'complete')
    return
  }

  // Publish the manifest and all discovered catalogs immediately. Testable catalogs
  // remain marked pending while their endpoint checks run in parallel.
  const initial = finishHealth(true, manifest.latencyMs, catalogs, catalogTests, manifestAnalysis)
  emit({ ...base, ...initial, catalogTests }, 'manifest')

  const pendingIndexes = catalogTests.map((item: any, i: number) => item.pending ? i : -1).filter((i: number) => i >= 0)
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, pendingIndexes.length) }, async () => {
    while (cursor < pendingIndexes.length) {
      const index = pendingIndexes[cursor++]
      const item = catalogTests[index]
      const result = await getJson(item.url, 10000)
      const validCatalogPayload = result.ok && Array.isArray(result.json?.metas)
      catalogTests[index] = { ...item, ok: validCatalogPayload ? true : result.ok ? null : false, protocolStatus: result.ok && !validCatalogPayload ? 'unverified' : undefined, pending: false, latencyMs: result.latencyMs, httpStatus: result.httpStatus, error: result.ok && !validCatalogPayload ? 'O endpoint respondeu, mas o campo "metas" não é uma lista; formato do catálogo não verificável.' : result.error }
      const state = finishHealth(true, manifest.latencyMs, catalogs, catalogTests, manifestAnalysis)
      emit({ ...base, ...state, catalogTests: [...catalogTests] }, pendingIndexes.some((i: number) => catalogTests[i].pending) ? 'catalog' : 'complete')
    }
  })
  await Promise.all(workers)
  if (!pendingIndexes.length) emit({ ...base, ...finishHealth(true, manifest.latencyMs, catalogs, catalogTests, manifestAnalysis), catalogTests }, 'complete')
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await readJsonLimited(req, 64_000) } catch (e:any) { return NextResponse.json({ error: e.message || 'Corpo JSON inválido.' }, { status: e instanceof RequestJsonError ? e.status : 400 }) }
  if (!Array.isArray(body?.urls)) return NextResponse.json({ error: 'urls deve ser um array.' }, { status: 400 })
  const unique: string[] = Array.from(new Set<string>(body.urls.filter((x: any): x is string => typeof x === 'string' && /^https?:\/\//i.test(x)))).slice(0, 50)
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
      const results: Record<string, any> = {}
      let cursor = 0
      let completed = 0
      const run = async () => {
        send({ type: 'progress', total: unique.length, completed: 0 })
        const workers = Array.from({ length: Math.min(5, unique.length) }, async () => {
          while (cursor < unique.length) {
            const raw = unique[cursor++]
            try {
              await runAddon(raw, (result, phase) => {
                results[raw] = result
                send({ type: 'result', phase, result, total: unique.length, completed })
              })
            } catch (e: any) {
              const result = { url: raw, ok: false, health: 'fail', healthReason: e?.message || 'Falha no diagnóstico', error: e?.message || 'Falha no diagnóstico', manifest: null, catalogTests: [], summary: { catalogs: 0, tested: 0, failed: 0, slow: 0, searchOnly: 0, searchCapable: 0 } }
              results[raw] = result
              send({ type: 'result', phase: 'complete', result, total: unique.length, completed })
            }
            completed++
            send({ type: 'progress', total: unique.length, completed })
          }
        })
        await Promise.all(workers)
        send({ type: 'done', checkedAt: new Date().toISOString(), total: unique.length, completed, results: Object.values(results) })
      }
      void run().catch((e: any) => {
        send({ type: 'error', error: e?.message || 'Falha no diagnóstico.' })
      }).finally(() => controller.close())
    },
  })
  return new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } })
}
