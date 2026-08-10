import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { lanRelay } from './scripts/vite-plugin-lan.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [lanRelay()],
  define: {
    // stamped into crash reports and telemetry so a bug report identifies a build
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,             // bind every interface: a LAN playtest is the default, not a flag
  },
  optimizeDeps: {
    // WASM-backed deps ship their own prebundled ESM; letting esbuild rewrite
    // them breaks their loaders
    exclude: ['@dimforge/rapier3d-compat', 'recast-navigation', '@recast-navigation/three'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    sourcemap: true,          // readable stack traces in shipped crash reports
    rollupOptions: {
      output: {
        // Keep the heavy engine deps in their own chunks so a gameplay-only
        // patch does not invalidate 2MB of unchanged WASM/vendor code.
        manualChunks: {
          three: ['three'],
          physics: ['@dimforge/rapier3d-compat'],
          nav: ['recast-navigation', '@recast-navigation/three'],
          postfx: ['postprocessing', 'three-mesh-bvh'],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
