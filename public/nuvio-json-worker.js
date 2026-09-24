self.onmessage = async (event) => {
  const message = event.data || {}
  try {
    if (message.type === 'parse-file') {
      const text = await message.file.text()
      self.postMessage({ type: 'parsed', value: JSON.parse(text) })
      return
    }
    if (message.type === 'parse-snapshots') {
      const snapshots = JSON.parse(message.text)
      const list = Array.isArray(snapshots) ? snapshots : []
      const value = list.map((snapshot) => {
        const inventory = snapshot?.inventory || snapshot || {}
        const categories = ['addons', 'plugins', 'collections', 'watchProgress', 'library', 'watchedItems']
        const profiles = (Array.isArray(inventory.profiles) ? inventory.profiles : []).map((record, index) => {
          const profile = { profile_index: record?.profile?.profile_index || record?.profile?.id || index + 1, id: record?.profile?.id || null, name: String(record?.profile?.name || `Perfil ${index + 1}`) }
          const snapshotCounts = { ...(record?.snapshotCounts || {}) }
          const next = { profile, snapshotCounts, catalogSettings: { hide_unreleased_content: record?.catalogSettings?.hide_unreleased_content, items: [] } }
          const compact = (item) => ({ id: item?.id ?? item?.uuid ?? null, url: item?.url ?? item?.repository ?? null, name: String(item?.name || item?.display_name || item?.title || item?.name_en || item?.url || item?.id || 'Item sem nome') })
          for (const key of categories) {
            const rows = Array.isArray(record?.[key]) ? record[key] : []
            snapshotCounts[key] = Number(snapshotCounts[key] ?? rows.length)
            next[key] = rows.slice(0, 250).map(compact)
          }
          const catalogRows = Array.isArray(record?.catalogSettings?.items) ? record.catalogSettings.items : []
          snapshotCounts.catalogs = Number(snapshotCounts.catalogs ?? catalogRows.length)
          next.catalogSettings.items = catalogRows.slice(0, 250).map((item) => ({ addon_id: item.addon_id, type: item.type, catalog_id: item.catalog_id, collection_id: item.collection_id, is_collection: item.is_collection, enabled: item.enabled, order: item.order, custom_title: item.custom_title }))
          next.snapshotCounts = snapshotCounts
          return next
        })
        return { ...snapshot, inventory: { fetchedAt: inventory.fetchedAt || '', profiles } }
      })
      self.postMessage({ type: 'snapshots', value })
      return
    }
    if (message.type === 'serialize-json') {
      const text = JSON.stringify(message.value, null, message.space)
      self.postMessage({ type: 'serialized', blob: new Blob([text], { type: 'application/json' }) })
      return
    }
    throw new Error('Operação JSON desconhecida.')
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível processar o arquivo JSON.' })
  }
}
