# Supply chain, in full

What the published package can and cannot do, how that is enforced rather than asserted, and what
automated scanners flag on it.

apiwatch reads your source and writes a report. It makes no network calls, and that is enforced
rather than asserted: `test/no-network.test.ts` unpacks the published tarball and fails the build
if the bundle imports `http`, `https`, `net`, `tls`, `dgram`, `dns`, `child_process` or
`worker_threads`, bare or `node:`-prefixed. It also checks against an allowlist, so a module nobody
thought to forbid still has to be justified. Today the bundle imports `fs`, `fs/promises`, `path`,
`url`, `crypto` and `ts-morph`, and nothing else.

Every release is published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
so the registry carries a signed attestation naming the exact commit and workflow run that built
the tarball. `npm audit signatures` verifies it, and npm shows it on the package page.

Automated scanners flag a few things on this package. They are worth understanding rather than
working around:

- **URL strings.** The bundle contains no `http://` or `https://` string at all. What gets matched
  is `audit.md`, part of the local report path `.apiwatch/audit.md`, because `.md` is Moldova's
  country-code domain. `pkg.devDependencies` matches the same way, because `.dev` is a real domain
  too. This is a class of false match, not one token, so chasing individual strings is not a
  strategy, and deliberately breaking up a literal to evade a substring search is exactly what real
  evasion looks like. Renaming the report file was considered and rejected: the path is documented,
  and people gitignore and glob it.
- **Filesystem access.** True, and the point of the tool. It reads the repository you aim it at,
  and writes `.apiwatch/audit.md` only under `--write-report`.
- **Environment variable access.** Two matches. One is real and benign: `NO_COLOR`, so the output
  respects it. The other is the string `'process.env'` in the URL classifier, which is a pattern
  apiwatch searches for in *your* code to recognise a host built from an environment variable.
- **Debug or dynamic code execution.** Not from apiwatch: the bundle contains no `eval` and no
  `new Function`. This comes from ts-morph, the parser.
- **An unmaintained dependency.** `path-browserify@1.0.1`, published in 2020, reached via
  `@ts-morph/common`. It is a browser polyfill for Node's `path` and is not removable without
  dropping the analysis engine. The one runtime dependency apiwatch declares is `ts-morph`.

