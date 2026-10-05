import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from './errors'

/**
 * Loads data for a screen: `{ data, loading, error, reload, setData }`.
 *
 *   const { data, loading, error } = useResource(() => getIntegrityOverview({ locationId }), [locationId],
 *     { errorFallback: 'Could not load the integrity overview.' })
 *
 * Every page used to write this out by hand (a loading flag, an error state,
 * a load function, an effect), and only 12 of 84 effects ignored a response
 * that arrived after a newer request had started. Switching the location
 * filter quickly could leave the older answer on screen. Here only the latest
 * request's answer is ever applied, and nothing is applied after unmount.
 *
 * - `deps` re-run the fetch, like an effect's dependency list.
 * - `error` is already a sentence (errorText with `errorFallback` and
 *   `overrides`), ready to render.
 * - By default the old data is cleared while a new request runs, so the page
 *   shows its loading state. Pass `keepPrevious: true` where a reload after an
 *   action should keep the current rows on screen until the new ones arrive.
 * - `reload()` refetches and resolves with the new data (or undefined on
 *   failure).
 */
export function useResource(fetcher, deps, { initial = null, errorFallback, overrides, keepPrevious = false } = {}) {
  const [state, setState] = useState({ data: initial, loading: true, error: null })
  const latest = useRef(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const options = useRef({ initial, errorFallback, overrides, keepPrevious })
  options.current = { initial, errorFallback, overrides, keepPrevious }

  const reload = useCallback(() => {
    const id = ++latest.current
    const o = options.current
    setState((s) => ({ data: o.keepPrevious ? s.data : o.initial, loading: true, error: null }))
    return Promise.resolve()
      .then(() => fetcherRef.current())
      .then(
        (data) => {
          if (id === latest.current) setState({ data, loading: false, error: null })
          return data
        },
        (e) => {
          if (id === latest.current) {
            setState((s) => ({ ...s, loading: false, error: errorText(e, o.errorFallback, o.overrides) }))
          }
          return undefined
        },
      )
  // The caller's deps decide when to refetch, exactly as for an effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { reload() }, [reload])
  // An answer that lands after the screen has gone is dropped.
  useEffect(() => () => { latest.current++ }, [])

  const setData = useCallback((next) => {
    setState((s) => ({ ...s, data: typeof next === 'function' ? next(s.data) : next }))
  }, [])

  return { ...state, reload, setData }
}
