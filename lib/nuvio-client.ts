const BASE = process.env.NUVIO_API_BASE || 'https://api.nuvio.tv'
const KEY = process.env.NUVIO_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI'
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 8_000_000

async function readResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('A resposta da nuvem excede o limite de tamanho permitido.')
  if (!response.body) return ''
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('A resposta da nuvem excede o limite de tamanho permitido.') }
    chunks.push(value)
  }
  const merged = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(merged)
}

/** Shared server-side Nuvio Cloud API client used by route handlers. */
export async function nuvioCall(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    cache: 'no-store',
    headers: {
      apikey: KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  })
  const text = await readResponseText(response)
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) throw new Error(data?.message || data?.error_description || data?.error || `Nuvio HTTP ${response.status}`)
  return data
}
