import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'

export class SafeFetchError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = 'SafeFetchError' }
}

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0)
}

function inV4Range(address: string, network: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipv4Number(address) & mask) === (ipv4Number(network) & mask)
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  const family = isIP(normalized)
  if (family === 4) {
    const blocked = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
      ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ] as const
    return !blocked.some(([network, bits]) => inV4Range(normalized, network, bits))
  }
  if (family !== 6) return false
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7)
    if (isIP(mapped) === 4) return isPublicAddress(mapped)
    const hex = mapped.split(':').slice(-2).map(x => parseInt(x || '0', 16))
    if (hex.length !== 2 || hex.some(Number.isNaN)) return false
    return isPublicAddress(`${hex[0] >> 8}.${hex[0] & 255}.${hex[1] >> 8}.${hex[1] & 255}`)
  }
  // Permit only globally allocated unicast IPv6 space (2000::/3), excluding documentation.
  const first = parseInt(normalized.split(':')[0] || '0', 16)
  return (first & 0xe000) === 0x2000 && !normalized.startsWith('2001:db8:')
}

export function validateExternalUrl(input: string | URL): URL {
  let url: URL
  try { url = input instanceof URL ? new URL(input) : new URL(input) }
  catch { throw new SafeFetchError('URL externa inválida.') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SafeFetchError('A URL precisa usar http ou https.')
  if (url.username || url.password) throw new SafeFetchError('A URL não pode conter usuário ou senha.')
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) throw new SafeFetchError('A URL precisa usar a porta padrão pública do protocolo.')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || /\.(localhost|local|internal|test|invalid)$/.test(host)) throw new SafeFetchError('Endereços locais ou reservados não podem ser consultados.')
  if (isIP(host) && !isPublicAddress(host)) throw new SafeFetchError('Endereços privados ou reservados não podem ser consultados.')
  url.hash = ''
  return url
}

async function resolvePublic(host: string, timeoutMs: number) {
  const literal = host.replace(/^\[|\]$/g, '')
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) throw new SafeFetchError('Endereço privado ou reservado bloqueado.')
    return { address: literal, family: isIP(literal) }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let results: Array<{ address: string; family: number }>
  try {
    results = await Promise.race([
      lookup(literal, { all: true, verbatim: true }) as unknown as Promise<Array<{ address: string; family: number }>>,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SafeFetchError('Tempo limite ao consultar o DNS.', 504)), timeoutMs) }),
    ])
  } finally { if (timer) clearTimeout(timer) }
  if (!results.length || results.some(item => !isPublicAddress(item.address))) throw new SafeFetchError('O domínio resolve para um endereço privado ou reservado.')
  return results[0]
}

function requestOnce(url: URL, resolved: { address: string; family: number }, options: { timeoutMs: number; maxBytes: number; accept: string }): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const request = requestFn(url, {
      method: 'GET',
      agent: false,
      lookup: ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => callback(null, resolved.address, resolved.family)) as never,
      ...(url.protocol === 'https:' && isIP(hostname) === 0 ? { servername: hostname } : {}),
      headers: { Accept: options.accept, 'Accept-Encoding': 'identity', Connection: 'close', 'User-Agent': 'Nuvio-Control-Center/1.0' },
    }, response => {
      const status = response.statusCode || 502
      const headers = response.headers
      const contentLength = Number(headers['content-length'])
      if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
        request.destroy(new SafeFetchError('A resposta externa excede o tamanho permitido.', 413)); return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > options.maxBytes) { request.destroy(new SafeFetchError('A resposta externa excede o tamanho permitido.', 413)); return }
        chunks.push(buffer)
      })
      response.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    request.setTimeout(options.timeoutMs, () => request.destroy(new SafeFetchError('Tempo limite ao consultar o endereço externo.', 504)))
    request.on('error', reject)
    request.end()
  })
}

export async function safeExternalFetch(input: string | URL, options: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; accept?: string } = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxBytes = options.maxBytes ?? 2_000_000
  const maxRedirects = options.maxRedirects ?? 3
  const accept = options.accept ?? 'application/json,text/plain;q=0.9,*/*;q=0.5'
  let url = validateExternalUrl(input)
  for (let redirects = 0; ; redirects++) {
    const resolved = await resolvePublic(url.hostname, timeoutMs)
    const response = await requestOnce(url, resolved, { timeoutMs, maxBytes, accept })
    const location = response.headers.location
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return { ...response, url: url.toString() }
    if (redirects >= maxRedirects) throw new SafeFetchError('A URL excedeu o limite de redirecionamentos.')
    const next = validateExternalUrl(new URL(location, url))
    if (url.protocol === 'https:' && next.protocol === 'http:') throw new SafeFetchError('Redirecionamento para uma conexão sem HTTPS bloqueado.')
    url = next
  }
}

export async function safeExternalJson(input: string | URL, options: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; accept?: string } = {}) {
  const response = await safeExternalFetch(input, options)
  if (response.status < 200 || response.status >= 300) throw new SafeFetchError(`O endereço externo respondeu HTTP ${response.status}.`, 502)
  let json: any
  try { json = JSON.parse(response.body.toString('utf8')) }
  catch { throw new SafeFetchError('A resposta externa não contém JSON válido.', 502) }
  return { ...response, json }
}
