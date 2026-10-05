import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderDts } from './gen-dts.mjs'
import { WO_TRANSITIONS, WO_STATUSES, VALID_TRIGGERS, ESCALATION_ENTITY_TYPES, ESCALATION_TRIGGERS } from './index.js'

const here = path.dirname(fileURLToPath(import.meta.url))

describe('@assetcore/domain', () => {
  it('index.d.ts is what gen-dts.mjs would write (run it after editing index.js)', () => {
    expect(readFileSync(path.join(here, 'index.d.ts'), 'utf8')).toBe(renderDts())
  })

  it('every work-order status has its transitions, and they lead to real statuses', () => {
    expect(Object.keys(WO_TRANSITIONS).sort()).toEqual([...WO_STATUSES].sort())
    for (const next of Object.values(WO_TRANSITIONS)) for (const s of next) expect(WO_STATUSES).toContain(s)
  })

  it('escalation trigger pairs use only known entities and triggers', () => {
    for (const [entity, triggers] of Object.entries(VALID_TRIGGERS)) {
      expect(ESCALATION_ENTITY_TYPES).toContain(entity)
      for (const t of triggers) expect(ESCALATION_TRIGGERS).toContain(t)
    }
  })
})
