import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  external: ['@bigmistqke/view.gl', '@eddy/media', '@eddy/utils', 'mediabunny'],
})
