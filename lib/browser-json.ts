type JsonWorkerMessage = { type: 'parsed' | 'snapshots'; value: unknown } | { type: 'serialized'; blob: Blob } | { type: 'error'; message: string }

function runWorker<T>(message: unknown, expected: 'parsed' | 'serialized' | 'snapshots'): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/nuvio-json-worker.js')
    worker.onmessage = (event: MessageEvent<JsonWorkerMessage>) => {
      worker.terminate()
      const result = event.data
      if (result.type === 'error') reject(new Error(result.message))
      else if (result.type === expected) resolve(('blob' in result ? result.blob : result.value) as T)
      else reject(new Error('Resposta inesperada do processador JSON.'))
    }
    worker.onerror = () => { worker.terminate(); reject(new Error('Não foi possível iniciar o processador JSON.')) }
    worker.postMessage(message)
  })
}

export async function parseJsonFile(file: File): Promise<any> {
  if (typeof Worker === 'undefined') return JSON.parse(await file.text())
  return runWorker<any>({ type: 'parse-file', file }, 'parsed')
}

export async function parseLegacySnapshots(text: string): Promise<any[]> {
  if (typeof Worker === 'undefined') return JSON.parse(text || '[]')
  return runWorker<any[]>({ type: 'parse-snapshots', text }, 'snapshots')
}

export async function serializeJsonBlob(value: unknown, space: number | string = 0): Promise<Blob> {
  if (typeof Worker === 'undefined') return new Blob([JSON.stringify(value, null, space)], { type: 'application/json' })
  return runWorker<Blob>({ type: 'serialize-json', value, space }, 'serialized')
}
