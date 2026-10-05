import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit tests for the app's pure helpers (and the shared rbac package the app
// gates with). No DOM: anything that needs one waits for a component test setup.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // The instance's zone, so date tests mean what they say.
    env: { TZ: 'Africa/Lagos' },
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}', '../../packages/rbac/*.test.js', '../../packages/domain/*.test.js'],
  },
})
