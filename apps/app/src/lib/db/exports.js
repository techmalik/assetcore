import { api, getAccessToken, refreshAccessToken } from '../apiClient'

const BASE = import.meta.env.VITE_API_URL || '/api'

// [{ key, label, description, filters: ['location','site','date','status',…], date_label?, statuses? }]
// Already narrowed to what the caller's role may export.
export async function listExports() {
  return api.get('/exports')
}

/**
 * Downloads one dataset as a file. Not api.download(): that one drops the
 * server's error code (so a 403 would read "Download failed (403)") and never
 * retries after a token refresh. Resolves with the row count and whether the
 * file hit the row cap.
 */
export async function downloadExport(dataset, format, filters = {}) {
  const qs = new URLSearchParams({ format })
  // Only set filters are sent — a blank `status=` is a filter that matches nothing.
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v)
  const url = `${BASE}/exports/${encodeURIComponent(dataset)}?${qs.toString()}`

  const go = () => {
    const token = getAccessToken()
    return fetch(url, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} })
  }

  let res = await go()
  if (res.status === 401 && (await refreshAccessToken())) res = await go()

  if (!res.ok) {
    let payload = null
    try { payload = await res.json() } catch { /* no body */ }
    const err = new Error(payload?.error || `Download failed (${res.status})`)
    err.status = res.status
    err.code = payload?.error ?? null
    throw err
  }

  const disposition = res.headers.get('content-disposition') || ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `assetcore-${dataset}.${format}`
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking in the same tick can cancel the save in Firefox and Safari.
  setTimeout(() => URL.revokeObjectURL(href), 10_000)

  return {
    filename,
    rowCount: Number(res.headers.get('x-export-row-count')) || 0,
    truncated: res.headers.get('x-export-truncated') === 'true',
  }
}
