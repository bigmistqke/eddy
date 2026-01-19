import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  external: [
    '@atproto/api',
    '@atproto/oauth-client-browser',
    '@eddy/lexicons',
    '@eddy/utils',
    'valibot',
  ],
})
