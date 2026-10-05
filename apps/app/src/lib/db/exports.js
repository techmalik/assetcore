import { api, qs, saveBlob } from '../apiClient'

// [{ key, label, description, filters: ['location','site','date','status',…], date_label?, statuses? }]
// Already narrowed to what the caller's role may export.
export async function listExports() {
  return api.get('/exports')
}

/**
 * Downloads one dataset as a file, named by the server. Resolves with the row
 * count and whether the file hit the row cap.
 */
export async function downloadExport(dataset, format, filters = {}) {
  // qs() leaves out blank filters: a blank `status=` would match nothing.
  const res = await api.raw(`/exports/${encodeURIComponent(dataset)}${qs({ format, ...filters })}`)
  const disposition = res.headers.get('content-disposition') || ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `assetcore-${dataset}.${format}`
  saveBlob(await res.blob(), filename)
  return {
    filename,
    rowCount: Number(res.headers.get('x-export-row-count')) || 0,
    truncated: res.headers.get('x-export-truncated') === 'true',
  }
}
