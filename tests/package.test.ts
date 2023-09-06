import execa from 'execa'
import path from 'path'

function runFile(file: string) {
  return execa('node', [path.join(__dirname, file)])
}

test('common js module can be loaded', async () => {
  await runFile('cjs.js')
})

test('ES module can be loaded', async () => {
  await runFile('esm.mjs')
})
