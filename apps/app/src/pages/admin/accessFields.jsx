import { GRANTABLE_CAPS as GRANTABLE_CAP_KEYS } from '../../lib/rbac.js'

// Human labels for the grantable capabilities. The KEYS come from
// @assetcore/rbac (the same list the API's invite/access schemas validate
// against), so the chips offered here always match what the server accepts.
const CAP_LABELS = {
  'asset:create': 'Create assets',
  'asset:update': 'Edit assets',
  'wo:create': 'Create work orders',
  'wo:update': 'Edit work orders',
  'wo:assign': 'Assign work orders',
  'wo:transition': 'Change work-order status',
  'pm:create': 'Create maintenance schedules',
  'pm:update': 'Update maintenance status',
  'maintenance:complete': 'Complete maintenance',
  'inspection:create': 'Create inspections',
  'inspection:update': 'Update inspection status',
  'compliance:create': 'Create compliance records',
  'compliance:update': 'Manage compliance',
  'parts:create': 'Add spare parts',
  'parts:update': 'Edit spare parts',
  'parts:adjust': 'Adjust stock levels',
  'defect:create': 'Raise defects',
  'defect:update': 'Update defects',
  'risk:create': 'Register risks',
  'risk:update': 'Update risks',
  'approval:create': 'Submit for approval',
  'approval:decide': 'Approve or reject requests',
  'audit:read': 'View audit log',
}
const GRANTABLE_CAPS = GRANTABLE_CAP_KEYS.map((key) => ({ key, label: CAP_LABELS[key] || key }))

// A toggle chip with an explicit check when selected — reads more clearly than
// a bare colour swap, especially for people filling the form quickly.
function Chip({ on, disabled, onClick, children, title }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 11px', borderRadius: 999,
        cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--ff-u)',
        border: `1px solid ${on ? 'var(--b400)' : 'var(--n300)'}`,
        background: on ? 'var(--b50)' : 'var(--n0)', color: on ? 'var(--b700)' : 'var(--n700)',
        opacity: disabled ? .6 : 1, fontWeight: on ? 500 : 400,
      }}>
      {on && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.2 2.2L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      {children}
    </button>
  )
}

// "Select all / Clear" for a chip group. Deselecting a long list one chip at a
// time was the only way to undo a broad grant, which made narrowing someone's
// access tedious enough to be skipped.
function BulkToggle({ onAll, onNone, allOn, noneOn }) {
  const link = (disabled) => ({
    background: 'none', border: 'none', padding: 0, fontSize: 11, fontFamily: 'var(--ff-u)',
    color: disabled ? 'var(--n400)' : 'var(--b600)', cursor: disabled ? 'default' : 'pointer',
  })
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <button type="button" onClick={onAll} disabled={allOn} style={link(allOn)}>Select all</button>
      <span style={{ color: 'var(--n300)', fontSize: 11 }}>·</span>
      <button type="button" onClick={onNone} disabled={noneOn} style={link(noneOn)}>Clear</button>
    </span>
  )
}

// Shared scope + capability picker used by the invite and edit-access modals.
// Locations and sites are separated visually and sites are grouped under their
// location, so it's obvious what a selection grants (a location grants every
// site in it; individual sites add oversight beyond that).
export function ScopeCapsFields({ locations, sites, value, onChange }) {
  const toggle = (field, id) => {
    const cur = value[field] || []
    onChange({ ...value, [field]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }
  const setField = (field, ids) => onChange({ ...value, [field]: ids })
  const locSel = value.location_scope || []
  const siteSel = value.site_scope || []
  const capSel = value.extra_caps || []
  const scoped = locSel.length + siteSel.length > 0

  // Group sites under their location (plus an "Unassigned" bucket) for scanning.
  const groups = []
  for (const l of locations) {
    const inLoc = sites.filter((s) => s.location_id === l.id)
    if (inLoc.length) groups.push({ id: l.id, name: l.name, sites: inLoc })
  }
  const orphans = sites.filter((s) => !s.location_id || !locations.some((l) => l.id === s.location_id))
  if (orphans.length) groups.push({ id: 'none', name: 'Unassigned', sites: orphans })

  // Sites a bulk "select all" should actually touch: everything not already
  // granted through a selected location.
  const selectableSites = sites.filter((s) => !s.location_id || !locSel.includes(s.location_id))

  const summary = scoped
    ? `Limited to ${locSel.length ? `${locSel.length} location${locSel.length !== 1 ? 's' : ''}` : ''}${locSel.length && siteSel.length ? ' + ' : ''}${siteSel.length ? `${siteSel.length} site${siteSel.length !== 1 ? 's' : ''}` : ''}.`
    : 'Full access — every location and site.'

  const secLabel = { fontSize: 13, fontWeight: 600, color: 'var(--n800)' }
  const secHint = { fontSize: 12, color: 'var(--n500)', marginTop: 1, lineHeight: 1.5 }
  const box = { display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Scope */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={secLabel}>Access scope</div>
          <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 9px', borderRadius: 999, background: scoped ? 'var(--b50)' : 'var(--sgb)', color: scoped ? 'var(--b700)' : 'var(--sgt)', border: `1px solid ${scoped ? 'var(--b200)' : 'var(--sgbr)'}` }}>{scoped ? 'Restricted' : 'All access'}</span>
        </div>
        <div style={secHint}>{summary}</div>

        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n700)' }}>Locations</div>
            {locations.length > 0 && (
              <BulkToggle
                allOn={locSel.length === locations.length}
                noneOn={locSel.length === 0}
                onAll={() => setField('location_scope', locations.map((l) => l.id))}
                onNone={() => setField('location_scope', [])}
              />
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--n500)' }}>Selecting a location grants every site inside it.</div>
          <div style={box}>
            {locations.map((l) => (
              <Chip key={l.id} on={locSel.includes(l.id)} onClick={() => toggle('location_scope', l.id)}>
                {l.name}{typeof l.site_count === 'number' ? <span style={{ opacity: .6, marginLeft: 3 }}>· {l.site_count}</span> : null}
              </Chip>
            ))}
            {locations.length === 0 && <span style={{ fontSize: 12, color: 'var(--n400)' }}>No locations yet — add them in Admin → Locations.</span>}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n700)' }}>Individual sites</div>
            {selectableSites.length > 0 && (
              <BulkToggle
                allOn={selectableSites.every((s) => siteSel.includes(s.id))}
                noneOn={siteSel.length === 0}
                // Sites already covered by a selected location are left out —
                // adding them would be a redundant grant that survives if the
                // location is later deselected.
                onAll={() => setField('site_scope', selectableSites.map((s) => s.id))}
                onNone={() => setField('site_scope', [])}
              />
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--n500)' }}>Add specific sites for oversight beyond the locations above.</div>
          {groups.map((g) => (
            <div key={g.id} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n400)', fontFamily: 'var(--ff-m)' }}>{g.name}</div>
              <div style={box}>
                {g.sites.map((s) => {
                  const viaLoc = g.id !== 'none' && locSel.includes(g.id)
                  return (
                    <Chip key={s.id} on={viaLoc || siteSel.includes(s.id)} disabled={viaLoc}
                      title={viaLoc ? `Included via ${g.name}` : undefined}
                      onClick={() => toggle('site_scope', s.id)}>
                      {s.name}
                    </Chip>
                  )
                })}
              </div>
            </div>
          ))}
          {sites.length === 0 && <div style={{ fontSize: 12, color: 'var(--n400)', marginTop: 8 }}>No sites yet.</div>}
        </div>
      </div>

      {/* Extra permissions */}
      <div style={{ borderTop: 'var(--bdr)', paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={secLabel}>Extra permissions</div>
          <BulkToggle
            allOn={capSel.length === GRANTABLE_CAPS.length}
            noneOn={capSel.length === 0}
            onAll={() => setField('extra_caps', GRANTABLE_CAPS.map((c) => c.key))}
            onNone={() => setField('extra_caps', [])}
          />
        </div>
        <div style={secHint}>Granted on top of the role's defaults.{capSel.length ? ` (${capSel.length} added)` : ''}</div>
        <div style={box}>
          {GRANTABLE_CAPS.map((c) => <Chip key={c.key} on={capSel.includes(c.key)} onClick={() => toggle('extra_caps', c.key)}>{c.label}</Chip>)}
        </div>
      </div>
    </div>
  )
}
