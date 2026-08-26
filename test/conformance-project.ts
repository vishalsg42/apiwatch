import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from 'ts-morph'

/**
 * A real type-resolving project, for the conformance checks that read what the client libraries
 * actually declare. Nothing like the project apiwatch audits with: that one runs `noResolve` and
 * `noLib`, which is right for reading a stranger's repository quickly and useless for asking a
 * library what it exports.
 */
export const conformanceProject = () =>
  new Project({
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.NodeNext,
      moduleResolution: ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      types: ['node'],
      lib: ['lib.esnext.full.d.ts'],
    },
  })
