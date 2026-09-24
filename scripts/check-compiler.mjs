// Fails when React Compiler bails out of any client component or hook.
// A bailout is silent at build time: the component ships uncompiled and re-renders on every parent render. The build runs the same compiler (tsdown.config.ts), so this checks exactly what ships.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformSync } from '@babel/core'

const DIRS = ['src/editor'] // keep in step with the babel `include` in tsdown.config.ts

const failures = []
let compiled = 0
for (const dir of DIRS) {
  for (const name of readdirSync(dir)) {
    if (!/\.tsx?$/.test(name) || name.includes('.test.')) continue
    const file = join(dir, name)
    transformSync(readFileSync(file, 'utf8'), {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      plugins: [
        [
          'babel-plugin-react-compiler',
          {
            target: '19',
            logger: {
              logEvent(_file, event) {
                if (event.kind === 'CompileSuccess') compiled++
                if (event.kind === 'CompileError' || event.kind === 'PipelineError') {
                  const detail = event.detail?.reason ?? event.detail?.options?.reason ?? event.data ?? event.detail
                  failures.push(`${file}${event.fnName ? ` (${event.fnName})` : ''}: ${String(detail)}`)
                }
              },
            },
          },
        ],
      ],
    })
  }
}

if (failures.length > 0) {
  console.error(
    `React Compiler bailed out of ${failures.length} function(s):\n${failures.map((f) => `  - ${f}`).join('\n')}`,
  )
  process.exit(1)
}
console.log(`React Compiler: ${compiled} components/hooks compiled, no bailouts.`)
