import { describe, expect, it } from 'vitest'
import { parseCSV, csvCell, CSV_HEADERS } from '../csv'

describe('parseCSV', () => {
  it('reads rows keyed by the lower-cased, trimmed header', () => {
    expect(parseCSV('AIN, Name\nAST-1,Pump\nAST-2, Valve \n')).toEqual([
      { ain: 'AST-1', name: 'Pump' },
      { ain: 'AST-2', name: 'Valve' },
    ])
  })

  it('handles quoted fields with commas, doubled quotes and line breaks', () => {
    const text = 'ain,name,tags\r\n"AST-1","Pump, ""main""","a,b"\r\n"AST-2","two\nlines",\r\n'
    expect(parseCSV(text)).toEqual([
      { ain: 'AST-1', name: 'Pump, "main"', tags: 'a,b' },
      { ain: 'AST-2', name: 'two\nlines', tags: '' },
    ])
  })

  it('skips blank rows, and fills a short row with empty strings', () => {
    expect(parseCSV('ain,name,site\n\n,,\nAST-1,Pump\n')).toEqual([{ ain: 'AST-1', name: 'Pump', site: '' }])
  })

  it('answers no rows for an empty or header-only file', () => {
    expect(parseCSV('')).toEqual([])
    expect(parseCSV('ain,name\n')).toEqual([])
  })

  it('reads back what csvCell writes', () => {
    const values = ['plain', 'with, comma', 'with "quote"', 'two\nlines']
    const text = 'a,b,c,d\n' + values.map(csvCell).join(',') + '\n'
    expect(parseCSV(text)).toEqual([{ a: values[0], b: values[1], c: values[2], d: values[3] }])
  })
})

describe('the import template', () => {
  it('has no health_score column: health is derived', () => {
    expect(CSV_HEADERS).not.toContain('health_score')
    expect(CSV_HEADERS).toContain('last_maintenance_date')
  })
})
