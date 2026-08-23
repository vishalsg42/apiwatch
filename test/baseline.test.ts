import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keyOf, readBaseline, writeBaseline } from '../src/baseline.js'
import type { Finding } from '../src/model.js'

const finding = (over: Partial<Finding> = {}): Finding => ({
  rule: 'no-timeout',
  severity: 'error',
  fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  callSiteId: 'x',
  file: 'src/svc.ts',
  line: 4,
  message: 'no deadline',
  evidence: 'axios.get()',
  ...over,
})

const tmp = () => join(mkdtempSync(join(tmpdir(), 'apiwatch-bl-')), 'baseline.json')

const opts = { root: '.', includeNonShipping: false }

describe('baseline file', () => {
  it('keys on rule AND fingerprint, never fingerprint alone', () => {
    const a = finding({ rule: 'no-timeout' })
    const b = finding({ rule: 'no-retry', severity: 'warn' })
    expect(keyOf(a)).not.toBe(keyOf(b))
    expect(keyOf(a)).toContain('no-timeout')
  })

  it('writes byte-identical output for the same findings', () => {
    const p1 = tmp()
    const p2 = tmp()
    const fs = [finding(), finding({ rule: 'no-retry', severity: 'warn' })]
    writeBaseline(p1, fs, '0.3.0', opts)
    writeBaseline(p2, [...fs].reverse(), '0.3.0', opts)
    expect(readFileSync(p1, 'utf8')).toBe(readFileSync(p2, 'utf8'))
  })

  it('counts duplicates rather than storing them twice', () => {
    const p = tmp()
    writeBaseline(p, [finding(), finding()], '0.3.0', opts)
    const b = readBaseline(p)
    expect(b.accepted).toHaveLength(1)
    expect(b.accepted[0].count).toBe(2)
  })

  it('puts one entry per line so branches can auto-merge', () => {
    const p = tmp()
    writeBaseline(
      p,
      [finding(), finding({ fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbb' })],
      '0.3.0',
      opts,
    )
    const entryLines = readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.trim().startsWith('{"fp"'))
    expect(entryLines).toHaveLength(2)
  })

  it('rejects a malformed file rather than accepting nothing', () => {
    const p = tmp()
    writeFileSync(p, '{ not json')
    expect(() => readBaseline(p)).toThrow(/could not be parsed|malformed/i)
  })

  it('rejects a baseline from a different fingerprint version', () => {
    const p = tmp()
    writeBaseline(p, [finding()], '0.3.0', opts)
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    raw.fingerprintVersion = 999
    writeFileSync(p, JSON.stringify(raw))
    expect(() => readBaseline(p)).toThrow(/fingerprintVersion/i)
  })

  it('rejects a baseline recorded against a different root', () => {
    const p = tmp()
    writeBaseline(p, [finding()], '0.3.0', { root: 'packages/api', includeNonShipping: false })
    expect(() => readBaseline(p, { root: '.', includeNonShipping: false })).toThrow(/root/i)
  })

  it('stores an excerpt for review, and no line number', () => {
    const p = tmp()
    writeBaseline(p, [finding()], '0.3.0', opts)
    const entry = readBaseline(p).accepted[0]
    expect(entry.excerpt).toBeTruthy()
    expect(entry).not.toHaveProperty('line')
  })
})
