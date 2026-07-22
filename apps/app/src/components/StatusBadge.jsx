// Shared pill renderer for the {bg, c, br, label}-shaped status/priority tone
// maps each page defines for its own domain (asset status, WO priority, PM
// task status, inspection status, compliance status). The maps themselves
// stay page-local since the vocabularies genuinely differ — this only
// dedupes the repeated inline-style span markup for rendering one.
export default function StatusBadge({ tone, label, size = 'sm', weight, uppercase = false, style }) {
  const sizing = size === 'md' ? { padding: '2px 8px', fontSize: 11 } : { padding: '2px 7px', fontSize: 10 }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 2,
        border: `1px solid ${tone.br}`,
        background: tone.bg,
        color: tone.c,
        fontWeight: weight ?? 500,
        whiteSpace: 'nowrap',
        ...(uppercase ? { textTransform: 'uppercase', letterSpacing: '.04em' } : {}),
        ...sizing,
        ...style,
      }}
    >
      {label ?? tone.label}
    </span>
  )
}
