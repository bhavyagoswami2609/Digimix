import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
