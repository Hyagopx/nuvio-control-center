import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Corpo JSON inválido.' }, { status: 400 }) }
  const urls: string[] = Array.isArray(body?.urls) ? Array.from(new Set<string>(body.urls.filter((x: any): x is string => typeof x === 'string' && /^https?:\/\//i.test(x)))).slice(0, 50) : []
  if (!urls.length) return NextResponse.json({ error: 'Informe ao menos uma URL http ou https.' }, { status: 400 })

  const results = await Promise.all(urls.map(async url => {
    const started = Date.now()
    try {
      const target = new URL(url)
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('URL inválida')
      target.pathname = `${target.pathname.replace(/\/manifest\.json$/i, '').replace(/\/+$/, '')}/manifest.json`
      const response = await fetch(target, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } })
      const manifest = await response.json().catch(() => null)
      const valid = response.ok && manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      return { url, ok: !!valid, httpStatus: response.status, latencyMs: Date.now() - started, manifest: valid ? { id: manifest.id ?? null, name: manifest.name ?? null, version: manifest.version ?? null, description: manifest.description ?? null, catalogs: Array.isArray(manifest.catalogs)?manifest.catalogs:[], resources: manifest.resources ?? [], types: manifest.types ?? [] } : null, error: valid ? null : response.ok ? 'Resposta não contém um manifesto válido.' : `HTTP ${response.status}` }
    } catch (error: any) {
      return { url, ok: false, httpStatus: null, latencyMs: Date.now() - started, manifest: null, error: error?.name === 'TimeoutError' ? 'Timeout (15s)' : error?.message || 'Falha de rede' }
    }
  }))
  return NextResponse.json({ results })
}
