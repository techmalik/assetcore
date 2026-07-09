import { useEffect, useState } from 'react'
import { api } from '../lib/apiClient'

// <img src> can't carry the Authorization header the files API requires, so
// this fetches the blob and swaps in an object URL once it's ready.
export default function AuthImage({ relPath, alt = '', style }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let objectUrl = null
    let cancelled = false
    api.blobUrl(`/files/${relPath}`).then((u) => {
      if (cancelled) { URL.revokeObjectURL(u); return }
      objectUrl = u
      setUrl(u)
    }).catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [relPath])

  if (!url) return <div style={{ ...style, background: 'var(--n100)' }} />
  return <img src={url} alt={alt} style={style} />
}
