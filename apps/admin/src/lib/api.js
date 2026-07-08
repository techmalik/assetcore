import { rawApi } from './apiClient'

// Thin wrapper scoping every call to /api/admin/* (requirePlatformAdmin on
// apps/api). Page call sites (api.get('/orgs'), etc.) are unchanged from the
// Edge-Function era — only the base path and auth mechanism moved.
export const api = {
  get: (path) => rawApi.get(`/admin${path}`),
  post: (path, body) => rawApi.post(`/admin${path}`, body),
  patch: (path, body) => rawApi.patch(`/admin${path}`, body),
  del: (path) => rawApi.del(`/admin${path}`),
}
