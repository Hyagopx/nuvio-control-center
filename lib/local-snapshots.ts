export const SNAPSHOT_STORAGE_KEY = 'nuvio-snapshots'
export const MAX_LOCAL_SNAPSHOTS = 30

export function readLocalSnapshots(storage: Pick<Storage, 'getItem'>): any[] {
  try {
    const value = JSON.parse(storage.getItem(SNAPSHOT_STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

export function storeLocalSnapshot(storage: Pick<Storage, 'getItem' | 'setItem'>, snapshot: any): { saved: boolean; removed: number } {
  const snapshots = readLocalSnapshots(storage)
  snapshots.unshift(snapshot)
  const next = snapshots.slice(0, MAX_LOCAL_SNAPSHOTS)
  let removed = snapshots.length - next.length
  for (let size = next.length; size > 0; size--) {
    try {
      storage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(next.slice(0, size)))
      return { saved: true, removed: removed + next.length - size }
    } catch (error: any) {
      const quota = error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014
      if (!quota) return { saved: false, removed }
    }
  }
  return { saved: false, removed }
}
