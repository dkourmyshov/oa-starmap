import { defineConfig } from 'vite';

/**
 * Where the site is served from.
 *
 * GitHub Pages puts a project site under /<repo>/, so every asset URL needs
 * that prefix — and the data files are fetched by name from the manifest, not
 * imported, so Vite cannot rewrite them and a wrong base shows an empty sky
 * with a console full of 404s. Taken from the environment so a local `npm run
 * build` still produces a site that works when opened from its own directory.
 */
const base = process.env.PAGES_BASE ?? '/';

export default defineConfig({
  base,
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
