import { cp, mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.platform !== 'win32') {
  console.log('Skipping Windows application audio native build')
  process.exit(0)
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const electronVersion = packageJson.devDependencies.electron
const nodeGyp = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
const nativeRoot = path.join(root, 'native', 'application-audio')

await run(process.execPath, [
  nodeGyp,
  'rebuild',
  '--runtime=electron',
  `--target=${electronVersion}`,
  '--dist-url=https://electronjs.org/headers',
  '--arch=x64',
], nativeRoot)

const destination = path.join(root, 'dist', 'native', 'win32-x64')
await mkdir(destination, { recursive: true })
await cp(
  path.join(nativeRoot, 'build', 'Release', 'application_audio.node'),
  path.join(destination, 'application_audio.node'),
)

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
    })
  })
}

