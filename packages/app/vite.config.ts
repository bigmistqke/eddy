import { resolve } from 'path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  define: {
    __ENABLE_PERF__: process.env.NODE_ENV !== 'production',
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
  server: {
    // AT Protocol OAuth requires accessing via 127.0.0.1 for loopback clients
    host: '127.0.0.1',
    headers: {
      // Required for SharedArrayBuffer (used by audio ring buffer)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
