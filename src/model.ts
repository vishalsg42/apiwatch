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
  timeoutMs: number | 'instance-default' | null
  // No 'manual': a `for`/`while` ancestor was once mapped to 'manual', but that heuristic
  // misclassified pagination loops as retry and silently suppressed 22 of 93 real findings in
  // one measured repo — it was deliberately killed (see options.ts for the full account).
  // Leaving 'manual' in this public type would just invite a contributor to re-implement it.
  retry: 'none' | 'library'
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
  id: string // sha1(`${file}:${line}:${column}:${client}`).slice(0,12)
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
  severity: 'error' | 'warn'
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
}

export type ReportModel = {
  schemaVersion: 1
  filesAnalysed: number
  filesSkipped: number
  callSiteCount: number
  unresolvedHostCount: number
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
  byRule: Record<string, number>
}

export type CliIo = { write: (s: string) => void }
