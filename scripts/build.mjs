import { cp, mkdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const typescriptCli = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

await rm(dist, { recursive: true, force: true })
await run(process.execPath, [typescriptCli, '-p', 'tsconfig.json'])
await mkdir(path.join(dist, 'renderer'), { recursive: true })
await cp(path.join(root, 'src', 'renderer'), path.join(dist, 'renderer'), { recursive: true })

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
    })
  })
}
