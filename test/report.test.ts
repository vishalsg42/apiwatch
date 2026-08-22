import { describe, expect, it } from 'vitest'
import { renderJson } from '../src/report/json.js'
import { renderMarkdown } from '../src/report/markdown.js'
import { buildReport } from '../src/report/model.js'
import { renderTty } from '../src/report/tty.js'
import { runRules } from '../src/rules/index.js'
import { site, ws } from './helpers.js'

const model = (sites = [site()]) =>
  buildReport({ findings: runRules(sites, ws), sites, filesAnalysed: 10, filesSkipped: 0 })

describe('reporters', () => {
  it('counts findings by rule', () => expect(model().countsByRule['no-timeout']).toBe(1))
  it('counts call sites whose host is unresolved', () =>
    expect(model().unresolvedHostCount).toBe(1))
  it('tty names the rule, file and line', () => {
    const o = renderTty(model())
    expect(o).toContain('no-timeout')
    expect(o).toContain('src/x.ts:10')
  })
  it('tty prints the hint when hosts are unresolved', () =>
    expect(renderTty(model())).toMatch(/apiwatch audit -- /))
  it('tty omits the hint when every host is known', () =>
    expect(
      renderTty(model([site({ url: { kind: 'literal', url: 'https://a.dev/x', host: 'a.dev' } })])),
    ).not.toMatch(/apiwatch audit -- /))
  it('tty reports the analysed file count', () =>
    expect(renderTty(model())).toMatch(/analysed 10 of 10 files/))
  it('markdown contains a findings table header', () =>
    expect(renderMarkdown(model())).toMatch(/\| rule \|/i))
  it('json carries schemaVersion 1', () =>
    expect(JSON.parse(renderJson(model())).schemaVersion).toBe(1))
})
