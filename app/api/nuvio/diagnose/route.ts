import { NextRequest, NextResponse } from 'next/server'

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
async function getJson(url: string, timeoutMs = 12000) {
  const started = Date.now()
  try {
    const r = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' } })
    const body = await r.text()
    let json: any = null
    try { json = JSON.parse(body) } catch {}
    return { ok: r.ok && !!json && typeof json === 'object', httpStatus: r.status, latencyMs: Date.now() - started, finalUrl: r.url, json, error: r.ok ? (json ? null : 'Resposta não é JSON válido.') : `HTTP ${r.status}` }
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

function finishHealth(manifestOk: boolean, latencyMs: number, catalogs: any[], tests: any[]) {
  const slow = manifestOk && latencyMs >= 4000
  const tested = tests.filter(x => x.testable && !x.pending)
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
  else { health = 'healthy'; healthReason = 'Manifesto e catálogos testados disponíveis' }
  return { health, healthReason, summary: { catalogs: catalogs.length, tested: tested.length, failed: failed.length, slow: slowCatalogs.length, searchOnly: catalogs.filter(isSearchOnly).length, searchCapable: catalogs.filter(supportsSearch).length } }
}

async function runAddon(raw: string, emit: (result: any, phase: string) => void) {
  let target = raw
  try { target = manifestUrl(raw) } catch {}
  const manifest = await getJson(target, 15000)
  const m = manifest.json
  const catalogs = Array.isArray(m?.catalogs) ? m.catalogs : []
  const catalogTests = catalogs.slice(0, 20).map((c: any) => catalogTest(c, raw))
  const base = {
    url: raw, target, ok: manifest.ok, httpStatus: manifest.httpStatus, latencyMs: manifest.latencyMs, finalUrl: manifest.finalUrl,
    error: manifest.error,
    manifest: m ? { id: m.id ?? null, name: m.name ?? null, version: m.version ?? null, description: m.description ?? null, resources: m.resources ?? [], types: m.types ?? [], catalogs, behaviorHints: m.behaviorHints ?? {} } : null,
  }

  if (!manifest.ok) {
    const state = finishHealth(false, manifest.latencyMs, catalogs, catalogTests)
    emit({ ...base, ...state, catalogTests }, 'complete')
    return
  }

  // Publish the manifest and all discovered catalogs immediately. Testable catalogs
  // remain marked pending while their endpoint checks run in parallel.
  const initial = finishHealth(true, manifest.latencyMs, catalogs, catalogTests)
  emit({ ...base, ...initial, catalogTests }, 'manifest')

  const pendingIndexes = catalogTests.map((item: any, i: number) => item.pending ? i : -1).filter((i: number) => i >= 0)
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, pendingIndexes.length) }, async () => {
    while (cursor < pendingIndexes.length) {
      const index = pendingIndexes[cursor++]
      const item = catalogTests[index]
      const result = await getJson(item.url, 10000)
      catalogTests[index] = { ...item, ok: result.ok, pending: false, latencyMs: result.latencyMs, httpStatus: result.httpStatus, error: result.error }
      const state = finishHealth(true, manifest.latencyMs, catalogs, catalogTests)
      emit({ ...base, ...state, catalogTests: [...catalogTests] }, pendingIndexes.some((i: number) => catalogTests[i].pending) ? 'catalog' : 'complete')
    }
  })
  await Promise.all(workers)
  if (!pendingIndexes.length) emit({ ...base, ...finishHealth(true, manifest.latencyMs, catalogs, catalogTests), catalogTests }, 'complete')
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Corpo JSON inválido.' }, { status: 400 }) }
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
