export type ClientKind =
  | 'axios'
  | 'fetch'
  | 'request'
  | 'request-promise'
  | 'node-fetch'
  | 'nestjs-axios'
  | 'got'
  | 'node:http'

export type UrlExpr =
  | { kind: 'literal'; url: string; host: string }
  | { kind: 'config'; expr: string }
  | { kind: 'env'; expr: string }
  | { kind: 'variable'; expr: string }
  | { kind: 'unknown' }

export type CallOptions = {
  // `null` means a timeout is PROVEN ABSENT: a config argument was either genuinely missing or
  // was present and readable but provably lacked a `timeout`/`signal` key. `'unknown'` means
  // the opposite: a config argument exists at the expected index but wasn't statically
  // readable (an Identifier, a spread, a call expression, a conditional, ...), so nothing can
  // be said about it either way. Reproduced against twilio-node's `axios(config)` call
  // (src/base/RequestClient.ts:73): `config` is an identifier built elsewhere in the file and
  // DOES set a timeout, but the old code could only find an ObjectLiteralExpression, so it
  // returned `null` and reported a false no-timeout error on correctly-protected code.
  timeoutMs: number | 'instance-default' | 'unknown' | null
  // No 'manual': a `for`/`while` ancestor was once mapped to 'manual', but that heuristic
  // misclassified pagination loops as retry and silently suppressed 22 of 93 real findings in
  // one measured repo; it was deliberately killed (see options.ts for the full account).
  // Leaving 'manual' in this public type would just invite a contributor to re-implement it.
  // `'none'` means retry is PROVEN ABSENT, the same contract as `timeoutMs: null` above.
  // `'unknown'` means the config argument wasn't statically readable, same twilio-node repro.
  retry: 'none' | 'library' | 'unknown'
  validated: boolean | 'unknown'
}

/** A binding in a file that resolves to an HTTP client. */
export type ClientBinding = {
  name: string // local binding name
  kind: ClientKind
  origin: 'import' | 'derived' // derived = created by `<client>.create(...)`
  instanceTimeout: boolean // the create() call set a timeout
  instanceRetry: boolean // axios-retry / retry config bound to this instance
  exportedAs?: string // set when the binding is exported, for cross-module use
}

export type CallSite = {
  id: string // sha1(`${file}:${line}:${column}:${client}`).slice(0,12); identifies a PHYSICAL occurrence
  /** Position-independent identity, for baselines. See FP_VERSION in static/callsites.ts. */
  fingerprint: string
  file: string // REPO-RELATIVE, posix
  line: number // 1-based
  column: number // 1-based
  client: ClientKind
  method?: string
  url: UrlExpr
  options: CallOptions
  fileImports: string[] // module specifiers, so pure rules never touch the AST
}

export type Finding = {
  rule: string
  // 'info' never fails CI, not even under --fail-on warn. It is for findings that are worth
  // surfacing but are not defects on their own, such as a deliberately hardcoded vendor host.
  severity: 'error' | 'warn' | 'info'
  /** Baseline identity. Always paired with `rule`: one call site yields several findings. */
  fingerprint: string
  callSiteId: string
  file: string
  line: number
  message: string
  evidence: string
}

export type Workspace = {
  root: string // absolute, posix
  sourceFiles: string[] // absolute, posix
  packageDirs: string[] // absolute, posix
  dependencies: Record<string, string> // merged deps+devDeps across all package.json files; on key collision the last file walked wins (non-deterministic in a monorepo)
  /** Directories that could not be listed. Their files were never discovered, so any run with
   * a non-zero count saw less than the whole repo. */
  unreadableDirs: number
  nonShippingFilesExcluded: number // source files under examples/, benchmarks/, docs/ and the like that were left unaudited; 0 when includeNonShipping is set
}

export type ReportModel = {
  schemaVersion: 2
  filesAnalysed: number
  filesSkipped: number
  callSiteCount: number
  unresolvedHostCount: number
  nonShippingFilesExcluded: number
  /** Findings suppressed by a baseline. Reported so the suppression is never invisible. */
  baselineAccepted: number
  /** Baseline entries with no matching finding: fixed, moved, or renamed. */
  baselineResolved: number
  countsByRule: Record<string, number>
  findings: Finding[]
}

export type CorpusStats = {
  repos: number
  reposFailed: number
  callSites: number
  withTimeout: number
  withRetry: number
  withValidation: number
  // Call sites where the timeout or retry config could not be statically read at all
  // (options.timeoutMs === 'unknown' or options.retry === 'unknown'): neither protected nor
  // unprotected, just unreadable. Reported separately so the corpus dataset can state honestly
  // how many sites fall in this bucket instead of folding them into "protected" or "unprotected".
  unreadable: number
  byRule: Record<string, number>
}

export type CliIo = { write: (s: string) => void }
