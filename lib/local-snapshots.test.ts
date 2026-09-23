import { describe, expect, it } from 'vitest'
import { MAX_LOCAL_SNAPSHOTS, SNAPSHOT_STORAGE_KEY, storeLocalSnapshot } from './local-snapshots'

describe('snapshots locais', () => {
  it('remove os mais antigos quando o armazenamento está cheio', () => {
    const data = new Map<string, string>()
    let quotaFailures = 0
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (JSON.parse(value).length > 1) { quotaFailures++; const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error }
        data.set(key, value)
      },
    }
    data.set(SNAPSHOT_STORAGE_KEY, JSON.stringify(Array.from({ length: MAX_LOCAL_SNAPSHOTS }, (_, i) => ({ id: i }))))
    const result = storeLocalSnapshot(storage, { id: 'new', payload: 'x'.repeat(200) })
    expect(result.saved).toBe(true)
    expect(quotaFailures).toBeGreaterThan(0)
    expect(JSON.parse(data.get(SNAPSHOT_STORAGE_KEY) || '[]')).toEqual([{ id: 'new', payload: 'x'.repeat(200) }])
  })

  it('retorna falha recuperável quando nem o snapshot mais novo cabe', () => {
    const storage = { getItem: () => '[]', setItem: () => { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error } }
    expect(storeLocalSnapshot(storage, { id: 1 }).saved).toBe(false)
  })
})
