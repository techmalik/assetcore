// apiClient reads the stored token from localStorage when it is imported, and
// money.jsx reaches it through AuthContext. Node has no usable localStorage
// (newer versions expose one that is undefined without a backing file), so the
// unit tests get a plain in-memory one.
const store = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
    clear: () => { store.clear() },
  },
})
