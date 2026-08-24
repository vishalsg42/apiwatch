// Deterministic: sort by a stable key, then take a fixed stride. No RNG, so the draw is
// reproducible and auditable from the committed case list, and cannot be quietly re-rolled.
// Cap of 2 per file so 40 cases cannot collapse into one directory of one repo.
import { readFileSync, writeFileSync } from 'node:fs'
const P = process.argv[2]
const all = JSON.parse(readFileSync(`${P}/all-cases.json`, 'utf8'))

const key = (x) => `${x.repo}|${x.file}|${String(x.line).padStart(6, '0')}`
all.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))

const capPerFile = (arr, cap) => {
  const seen = new Map()
  return arr.filter((x) => {
    const k = `${x.repo}|${x.file}`
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return n <= cap
  })
}
const stride = (arr, n) =>
  arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.floor((i * arr.length) / n)])

const fired = stride(capPerFile(all.filter((c) => c.fired), 2), 40).map((c) => ({ ...c, klass: 'FIRED' }))
const lib = all.filter((c) => c.retry === 'library').map((c) => ({ ...c, klass: 'SILENT_LIBRARY' }))
const unk = stride(capPerFile(all.filter((c) => c.retry === 'unknown'), 2), 12).map((c) => ({ ...c, klass: 'SILENT_UNKNOWN' }))

const cases = [...fired, ...lib, ...unk]
// Interleave so no batch is all one kind: a judge handed nine consecutive fired cases
// pattern-matches. Sorting by file text mixes the classes without revealing the class.
cases.sort((a, b) => (`${a.file}${a.line}` < `${b.file}${b.line}` ? -1 : 1))
cases.forEach((c, i) => { c.caseId = `R${String(i + 1).padStart(3, '0')}` })

writeFileSync(`${P}/cases-truth.json`, JSON.stringify(cases, null, 1))
writeFileSync(`${P}/cases-blind.json`, JSON.stringify(
  cases.map(({ caseId, repo, file, line, client, method }) => ({ caseId, repo, file, line, client, method })), null, 1))

const files = new Set(cases.filter((c) => c.klass === 'FIRED').map((c) => `${c.repo}|${c.file}`))
const perRepo = {}
for (const c of cases.filter((x) => x.klass === 'FIRED')) perRepo[c.repo] = (perRepo[c.repo] ?? 0) + 1
console.log(`fired ${fired.length} across ${files.size} files`, JSON.stringify(perRepo))
console.log(`controls: library ${lib.length}, unknown ${unk.length}; total cases ${cases.length}`)
