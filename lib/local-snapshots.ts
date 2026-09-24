export const SNAPSHOT_STORAGE_KEY = 'nuvio-snapshots-v2'
export const LEGACY_SNAPSHOT_STORAGE_KEY = 'nuvio-snapshots'
export const MAX_LOCAL_SNAPSHOTS = 30
const SNAPSHOT_DB_NAME = 'nuvio-control-center'
const SNAPSHOT_STORE_NAME = 'snapshots'

function openSnapshotDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Armazenamento local indisponível.')); return }
    const request = indexedDB.open(SNAPSHOT_DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) request.result.createObjectStore(SNAPSHOT_STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento de snapshots.'))
  })
}

export async function readIndexedSnapshots(): Promise<any[]> {
  const database = await openSnapshotDatabase()
  try {
    const rows = await new Promise<any[]>((resolve, reject) => {
      const request = database.transaction(SNAPSHOT_STORE_NAME, 'readonly').objectStore(SNAPSHOT_STORE_NAME).getAll()
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : [])
      request.onerror = () => reject(request.error || new Error('Não foi possível ler os snapshots.'))
    })
    return rows.sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, MAX_LOCAL_SNAPSHOTS)
  } finally { database.close() }
}

export async function storeIndexedSnapshot(snapshot: any): Promise<{ count: number }> {
  const database = await openSnapshotDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(SNAPSHOT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(SNAPSHOT_STORE_NAME)
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      store.put({ ...snapshot, id, createdAt: Date.now() })
      const list = store.getAll()
      let count = 0
      list.onsuccess = () => {
        const ordered = (Array.isArray(list.result) ? list.result : []).sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
        count = Math.min(ordered.length, MAX_LOCAL_SNAPSHOTS)
        ordered.slice(MAX_LOCAL_SNAPSHOTS).forEach(item => store.delete(item.id))
      }
      transaction.oncomplete = () => resolve({ count })
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível salvar o snapshot.'))
      transaction.onabort = () => reject(transaction.error || new Error('O armazenamento local está cheio.'))
    })
  } finally { database.close() }
}

export function readLocalSnapshots(storage: Pick<Storage, 'getItem'>): any[] {
  try {
    const value = JSON.parse(storage.getItem(SNAPSHOT_STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

export function storeLocalSnapshot(storage: Pick<Storage, 'getItem' | 'setItem'>, snapshot: any): { saved: boolean; removed: number; count: number } {
  const snapshots = readLocalSnapshots(storage)
  snapshots.unshift(snapshot)
  const next = snapshots.slice(0, MAX_LOCAL_SNAPSHOTS)
  let removed = snapshots.length - next.length
  while (next.length > 0) {
    try {
      storage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(next))
      return { saved: true, removed, count: next.length }
    } catch (error: any) {
      const quota = error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014
      if (!quota) return { saved: false, removed, count: next.length }
      next.pop()
      removed++
    }
  }
  return { saved: false, removed, count: 0 }
}
