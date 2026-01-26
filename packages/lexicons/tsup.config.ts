import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  external: ['valibot'],
  // Bundle typed-lexicons into output (subpath imports don't resolve well as external)
  noExternal: ['@bigmistqke/typed-lexicons'],
})
