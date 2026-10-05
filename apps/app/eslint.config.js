// Lint for the things a build does not catch in plain JS: a name that is not
// defined or imported throws only when that page renders, for that user.
// Style is not linted here; the rules below are the ones that find bugs.
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-syntax': ['warn', {
        selector: "CallExpression[callee.name='alert']",
        message: 'Show errors with toast.error(errorText(e)), not alert().',
      }],
      // Gate UI with useCan() from AuthContext, which applies per-user grants.
      // Calling can() directly is how thirteen checks came to ignore them.
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/rbac', '**/rbac.js', '@assetcore/rbac'],
          importNames: ['can'],
          message: 'Use const can = useCan() from lib/AuthContext so per-user grants apply.',
        }],
      }],
    },
  },
  {
    // AuthContext builds useCan() on can(); the Admin permissions matrix shows
    // what each role grants on its own, before any per-user grant.
    files: ['src/lib/AuthContext.jsx', 'src/lib/rbac.js', 'src/pages/Admin.jsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
]
