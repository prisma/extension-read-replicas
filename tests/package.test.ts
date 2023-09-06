import execa from 'execa'
import path from 'path'
import fs from 'fs/promises'
import pkg from '../package.json'

function runFile(file: string) {
  return execa('node', [path.join(__dirname, file)])
}

test('common js module can be loaded', async () => {
  await runFile('cjs.js')
})

test('ES module can be loaded', async () => {
  await runFile('esm.mjs')
})

async function assertFileExists(filePath: string) {
  const stat = await fs.stat(filePath)
  expect(stat.isFile()).toBe(true)
}

test('entires in package json point to existing files', async () => {
  await assertFileExists(pkg.main)
  await assertFileExists(pkg.module)
  await assertFileExists(pkg.types)
  for (const exportDefinition of Object.values(pkg.exports)) {
    for (const entry of Object.values(exportDefinition)) {
      for (const filePath of Object.values(entry)) {
        await assertFileExists(filePath)
      }
    }
  }
})
