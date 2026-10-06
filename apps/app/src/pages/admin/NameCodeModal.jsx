import { useState } from 'react'
import Modal from '../../components/Modal.jsx'
import { Field, FormError, useForm } from '../../components/form.jsx'
import { errorText } from '../../lib/errors'

/**
 * Add or edit a record that is a name and a short code: a location or an
 * asset category. `save(form)` creates or updates it; the modal closes
 * through onSaved once that resolves, and shows the error if it fails.
 */
export default function NameCodeModal({ title, record, name, code, save, onClose, onSaved }) {
  const { form, set } = useForm({ name: record?.name || '', code: record?.code || '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim() || (code.required && !form.code.trim())) {
      setErr(code.required ? 'Name and code are required.' : 'Name is required.')
      return
    }
    setSaving(true)
    try {
      await save(form)
      onSaved()
    } catch (ex) {
      setErr(errorText(ex))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={title}
      width={380}
      as="form"
      onSubmit={submit}
      onClose={onClose}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <Field label={name.label} required>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={name.placeholder} />
      </Field>
      <Field label={code.label} required={code.required}>
        <input className="input" value={form.code} onChange={(e) => set('code', e.target.value)} placeholder={code.placeholder} />
      </Field>
      <FormError>{err}</FormError>
    </Modal>
  )
}
