/** What a screen shows when it has nothing to list: an icon, a title, a
 * sentence on what belongs here, and the action that adds the first one. */
export default function EmptyState({ icon, title, body, action, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: 12, textAlign: 'center', ...style }}>
      {icon}
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n700)' }}>{title}</div>
      {body && <div style={{ fontSize: 13, color: 'var(--n500)', maxWidth: 360, lineHeight: 1.6 }}>{body}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}
