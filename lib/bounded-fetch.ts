export async function boundedFetchText(input: string | URL, init: RequestInit = {}, limits: { timeoutMs?: number; maxBytes?: number } = {}) {
  const timeoutMs = limits.timeoutMs ?? 15_000
  const maxBytes = limits.maxBytes ?? 2_000_000
  const response = await fetch(input, { ...init, signal: init.signal || AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) { await response.body?.cancel(); throw new Error('A resposta externa excede o limite de tamanho permitido.') }
  if (!response.body) return { response, text: '' }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxBytes) { await reader.cancel(); throw new Error('A resposta externa excede o limite de tamanho permitido.') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { response, text: new TextDecoder().decode(bytes) }
}
