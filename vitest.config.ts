import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/types.ts',
        'src/**/*.types.ts',
        'src/index.ts',
        'src/react/**',
        'src/providers/AIProvider.ts',
      ],
      // Coverage thresholds deferred — enable when ready for CI gates.
      // thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
