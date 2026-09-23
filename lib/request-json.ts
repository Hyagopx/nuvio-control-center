export class RequestJsonError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'RequestJsonError' }
}

export async function readJsonLimited(request: Request, maxBytes = 128_000): Promise<any> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestJsonError('A solicitação excede o tamanho permitido.', 413)
  if (!request.body) throw new RequestJsonError('Corpo JSON ausente.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RequestJsonError('A solicitação excede o tamanho permitido.', 413)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try {
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    if (error instanceof RequestJsonError) throw error
    throw new RequestJsonError('Corpo JSON inválido.')
  }
}
