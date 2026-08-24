# no-retry precision: results

Scored against `scoring.md`, which was written and committed before any judge ran. Nothing in the
scoring rules or the sampling frame changed after a verdict was seen.

## Headline

**39 of 40 fired findings confirmed. Precision 97.5%, Wilson 95% interval [87.1%, 99.6%].**

Both judges returned exactly 39/40, independently, and both identified the same single false
positive. Scoped to `no-retry`, on shipped code, across six repositories at pinned commits.

## Judge reliability

| | |
|---|---|
| qualification | Judge A 10/10, Judge B 10/10, on a set with 5 deliberate traps |
| raw agreement | 98.1% (53 of 54 cases) |
| Cohen's kappa | 0.899 |
| disagreements | 1, on a case that scores nothing |

Pre-registered condition was that poor agreement makes the number unreportable. Kappa 0.899 is
near-perfect agreement, so it is reportable.

The qualification set did its job in an unexpected direction: it exposed a defect in **apiwatch**,
not in a judge. See "What this found" below.

## The one false positive

`strapi/packages/core/admin/admin/src/utils/getFetchClient.ts:507`, a `fetch` PUT.

Hand-verified rather than taken on the judges' word. The call lives inside an `executeRequest`
closure which is handed to `withTokenRefresh(url, executeRequest)`; on a 401 that wrapper refreshes
the token and calls `executeRequest()` again, re-issuing the identical PUT.

**Mechanism class: higher-order wrapper.** This is precisely the class `options.ts:425-433` predicts
when it explains why the file-wide "imports a retry library" heuristic was deliberately deleted. The
prediction was right, and one in forty is the price.

Worth recording honestly: the wrapper re-attempts only on a 401, not on a network error or a 5xx.
So the finding is not entirely without merit. The question judges were asked was whether anything
re-issues the request on failure, and the answer is yes, so it is scored as a false positive.

## Controls

Both `SILENT_LIBRARY` controls (`got` calls in Ghost) were called `HAS_RETRY` by both judges:
**correct silence, zero false suppressions observed.** With n=2 this bounds nothing, and only 2
existed in the entire 326-site pool. That is a limitation of the corpus, not a design choice.

## What the abstentions cost

Of 12 sampled `SILENT_UNKNOWN` cases, judges found that **9 to 10 genuinely have no retry**. So
roughly 75-83% of abstentions are hiding a real finding. `no-retry` buys its precision with recall,
and this is the size of that bill. Extrapolated across the pool's 43 abstentions that is around 32
to 36 real findings not reported.

## What the sample actually measures

| | |
|---|---|
| pool | 326 call sites, 165 fired |
| sampled | 40 fired, across **40 distinct files**, all 6 repos |
| fired by method | `undefined` 104 (63%), `get` 42, `put` 9, `delete` 6, `head` 4 |
| fired by client | `fetch` 151, `axios` 14 |

**63% of fired cases have no readable method.** `IDEMPOTENT` contains `undefined` by design, because
a call with no readable method defaults to GET. So this number is substantially a statement about
bare `fetch(url)`, and should never be quoted without that qualifier.

Zero clustering: 40 cases fell in 40 distinct files, so the naive Wilson interval is not inflated by
repeated near-identical call sites, which was the main risk at this n.

## Decision, applied as pre-registered

The threshold was fixed in advance: Fisher's exact against the `no-timeout` 40/40 arm reaches
p < 0.05 only at 34/40 or worse; 35/40 to 40/40 is statistically indistinguishable at this n.

**39/40. Indistinguishable from `no-timeout`. `warn` is affirmed, and no demotion issue is filed.**

This does not mean `no-retry` is as good a rule as `no-timeout`; it means n=40 cannot tell them
apart, which was predicted before the data existed.

## What this found

The audit's real product, as planned, was mechanisms rather than a rate:

1. **A genuine defect in apiwatch**, found by the qualification set before any real case was judged:
   a `retry` key on a plain axios call is read as proof of retry, but `AxiosRequestConfig` has no
   such option, so the key is inert and a real finding is silently suppressed. Filed as issue #5.
   It changes finding counts, so it ships in 0.3.7, not 0.3.6.
2. **The higher-order wrapper is the false-positive mechanism**, confirmed at roughly 1 in 40.
3. **Cross-module interceptors did not produce a single false positive.** Judge B explicitly checked
   nocodb for `axios-retry` and global interceptors and found none, and correctly declined a
   proximity trap in medusa where `axiosRetry` was bound to an instance that the flagged call does
   not use. The citation-chain requirement is what made that check visible.
