# Security policy

## Supported versions

Only the latest published version receives fixes. apiwatch is pre-1.0 and moves quickly; there
are no long-lived release branches.

| version | supported |
|---|---|
| latest `0.3.x` | yes |
| anything older | no, upgrade first |

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/vishalsg42/apiwatch/security/advisories/new).
Please do not open a public issue for a security report.

Include what you have: a reproduction, the apiwatch version (`npx apiwatch --version`), and the
Node version. A minimal repository that triggers it is the single most useful thing you can
provide.

I will acknowledge within a week. If a report is valid I will fix it, publish a release, and
credit you in the advisory unless you prefer otherwise.

## Threat model

Knowing what apiwatch does and does not do should tell you whether something is a vulnerability
or expected behaviour.

**apiwatch never executes the code it analyses.** It parses source with the TypeScript compiler
API and inspects the syntax tree. It does not run your code, import your modules, resolve
`node_modules`, load `@types`, or evaluate any expression. That removes the largest class of
risk a code-analysis tool normally carries.

**apiwatch makes no network requests.** It reads files under the audited root and writes nothing
unless asked: `--write-report` writes `.apiwatch/audit.md`, and the `baseline` commands write the
baseline file. A default `audit` run only reads.

Things that would be genuine vulnerabilities:

- a crafted source file causing apiwatch to execute code, read outside the audited root, or write
  outside the paths named above
- a crafted baseline file causing arbitrary writes or code execution when read
- a supply-chain problem in the published package or its one runtime dependency, `ts-morph`

Things that are **not** vulnerabilities, and are better raised as ordinary issues:

- a false positive or false negative in a rule. These are correctness bugs and several are
  already documented in the README's Limitations section
- apiwatch failing to detect an unprotected HTTP call. The tool is deliberately conservative and
  stays silent when it cannot prove a finding
- a finding on a file you consider out of scope. See `--include-non-shipping`

## Provenance

Releases are published from GitHub Actions with npm provenance attestations. You can verify a
published version with:

```
npm view apiwatch dist.attestations
```
