import { describe, expect, it } from 'vitest'
import { isPublicAddress, validateExternalUrl } from './safe-external-fetch'

describe('validação de destinos externos', () => {
  it('bloqueia loopback, redes privadas, metadados e nomes locais', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1']) expect(isPublicAddress(address)).toBe(false)
    expect(() => validateExternalUrl('http://localhost/manifest.json')).toThrow()
    expect(() => validateExternalUrl('http://192.168.1.2/manifest.json')).toThrow()
    expect(() => validateExternalUrl('file:///etc/passwd')).toThrow()
  })

  it('aceita HTTPS público e rejeita portas não padrão e credenciais', () => {
    expect(validateExternalUrl('https://example.com/manifest.json').hostname).toBe('example.com')
    expect(() => validateExternalUrl('https://example.com:8443/manifest.json')).toThrow()
    expect(() => validateExternalUrl('https://user:pass@example.com/manifest.json')).toThrow()
  })
})
