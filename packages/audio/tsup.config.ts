import { defineConfig } from 'tsup'

export default defineConfig([
  // Main entry - externalize deps
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: [
      '@bigmistqke/rpc',
      '@bigmistqke/rpc/messenger',
      '@eddy/lexicons',
      '@eddy/media',
      '@eddy/utils',
      'mediabunny',
    ],
  },
  // Worklet entry - bundle all deps (self-contained for AudioWorklet)
  {
    entry: ['src/ring-buffer-processor.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    // Force bundle all deps - worklet must be self-contained
    noExternal: [/.*/],
  },
])
