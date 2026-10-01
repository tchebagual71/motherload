import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

const scope = process.env.HF_SCOPE ?? 'mvp';
if (!['m0', 'mvp', 'v1'].includes(scope)) throw new Error(`HF_SCOPE must be m0|mvp|v1, got ${scope}`);

export default defineConfig({
  base: process.env.HF_BASE ?? './',
  plugins: [preact()],
  define: {
    __HF_SCOPE__: JSON.stringify(scope),
    __HF_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
