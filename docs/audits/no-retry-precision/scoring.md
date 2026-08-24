# no-retry precision: scoring rules and sampling frame

Written and committed BEFORE any judge ran. Nothing below may be changed after reading a verdict.

## What is being measured

`no-retry` fires on `retry === 'none' && IDEMPOTENT.has(method)` (`src/rules/index.ts:92`) with the
message *"no retry policy detected: confirm that failing fast is intentional here"*.

That message has two clauses. Only the first is measured here:

- **Factual, measured:** no retry policy governs this call.
- **Actionable, NOT measured:** this call should have one.

Judges are asked only the factual question, and never see the actionability clause. Whether failing
fast is correct is frequently unanswerable from code and is not something a rule claims to know.

**Consequence, stated in advance:** the resulting number cannot by itself settle whether `no-retry`
should stay at `warn` or drop to `info`. Severity is an actionability claim. A high factual
precision is fully compatible with `info` being the right severity, and vice versa.

## The corpus, pinned

Six repositories, the same trees the `no-timeout` audit used, still on disk and unmodified
(`git status --porcelain` empty, no stray `.apiwatch*` artifacts, verified before collection):

| repo | SHA | sites | fired |
|---|---|---|---|
| Ghost | 7abac61fd80233ff60e65866bc7f3e791cfb6228 | 52 | 35 |
| medusa | b2eaae16e512c0a82390dad6d072330852b2e3c4 | 23 | 14 |
| nocodb | 640fe3b06fb26c9d000e2258477001c0d5e62c73 | 44 | 13 |
| payload | db7543c2121f0b672e33436447122b5e09ea4f2b | 114 | 53 |
| strapi | 1fd9d80ad5f0a2c97d09ce7529f5cd9fdb91ca2d | 50 | 27 |
| tinacms | de5c7d72b67f589f1f5c4bccc5f5677e70cd7e2d | 43 | 23 |
| **total** | | **326** | **165** |

The `no-timeout` run never recorded SHAs, so this is the first pinned run. Comparisons to it are
therefore across the same checkouts but that fact is asserted from disk state, not from a record
made at the time.

Frame: `runAudit` defaults `includeNonShipping: false` and `discover.ts` excludes tests, so this is
precision **on shipped code**.

## Cross-check, run before sampling

The fired set is taken from `model.findings` (the rules pipeline). It is compared against the set
predicted from raw resolver output. Deciding fired-ness by evaluating the rule's own predicate
would assert the definition against itself and pass on a broken build.

Result: **all six repos agree exactly**, zero findings without a matching site, zero predicted
sites that did not fire, zero fired sites carrying a non-idempotent method.

## What the pool contains

```
none/absent            281      (165 fire; 116 do not, because the method is post or patch)
unknown/unreadable      29
unknown/opaque-spread   14
library/client-default   2
manual-loop              0
explicit                 0
disabled                 0
```

Fired by method: `undefined` 104, `get` 42, `put` 9, `delete` 6, `head` 4.
Fired by client: `fetch` 151, `axios` 14. Fired sites span 119 distinct files.

Two things follow, both recorded before judging:

1. **63% of fired cases have no readable method**, which means the headline number is largely a
   statement about bare `fetch(url)`. `IDEMPOTENT` contains `undefined` by design, because a call
   with no readable method defaults to GET. The method breakdown must be reported next to any rate.
2. **Only 2 `library` controls exist in the entire pool.** The plan assumed 10. The false
   suppression probe is therefore n=2 and bounds nothing. This is a limitation of the corpus, not
   a choice, and it is why the judge qualification set below carries the weight instead.

## Case classes

| class | pool | sampled | apiwatch's claim |
|---|---|---|---|
| FIRED | 165 | 40 | proven: no retry policy governs this call |
| SILENT_LIBRARY | 2 | 2 | proven: a retry policy does govern it |
| SILENT_UNKNOWN | 43 | 12 | **no claim at all** |

The 116 `retry === 'none'` sites that do not fire (post/patch) are deliberately NOT sampled. They
are a scope decision rather than a claim about retry, and a judge answering the factual question
would correctly say NO_RETRY on them, which would score as nothing meaningful.

## Scoring

Each case gets NO_RETRY / HAS_RETRY / CANNOT_TELL.

| apiwatch | judge | verdict |
|---|---|---|
| FIRED | NO_RETRY | true positive |
| FIRED | HAS_RETRY | FALSE POSITIVE |
| FIRED | CANNOT_TELL | FALSE POSITIVE (apiwatch claimed proof it did not have) |
| SILENT_LIBRARY | HAS_RETRY | correct silence |
| SILENT_LIBRARY | NO_RETRY | candidate FALSE SUPPRESSION, adjudicated by hand against the tool |
| SILENT_UNKNOWN | any | correct abstention, scores nothing |
| SILENT_UNKNOWN | NO_RETRY | missed finding, a recall cost, never a precision defect |

`precision = true positives / (true positives + false positives)`, over FIRED cases only.

A verdict on a SILENT_UNKNOWN case **never invalidates a judge**. apiwatch makes no claim there, so
a judge disagreeing with it is not evidence of anything. Only the qualification set below can
disqualify a judge.

## Citation chain, required

A `HAS_RETRY` verdict counts only if the judge supplies:

1. `file:line` of the retry mechanism, and
2. the linkage: the shared identifier, import, or wrapper invocation connecting that mechanism to
   **this** call site, quoted.

`HAS_RETRY` without a complete chain scores **CANNOT_TELL**, not a false positive. Every cited
chain is re-read by the scorer.

Rationale: `HAS_RETRY` needs one hit while `NO_RETRY` needs exhaustive proof of absence, so an
uncited yes is unfalsifiable and biased in the single direction that deflates measured precision.
Repository prose, comments, READMEs and design docs are explicitly **not** evidence; only
executable linkage is. Note that accepting proximity instead of linkage would reintroduce, as
ground truth, exactly the file-wide heuristic the resolver deliberately deleted for misclassifying
22 of 93 sites in one measured repo.

## Judge qualification

Existing controls only catch a judge biased toward "no". A judge biased toward "yes" would pass
every control and report 0% precision. So judges are first run against 10 cases with known ground
truth, 5 retry-present and 5 retry-absent, drawn from the repository's own fixtures. **All 10 must
be correct for a judge to be admitted.** This is the only mechanism that disqualifies a judge.

## Protocol

- 2 independent judges per case, one case per context, randomised order, identical prompt.
- Judges are never told apiwatch exists, which cases fired, or that a tool is under evaluation.
- Model and version pinned and recorded.
- Report raw agreement and Cohen's kappa. **If agreement is poor the precision number is not
  reportable**, decided here rather than after seeing it.
- Disagreements go to hand adjudication with the reason recorded.
- Judge failures (timeout, refusal, wrong question answered) are re-run once with the identical
  prompt and then counted CANNOT_TELL, never silently dropped.

## Decision rule, fixed in advance

n=40 cannot resolve small differences. At n=40, 40/40 gives a Wilson 95% lower bound of 91.2% and
39/40 gives 87.1%, so comparing lower bounds would declare a difference from a single false
positive.

The test against the `no-timeout` arm (40/40) is Fisher's exact, which reaches p < 0.05 only at
**34/40 or worse**. Anything from 35/40 to 40/40 is **statistically indistinguishable** from
`no-timeout` at this n, and "indistinguishable" is a legitimate result to publish.

- **34/40 or worse:** file the `warn` to `info` demotion as an issue for 0.4.0, noting that the
  factual number alone does not settle it.
- **35/40 or better:** `warn` is affirmed and recorded in the README beside the `no-timeout`
  figure, scoped to this corpus slice and this rule.

The primary deliverable is not the rate. It is the **classification of false-positive mechanisms**
(higher-order wrapper, cross-module interceptor, misread config, other). n=40 is adequate for
finding mechanisms and inadequate for estimating a rate to within a few points.
