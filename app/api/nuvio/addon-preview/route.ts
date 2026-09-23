import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited, RequestJsonError } from '../../../../lib/request-json'
import { safeExternalJson, validateExternalUrl } from '../../../../lib/safe-external-fetch'

export async function POST(req: NextRequest) {
  let body: any
  try { body = await readJsonLimited(req, 100_000) }
  catch (error: any) { return NextResponse.json({ error: error.message || 'Corpo JSON inválido.' }, { status: error instanceof RequestJsonError ? error.status : 400 }) }
  const urls: string[] = Array.isArray(body?.urls) ? Array.from(new Set<string>(body.urls.filter((x: any): x is string => typeof x === 'string'))).slice(0, 50) : []
  if (!urls.length) return NextResponse.json({ error: 'Informe ao menos uma URL http ou https.' }, { status: 400 })

  const results: any[] = new Array(urls.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (cursor < urls.length) {
      const index = cursor++, url = urls[index], started = Date.now()
      try {
        const target = validateExternalUrl(url)
        target.pathname = `${target.pathname.replace(/\/manifest\.json$/i, '').replace(/\/+$/, '')}/manifest.json`
        const response = await safeExternalJson(target, { timeoutMs: 12_000, maxBytes: 1_000_000 })
        const manifest = response.json
        const valid = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
        results[index] = { url, ok: !!valid, httpStatus: response.status, latencyMs: Date.now() - started, manifest: valid ? { id: manifest.id ?? null, name: manifest.name ?? null, version: manifest.version ?? null, description: manifest.description ?? null, catalogs: Array.isArray(manifest.catalogs) ? manifest.catalogs : [], resources: manifest.resources ?? [], types: manifest.types ?? [] } : null, error: valid ? null : 'Resposta não contém um manifesto válido.' }
      } catch (error: any) {
        results[index] = { url, ok: false, httpStatus: null, latencyMs: Date.now() - started, manifest: null, error: error?.message || 'Falha de rede' }
      }
    }
  }))
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
}
