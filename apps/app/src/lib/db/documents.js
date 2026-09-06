import { api } from '../apiClient'

// A document hangs off exactly one parent. Pass one of:
//   { asset_id } | { work_order_id } | { inspection_id } | { compliance_licence_id }
export const DOCUMENT_KINDS = [
  ['photo', 'Photo'],
  ['manual', 'Manual'],
  ['warranty', 'Warranty'],
  ['certificate', 'Certificate'],
  ['drawing', 'Drawing'],
  ['report', 'Report'],
  ['invoice', 'Invoice'],
  ['other', 'Other'],
]

export async function listDocuments(parent) {
  const [key, value] = Object.entries(parent)[0]
  return api.get(`/documents?${key}=${encodeURIComponent(value)}`)
}

export async function uploadDocument(parent, file, { kind = 'other', description = '' } = {}) {
  const [key, value] = Object.entries(parent)[0]
  const form = new FormData()
  form.append('file', file)
  form.append(key, value)
  form.append('kind', kind)
  if (description) form.append('description', description)
  return api.upload('/documents', form)
}

export async function updateDocument(id, patch) {
  return api.patch(`/documents/${id}`, patch)
}

export async function deleteDocument(id) {
  await api.del(`/documents/${id}`)
}
