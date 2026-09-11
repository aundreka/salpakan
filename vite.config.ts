import { defineConfig } from 'vite';

export default defineConfig({
  base: '/salpakan/',
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
