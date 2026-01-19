import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const externalDeps = [
  '@bigmistqke/rpc',
  '@bigmistqke/rpc/messenger',
  '@eddy/lexicons',
  '@eddy/media',
  '@eddy/utils',
  'mediabunny',
]

export default defineConfig({
  plugins: [dts({ tsconfigPath: './tsconfig.json' })],
  build: {
    sourcemap: true,
    minify: false,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'ring-buffer-processor': resolve(__dirname, 'src/ring-buffer-processor.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // Use function to NOT externalize deps for the worklet entry
      external: (id, importer) => {
        // Bundle all deps into ring-buffer-processor (worklet needs to be self-contained)
        if (importer?.includes('ring-buffer-processor')) {
          return false
        }
        // Externalize deps for main entry
        return externalDeps.some(dep => id === dep || id.startsWith(dep + '/'))
      },
    },
  },
  worker: {
    format: 'iife',
  },
})
