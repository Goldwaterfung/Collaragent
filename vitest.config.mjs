import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.spec.mjs',
      '**/lexical-playground/**'
    ]
  },
  resolve: {
    alias: {
      '@collaragent': resolve(import.meta.dirname, 'src/collaragent'),
      '@workspace': resolve(import.meta.dirname, 'src/workspace'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@main': resolve(import.meta.dirname, 'src/main'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer'),
    },
  },
});
