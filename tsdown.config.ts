import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'schema/index': 'src/schema/index.ts',
    'svg/index': 'src/svg/index.ts',
    'konva/index': 'src/konva/index.ts',
    'editor/index': 'src/editor/index.ts',
  },
  format: 'esm',
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
    // Ship React Compiler output for the client components — they are written without manual memoization,
    // and consumers do not compile node_modules. The server SVG has nothing to memoize.
    babel({
      include: /\/src\/(konva|editor)\/.*\.tsx?$/,
      plugins: [['babel-plugin-react-compiler', { target: '19' }]],
    }),
  ],
})
