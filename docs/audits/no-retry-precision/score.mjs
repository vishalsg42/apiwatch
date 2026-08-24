import { readFileSync } from 'node:fs'
const P = process.argv[2]
const truth = JSON.parse(readFileSync(`${P}/cases-truth.json`, 'utf8'))
const cls = Object.fromEntries(truth.map((c) => [c.caseId, c]))
const load = (f) =>
  Object.fromEntries(
    readFileSync(`${P}/${f}`, 'utf8').trim().split('\n').map((l) => {
      const [id, v] = l.split(/\s+/)
      return [id, v]
    }),
  )
const A = load('verdicts-A.txt')
const B = load('verdicts-B.txt')
const ids = truth.map((c) => c.caseId)

// Inter-rater reliability over ALL cases, before any scoring.
let agree = 0
const cats = ['NO_RETRY', 'HAS_RETRY', 'CANNOT_TELL']
const nA = {}, nB = {}
for (const id of ids) {
  if (A[id] === B[id]) agree++
  nA[A[id]] = (nA[A[id]] ?? 0) + 1
  nB[B[id]] = (nB[B[id]] ?? 0) + 1
}
const po = agree / ids.length
const pe = cats.reduce((s, k) => s + ((nA[k] ?? 0) / ids.length) * ((nB[k] ?? 0) / ids.length), 0)
const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe)

const wilson = (k, n) => {
  if (n === 0) return [0, 0]
  const z = 1.96, p = k / n, d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [(c - m) / d, (c + m) / d]
}

const report = (name, V) => {
  const fired = ids.filter((id) => cls[id].klass === 'FIRED')
  const tp = fired.filter((id) => V[id] === 'NO_RETRY').length
  const fp = fired.filter((id) => V[id] === 'HAS_RETRY' || V[id] === 'CANNOT_TELL').length
  const [lo, hi] = wilson(tp, tp + fp)
  console.log(`\n== ${name} ==`)
  console.log(`  FIRED: ${tp} true positive, ${fp} false positive of ${fired.length}`)
  console.log(`  precision ${((100 * tp) / (tp + fp)).toFixed(1)}%  Wilson 95% [${(100 * lo).toFixed(1)}%, ${(100 * hi).toFixed(1)}%]`)
  const lib = ids.filter((id) => cls[id].klass === 'SILENT_LIBRARY')
  console.log(`  SILENT_LIBRARY controls (${lib.length}): ` +
    lib.map((id) => `${id}=${V[id]}${V[id] === 'HAS_RETRY' ? ' correct silence' : ' CANDIDATE FALSE SUPPRESSION'}`).join('; '))
  const unk = ids.filter((id) => cls[id].klass === 'SILENT_UNKNOWN')
  const missed = unk.filter((id) => V[id] === 'NO_RETRY').length
  console.log(`  SILENT_UNKNOWN (${unk.length}, score nothing): ${missed} would have been real findings, ${unk.length - missed} genuinely retried`)
  return { tp, fp, fired }
}

console.log(`cases ${ids.length}  raw agreement ${(100 * po).toFixed(1)}%  Cohen kappa ${kappa.toFixed(3)}`)
const a = report('Judge A (sonnet)', A)
const b = report('Judge B (opus)', B)

console.log('\n== disagreements ==')
const dis = ids.filter((id) => A[id] !== B[id])
if (!dis.length) console.log('  none')
for (const id of dis)
  console.log(`  ${id} [${cls[id].klass}] A=${A[id]} B=${B[id]}  ${cls[id].repo}/${cls[id].file}:${cls[id].line}`)

console.log('\n== FIRED cases either judge called HAS_RETRY / CANNOT_TELL ==')
const susp = ids.filter((id) => cls[id].klass === 'FIRED' && (A[id] !== 'NO_RETRY' || B[id] !== 'NO_RETRY'))
for (const id of susp)
  console.log(`  ${id} A=${A[id]} B=${B[id]}  ${cls[id].repo}/${cls[id].file}:${cls[id].line} ${cls[id].client}.${cls[id].method ?? 'request'}`)

// Pre-registered decision rule: Fisher exact vs the no-timeout 40/40 arm reaches p<0.05 only at
// 34/40 or worse. Anything 35..40 is statistically indistinguishable at this n.
const worst = Math.min(a.tp, b.tp)
console.log(`\n== decision (pre-registered) ==`)
console.log(`  worst-case true positives across judges: ${worst}/40`)
console.log(`  ${worst >= 35 ? 'INDISTINGUISHABLE from no-timeout at n=40: warn is affirmed.' : 'BELOW threshold: file the warn -> info demotion for 0.4.0.'}`)
