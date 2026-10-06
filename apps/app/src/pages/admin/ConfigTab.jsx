import { useState, useEffect } from 'react'
import { getOrg, updateOrgSettings } from '../../lib/db/org.js'
import { useCan } from '../../lib/AuthContext.jsx'
import { errorText } from '../../lib/errors'
import { useResource } from '../../lib/useResource'
import TableState from '../../components/TableState.jsx'

// ── Configuration Tab ─────────────────────────────────────────────────────────

export default function ConfigTab() {
  const can = useCan()
  const canEdit = can('org:manage')
  // Both forms save by merging into the settings that were loaded, so they
  // only render once the load has succeeded. Saving after a failed load used
  // to write settings built from nothing, wiping the depreciation policy and
  // the onboarded flag along with the thresholds.
  const { data: org, setData: setOrg, loading, error, reload } = useResource(getOrg, [], {
    errorFallback: 'Could not load the organisation settings.',
  })
  const [threshold, setThreshold] = useState(50)
  const [maintThreshold, setMaintThreshold] = useState(30)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  // Org-wide depreciation policy. Every asset inherits this unless it carries
  // its own override, and saving it recomputes the whole register server-side
  // (PATCH /org/settings) rather than waiting for the 02:00 job.
  const [depMethod, setDepMethod] = useState('straight_line')
  const [depLife, setDepLife] = useState(10)
  const [depSalvage, setDepSalvage] = useState(0)
  const [depRate, setDepRate] = useState(20)
  const [depStart, setDepStart] = useState('install_date')
  const [depSaving, setDepSaving] = useState(false)
  const [depMsg, setDepMsg] = useState(null)

  // Fill both forms from what was loaded.
  useEffect(() => {
    if (!org) return
    setThreshold(org.settings?.health?.inspectionThreshold ?? 50)
    setMaintThreshold(org.settings?.health?.maintenanceThreshold ?? 30)
    const d = org.settings?.depreciation || {}
    setDepMethod(d.method ?? 'straight_line')
    setDepLife(d.usefulLifeYears ?? 10)
    setDepSalvage(d.salvageRatePct ?? 0)
    setDepRate(d.decliningRatePct ?? 20)
    setDepStart(d.startFrom ?? 'install_date')
  }, [org])

  async function saveDepreciation() {
    setDepSaving(true); setDepMsg(null)
    try {
      const life = Math.max(0.5, Math.min(200, Number(depLife) || 10))
      const salvage = Math.max(0, Math.min(99, Number(depSalvage) || 0))
      const rate = Math.max(0.1, Math.min(99.9, Number(depRate) || 20))
      // Merge, don't replace — PATCH /org/settings writes the whole settings
      // object, so building it from scratch here would wipe the health
      // thresholds saved by the card above.
      const settings = {
        ...org.settings,
        depreciation: { method: depMethod, usefulLifeYears: life, salvageRatePct: salvage, decliningRatePct: rate, startFrom: depStart },
      }
      const updated = await updateOrgSettings(settings)
      setOrg(updated); setDepLife(life); setDepSalvage(salvage); setDepRate(rate)
      setDepMsg('Saved — book values recalculated.')
    } catch (e) { setDepMsg(errorText(e, 'Could not save the depreciation policy.')) } finally { setDepSaving(false) }
  }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const t = Math.max(1, Math.min(99, Number(threshold) || 50))
      const m = Math.max(1, Math.min(99, Number(maintThreshold) || 30))
      // The maintenance band must sit below the inspection band — otherwise an
      // asset would trigger maintenance before (or instead of) an inspection.
      if (m >= t) { setMsg('Maintenance threshold must be below the inspection threshold.'); setSaving(false); return }
      const settings = { ...org.settings, health: { ...org.settings?.health, inspectionThreshold: t, maintenanceThreshold: m } }
      const updated = await updateOrgSettings(settings)
      setOrg(updated); setThreshold(t); setMaintThreshold(m); setMsg('Saved.')
    } catch (e) { setMsg(errorText(e)) } finally { setSaving(false) }
  }

  return (
    <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
      <TableState loading={loading} error={error} onRetry={reload}>
        <div style={{maxWidth:520,background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'18px 20px'}}>
          <div style={{fontSize:14,fontWeight:600,color:'var(--n800)',marginBottom:4}}>Health thresholds</div>
          <div style={{fontSize:12,color:'var(--n500)',marginBottom:14,lineHeight:1.6}}>
            When an asset's health falls to the inspection threshold, an inspection is raised.
            At the maintenance threshold, a maintenance alert is sent and a work order is auto-drafted.
            The maintenance threshold must be below the inspection threshold.
          </div>
          <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
            Inspection alert at
            <input type="number" min={1} max={99} value={threshold} disabled={!canEdit}
              onChange={e => setThreshold(e.target.value)}
              className="input input-sm" style={{width:80}}/>
            % health
          </label>
          <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)'}}>
            Maintenance trigger at
            <input type="number" min={1} max={99} value={maintThreshold} disabled={!canEdit}
              onChange={e => setMaintThreshold(e.target.value)}
              className="input input-sm" style={{width:80}}/>
            % health
          </label>
          {!canEdit && <div style={{fontSize:11,color:'var(--n400)',marginTop:8}}>Only a System Admin or Operations Manager can change this.</div>}
          {msg && <div style={{fontSize:12,color:msg==='Saved.'?'var(--sgt)':'var(--srt)',marginTop:10}}>{msg}</div>}
          {canEdit && (
            <div style={{marginTop:16}}>
              <button className="btn btn-primary" style={{height:34,padding:'0 16px',fontSize:13}} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </div>

        <div style={{maxWidth:520,background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'18px 20px',marginTop:16}}>
          <div style={{fontSize:14,fontWeight:600,color:'var(--n800)',marginBottom:4}}>Depreciation</div>
          <div style={{fontSize:12,color:'var(--n500)',marginBottom:14,lineHeight:1.6}}>
            How book value is calculated across the asset register. Individual assets
            can override any of these; anything left unset here uses the defaults below.
            Assets without a purchase value or a start date show no book value at all
            rather than zero.
          </div>

          <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
            <span style={{width:150,flexShrink:0}}>Method</span>
            <select value={depMethod} disabled={!canEdit} onChange={e => setDepMethod(e.target.value)}
              className="input input-sm" style={{flex:1}}>
              <option value="straight_line">Straight-line</option>
              <option value="declining_balance">Declining balance</option>
              <option value="none">Do not depreciate</option>
            </select>
          </label>

          {depMethod !== 'none' && (
            <>
              <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
                <span style={{width:150,flexShrink:0}}>Depreciate from</span>
                <select value={depStart} disabled={!canEdit} onChange={e => setDepStart(e.target.value)}
                  className="input input-sm" style={{flex:1}}>
                  <option value="install_date">Install date</option>
                  <option value="purchase_date">Purchase date</option>
                </select>
              </label>

              {depMethod === 'straight_line' && (
                <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
                  <span style={{width:150,flexShrink:0}}>Useful life</span>
                  <input type="number" min={0.5} max={200} step={0.5} value={depLife} disabled={!canEdit}
                    onChange={e => setDepLife(e.target.value)}
                    className="input input-sm" style={{width:90}}/>
                  years
                </label>
              )}

              {depMethod === 'declining_balance' && (
                <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
                  <span style={{width:150,flexShrink:0}}>Declining rate</span>
                  <input type="number" min={0.1} max={99.9} step={0.1} value={depRate} disabled={!canEdit}
                    onChange={e => setDepRate(e.target.value)}
                    className="input input-sm" style={{width:90}}/>
                  % per year
                </label>
              )}

              <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)'}}>
                <span style={{width:150,flexShrink:0}}>Residual value</span>
                <input type="number" min={0} max={99} value={depSalvage} disabled={!canEdit}
                  onChange={e => setDepSalvage(e.target.value)}
                  className="input input-sm" style={{width:90}}/>
                % of purchase value
              </label>
            </>
          )}

          {!canEdit && <div style={{fontSize:11,color:'var(--n400)',marginTop:8}}>Only a System Admin or Operations Manager can change this.</div>}
          {depMsg && <div style={{fontSize:12,color:depMsg.startsWith('Saved')?'var(--sgt)':'var(--srt)',marginTop:10}}>{depMsg}</div>}
          {canEdit && (
            <div style={{marginTop:16}}>
              <button className="btn btn-primary" style={{height:34,padding:'0 16px',fontSize:13}} disabled={depSaving} onClick={saveDepreciation}>{depSaving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </div>
      </TableState>
    </div>
  )
}
