/**
 * The loading, error and empty states of a list, then the list itself.
 *
 *   <TableState loading={loading} error={error} onRetry={reload}
 *     isEmpty={rows.length === 0} empty={<EmptyState … />}>
 *     <table>…</table>
 *   </TableState>
 *
 * Pass `colSpan` when the state sits inside a <tbody>: it is then drawn as
 * one full-width row.
 */
export default function TableState({ loading, error, onRetry, isEmpty, empty, loadingText = 'Loading…', colSpan, children }) {
  let state = null
  if (loading) {
    state = <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>{loadingText}</div>
  } else if (error) {
    state = (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: onRetry ? 12 : 0 }}>{error}</p>
        {onRetry && <button type="button" onClick={onRetry} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>}
      </div>
    )
  } else if (isEmpty) {
    state = empty
  }
  if (!state) return children
  return colSpan ? <tr><td colSpan={colSpan}>{state}</td></tr> : state
}
