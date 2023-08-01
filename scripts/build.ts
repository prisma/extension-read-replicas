import fs from 'fs/promises'
import execa from 'execa'
import path from 'path'
import esbuild from 'esbuild'
import { nodeExternalsPlugin } from 'esbuild-node-externals'

const root = path.resolve(__dirname, '..')

async function main() {
  await fs.rm(path.join(root, 'dist'), { recursive: true, force: true })
  await fs.rm(path.join(root, 'types'), { recursive: true, force: true })
  await build('cjs')
  await build('esm')
}

async function build(format: 'cjs' | 'esm') {
  const ext = format === 'cjs' ? 'js' : 'mjs'
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    outfile: `dist/${format}/index.${ext}`,
    bundle: true,
    platform: 'neutral',
    format,
    plugins: [nodeExternalsPlugin()],
  })

  await execa('pnpm', ['tsc', '-p', `tsconfig.${format}.json`], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  })
}

main()
