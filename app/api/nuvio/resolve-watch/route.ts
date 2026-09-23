import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited, RequestJsonError } from '../../../../lib/request-json'
import { safeExternalJson, validateExternalUrl } from '../../../../lib/safe-external-fetch'

function baseUrl(raw: string) {
  const url = validateExternalUrl(raw)
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/manifest\.json$/i, '')
  return url.toString().replace(/\/$/, '')
}
function hasMeta(manifest: any) { return Array.isArray(manifest?.resources) && manifest.resources.some((resource: any) => String(resource) === 'meta' || String(resource?.name || '') === 'meta') }

export async function POST(req: NextRequest) {
  try {
    const { addons, items } = await readJsonLimited(req, 128_000)
    if (!Array.isArray(addons) || !Array.isArray(items)) return NextResponse.json({ error: 'addons e items são obrigatórios.' }, { status: 400 })
    const usable: any[] = []
    let addonCursor=0
    await Promise.all(Array.from({length:Math.min(4,addons.length,12)},async()=>{while(addonCursor<Math.min(addons.length,12)){
      const addon=addons[addonCursor++];if(!addon?.url)continue
      try { const base=baseUrl(String(addon.url));const response=await safeExternalJson(`${base}/manifest.json`,{timeoutMs:5_000,maxBytes:750_000});if(hasMeta(response.json))usable.push({base,name:response.json.name||addon.name||addon.url}) }
      catch { /* Um addon indisponível não impede a consulta aos demais. */ }
    }}))
    const sourceItems = items.slice(0, 80)
    const resolved: any[] = new Array(sourceItems.length)
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(4, sourceItems.length) }, async () => {
      while (cursor < sourceItems.length) {
        const index = cursor++, item = sourceItems[index]
        const id = String(item?.contentId || item?.content_id || item?.id || '').trim()
        if (!id) { resolved[index] = null; continue }
        const type = String(item?.type || item?.contentType || item?.media_type || '').toLowerCase().includes('series') ? 'series' : 'movie'
        const matches = await Promise.all(usable.map(async addon => {
          try {
            const response = await safeExternalJson(`${addon.base}/meta/${type}/${encodeURIComponent(id)}.json`, { timeoutMs: 5_000, maxBytes: 500_000 })
            const meta = response.json?.meta || response.json
            return meta && (meta.name || meta.title) ? { meta, addon } : null
          } catch { return null }
        }))
        const match = matches.find(Boolean)
        if (!match) { resolved[index] = null; continue }
        const { meta, addon } = match as any
        resolved[index] = { key: item.key || id, title: meta.name || meta.title, poster: meta.poster || null, background: meta.background || meta.backdrop || null, description: meta.description || null, year: meta.year || null, seriesName: meta.name || meta.title, source: addon.name }
      }
    }))
    return NextResponse.json({ resolved: resolved.filter(Boolean) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao resolver títulos.' }, { status: error instanceof RequestJsonError ? error.status : 400 })
  }
}
