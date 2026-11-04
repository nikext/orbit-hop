import { defineConfig } from 'vitest/config';

// Playables bundles must use relative paths only, so `base` is './'.
// No module-preload polyfill: it adds code the game doesn't need.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    modulePreload: { polyfill: false },
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/game-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: { host: '127.0.0.1' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
