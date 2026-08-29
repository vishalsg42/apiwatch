# Decision register: does apiwatch continue

Written 2026-08-29, before the first upstream PR was opened. The commit timestamp is the
pre-registration. Nothing below may be edited after the fact except the Outcomes section, which is
append-only.

## Why this file exists

This project pre-registered its scoring rules, its judge qualification traps, and its abort
condition before running a 40-finding precision audit
(`docs/audits/no-retry-precision/scoring.md`). The product decision had no threshold at all. That
asymmetry is the thing this file fixes: a decision about where the next month of work goes deserves
at least the rigor applied to a 40-case sample.

## The question being tested

Not "is apiwatch correct". That is measured: `no-timeout` 40 of 40, `no-retry` 39 of 40, both
against blind judges at pinned commits.

The untested question is upstream of that: **is a missing HTTP timeout a defect that a maintainer
will accept a diff for?** If the answer is no, then no packaging, no ESLint plugin, and no amount of
further precision work matters. If the answer is yes, the form factor question becomes worth asking
with real signal behind it.

## Threshold

**By 2026-10-15, at least 2 of the following must be true:**

1. One upstream pull request, opened by me and citing a finding apiwatch produced, is **merged**.
2. One issue is opened on this repository by somebody other than me, and it is not a typo fix, a
   dependency bump, or an automated report.
3. One repository other than mine uses apiwatch, discoverable through GitHub code search for
   `apiwatch` in a workflow file, a `package.json`, or an `.apiwatch-baseline.json`.

**Fewer than 2 and apiwatch is archived** as a completed experiment: a README header stating so,
`docs/audits/` kept prominent, and a section showing how to get most of the value from stock ESLint
configuration. The code stays published and working at 0.5.0. Archiving means no further feature
work, not deletion.

## What explicitly does not count

These are unreadable for this project and must not be used to argue either way:

- **npm download counts.** 2,835 in the 30 days to 2026-08-27, concentrated in 6 days beginning the
  day of first publish, peaking at 1,604 in one day. That is registry mirrors, security scanners,
  this repository's own CI, and local installs made while testing. There is no way to separate a
  real install from a crawler here.
- **GitHub stars.** Trivially influenced by posting, and they measure attention rather than use.
- **Any traffic originating from this account**, including CI runs and differential measurement.
- **A polite reply on a PR.** Only a merge counts for criterion 1. "Thanks, we will look at it" is
  not a result.

## What a negative result looks like, stated in advance

If maintainers close the PRs with reasoning along the lines of "we know, and we do not consider it
worth changing", that is a **successful experiment with a negative answer**, not a failure. It is
the single most valuable sentence this exercise can produce, because it invalidates the premise
cheaply and in public. Record the reasoning verbatim below.

The failure mode to guard against is not a negative result. It is moving the bar in October.

## Outcomes

Append only. Record every PR the moment it is opened, and its resolution whenever it lands,
including maintainer reasoning quoted directly.

| date | event | detail |
|---|---|---|
| 2026-08-29 | register committed | threshold set, before any PR opened |
| 2026-08-29 | PR opened | [novuhq/novu#12489](https://github.com/novuhq/novu/pull/12489) `fix(api)`: explicit timeout on the partner-integrations HttpModule. Resolves 6 unbounded Vercel API calls. Verified before and after with 0.5.0 |
| 2026-08-29 | PR opened | [ufosc/Jukebox-Server#149](https://github.com/ufosc/Jukebox-Server/pull/149) `fix(spotify)`: explicit timeout on the Spotify HttpModule. Resolves 3 unbounded calls, `no-timeout` 3 to 0 |
| 2026-08-29 | PR prepared, not opened | novu worker telemetry. Branch `vishalsg42:fix/telemetry-http-timeout` is pushed and one commit ahead of `next`. GitHub refused `CreatePullRequest` with a permissions error on three attempts across a 3 minute backoff, while `rate_limit` reported 5000 of 5000 remaining on both core and graphql. Reads as an abuse heuristic on a second PR from a newly created fork rather than a quota. Not retried further to avoid compounding it |
| 2026-08-29 | tool defect observed | Verifying the novu patch, apiwatch reported 7 findings resolved by a change that resolved 6. The seventh was silenced by the repository-wide NestJS abstain, not fixed. Recorded in `docs/limitations.md` and corrected before it reached a PR body |

## Decision

To be completed on 2026-10-15, against the threshold above and nothing else.
