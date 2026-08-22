// tsup.config.ts: single entry; the preload entry belongs to the spike, not v0.1
import { defineConfig } from 'tsup'
export default defineConfig({
  entry: { cli: 'src/cli/index.ts' }, format: ['esm'], target: 'node22',
  clean: true, banner: { js: '' },   // shebang comes from the source file itself
})
