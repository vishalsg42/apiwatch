// Single entry, ESM, Node 22. Replaces tsup, which carries an unmaintained notice upstream.
// outExtensions pins `.js`: tsdown defaults to `cli.mjs`, and package.json's `bin` and `exports`
// both point at dist/cli.js, so the default would ship a binary that resolves to nothing.
import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  fixedExtension: false,
  outExtensions: () => ({ js: '.js' }),
})
