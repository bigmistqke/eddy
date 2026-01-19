import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [dts({ tsconfigPath: './tsconfig.json' })],
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'ring-buffer-processor': resolve(__dirname, 'src/ring-buffer-processor.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        '@bigmistqke/rpc',
        '@bigmistqke/rpc/messenger',
        '@eddy/lexicons',
        '@eddy/media',
        '@eddy/utils',
        'mediabunny',
      ],
    },
  },
})
