import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'schema/index': 'src/schema/index.ts',
    'react/index': 'src/react/index.ts',
    // `SeatMap`'s members — an entry of its own so `ichno/react` can re-export it as a namespace (see `external`).
    'react/seat-map': 'src/react/seat-map.ts',
    'editor/index': 'src/editor/index.ts',
  },
  format: 'esm',
  // Left as written in `src/react/index.ts`, so the build keeps `export * as SeatMap from './seat-map.js'` — a real
  // module namespace, whose unused members a consumer's bundler drops. Bundled, it would become one object holding
  // every part, and a read-only plan would ship the viewport with it.
  deps: { neverBundle: ['./seat-map.js'] },
  platform: 'neutral',
  dts: true,
  // One output file per source file — keeps each module's 'use client' directive and lets consumers
  // tree-shake per subpath.
  unbundle: true,
  inputOptions: {
    onLog(level, log, defaultHandler) {
      // Directives are preserved per file in unbundle mode; the bundling caveat does not apply.
      if (log.code === 'MODULE_LEVEL_DIRECTIVE') return
      defaultHandler(level, log)
    },
  },
  plugins: [
    // Ship React Compiler output for the client code — it is written without manual memoization, and consumers
    // do not compile node_modules. The server-safe parts (src/react outside client/) stay uncompiled: compiled
    // output calls a hook, which a Server Component cannot.
    babel({
      include: /\/src\/(editor|react\/client)\/.*\.tsx?$/,
      plugins: [['babel-plugin-react-compiler', { target: '19' }]],
    }),
  ],
})
