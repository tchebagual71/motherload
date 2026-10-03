import { defineConfig, type Plugin } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

const scope = process.env.HF_SCOPE ?? 'mvp';
if (!['m0', 'mvp', 'v1'].includes(scope)) throw new Error(`HF_SCOPE must be m0|mvp|v1, got ${scope}`);

/** Deploy base path (04 §9.4): './' locally (works under any path), '/motherload/' on GitHub Pages via CI. */
const base = process.env.HF_BASE ?? './';
const channel = process.env.VITE_CHANNEL ?? 'prod';

// Palette (03 §8.2, src/render/palette.ts): sky top as the theme, UI ink as the splash background.
const THEME_COLOR = '#f2b58e';
const BACKGROUND_COLOR = '#2b1e2f';

/** 04 §9.1: Pages sends no headers, so the CSP rides in a meta tag (MVP; M0 builds skip it). */
const CSP =
  "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; " +
  "style-src 'self' 'unsafe-inline'; connect-src 'self'";

/** Icons, apple-touch-icon and (MVP+) the CSP meta in index.html's head. */
function headTags(): Plugin {
  return {
    name: 'hf-head-tags',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.filename.endsWith('index.html')) return [];
        const tags = [
          { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: `${base}icon.svg` }, injectTo: 'head' as const },
          { tag: 'link', attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: `${base}apple-touch-icon.png` }, injectTo: 'head' as const },
        ];
        if (ctx.bundle && scope !== 'm0') {
          tags.unshift({ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP } as never, injectTo: 'head' as const });
        }
        return tags;
      },
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    preact(),
    headTags(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      // Registered from src/platform/pwa.ts after the first frame, never by an injected inline script.
      injectRegister: false,
      // The glob below already precaches every icon; listing them again would duplicate entries.
      includeManifestIcons: false,
      manifest: {
        id: 'holefactory',
        name: 'HoleFactory',
        short_name: 'HoleFactory',
        description: 'Dig deep, haul it up, build the factory. A cozy mining game for your phone.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: BACKGROUND_COLOR,
        theme_color: THEME_COLOR,
        scope: base,
        start_url: `${base}?src=pwa`,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cacheId: `hf-${channel}`,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Debug-only chunks and the jetsam probe stay network-only (04 §9.2).
        globIgnores: ['jetsam.html', '**/jetsamPage-*.js', 'bench.html', '**/benchPage-*.js', '**/DebugSheet-*.js', '**/testHook-*.js', '**/*harness*'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/jetsam\.html/, /bench\.html/, /harness\.html/],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __HF_SCOPE__: JSON.stringify(scope),
    __HF_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: { main: 'index.html', jetsamPage: 'jetsam.html', benchPage: 'bench.html' },
      output: {
        // The chunk the game shares with bench.html (three.js, the World sim and the renderer) would be named after
        // whichever module rolldown picks ('types-*.js'): call it 'core'. Only the file name changes, never what is
        // in a chunk or which chunks index.html preloads (scripts/check-size.mjs measures that set).
        chunkFileNames: (chunk) =>
          !chunk.isDynamicEntry && chunk.moduleIds.some((id) => /[\\/]node_modules[\\/]three[\\/]/.test(id))
            ? 'assets/core-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    // In-source tests (`if (import.meta.vitest)`) of the build scripts, which also run directly under Node.
    includeSource: ['scripts/check-size.mjs'],
    environment: 'node',
  },
});
