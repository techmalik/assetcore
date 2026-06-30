import { useState, useEffect, useCallback } from 'react'

// Small data-loading hook: runs an async fn, exposes { data, loading, error,
// reload }. Standardizes the loading/empty/error states every view needs.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null })

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    let active = true
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve()
      .then(fn)
      .then((data) => active && setState({ loading: false, error: null, data }))
      .catch((error) => active && setState({ loading: false, error, data: null }))
    return () => { active = false }
  }, deps)

  useEffect(() => run(), [run])
  return { ...state, reload: run }
}
