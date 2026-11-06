import { defineConfig } from 'tsdown';

export default defineConfig({
    // The reader, and the writer for tests (`@scm-js/replay/write`, Node only: it packs with node:zlib).
    entry: ['src/index.ts', 'src/write.ts'],
    format: ['esm', 'cjs'],
    // The reader uses no Node built-ins, so the same output runs in Node, browsers, Deno and Bun.
    platform: 'neutral',
    target: 'es2022',
    outDir: 'dist',
    // Pinned extensions, so `exports` cannot drift: .cjs = CommonJS, .mjs = ESM.
    outExtensions: ({ format }) =>
        format === 'cjs' ? { js: '.cjs', dts: '.d.cts' } : { js: '.mjs', dts: '.d.mts' },
    external: ['mopaq', /^node:/],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
});
