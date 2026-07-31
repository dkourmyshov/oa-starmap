import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // The dataset is ~4 MB of binaries in public/data; served straight from disk.
    open: false,
  },
  build: {
    target: 'es2022',
    // Star binaries must stay as separate files rather than being inlined.
    assetsInlineLimit: 0,
  },
});
