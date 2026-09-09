import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: false,
    external: ['react', 'react-native', '@react-native-community/netinfo'],
  },
  {
    entry: { 'react/index': 'src/react/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    treeshake: true,
    splitting: false,
    external: ['react', 'react-native', '@react-native-community/netinfo'],
  },
  {
    entry: { 'dev/index': 'src/dev/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    treeshake: true,
    splitting: false,
    external: ['react', 'react-native', '@react-native-community/netinfo'],
  },
]);
