import { api } from '../apiClient'

// Uploaded photos and documents are stored as paths relative to the files
// API (`<org>/<entity>/<id>/<name>`). These are the only places that turn
// one into a request, so pages never build `/files/...` by hand.

/** An object URL for showing a stored file inline. The caller revokes it. */
export function fileBlobUrl(rel) {
  return api.blobUrl(`/files/${rel}`)
}

/** Saves a stored file, under `name` or the last part of its path. */
export function downloadFile(rel, name = rel.split('/').pop()) {
  return api.download(`/files/${rel}`, name)
}
