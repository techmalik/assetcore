import { api } from '../apiClient'

/** The signed-in user's own profile: full_name, phone, email. */
export async function getProfile() {
  return api.get('/profile')
}

export async function updateProfile(patch) {
  return api.patch('/profile', patch)
}
