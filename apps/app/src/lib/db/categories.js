import { api } from '../apiClient'

export async function listCategories() {
  return api.get('/categories')
}

export async function createCategory(input) {
  return api.post('/categories', input)
}

export async function updateCategory(id, patch) {
  return api.patch(`/categories/${id}`, patch)
}

export async function deleteCategory(id) {
  await api.del(`/categories/${id}`)
}
