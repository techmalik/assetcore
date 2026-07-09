// Per-client branding, baked in at build time (each client gets a rebuilt
// bundle — see deploy/.env.deploy.example). No runtime config.
export const INSTANCE_NAME = import.meta.env.VITE_INSTANCE_NAME || 'AssetCore'
export const INSTANCE_CLIENT = import.meta.env.VITE_INSTANCE_CLIENT || ''
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@assetcore.io'
