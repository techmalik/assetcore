import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed at the /admin/ subpath behind nginx (see deploy/nginx.conf) —
// only the production build needs the base path; the dev server still
// serves from / on its own port.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/admin/' : '/',
  plugins: [react()],
  server: {
    host: true,
    port: parseInt(process.env.PORT || '5176'),
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
}))
