import path from 'node:path'
import { app, utilityProcess } from 'electron'

const resourcesPath = process.env.CWS_PACKAGED_RESOURCES
const workerPath = resourcesPath
  ? path.join(resourcesPath, 'app.asar', 'dist', 'utility', 'application-audio-worker.js')
  : path.resolve('dist', 'utility', 'application-audio-worker.js')
const nativePath = resourcesPath
  ? path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'native', 'win32-x64', 'application_audio.node')
  : path.resolve('dist', 'native', 'win32-x64', 'application_audio.node')

void app.whenReady().then(() => {
  const childEnvironment = { ...process.env, CWS_APPLICATION_AUDIO_NATIVE: nativePath }
  delete childEnvironment.ELECTRON_RUN_AS_NODE
  const child = utilityProcess.fork(workerPath, [], {
    env: childEnvironment,
    serviceName: 'Application Audio Worker Verification',
    stdio: 'pipe',
  })

  let ready = false
  let finished = false
  const timeout = setTimeout(() => finish(new Error('utilityProcess handshake timed out')), 10_000)

  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  child.on('message', (message) => {
    if (!ready) {
      if (message?.type !== 'ready') return
      ready = true
      child.postMessage({ type: 'probe' })
      return
    }
    if (message?.type !== 'probe_result') return
    process.stdout.write(`${JSON.stringify(message)}\n`)
    child.postMessage({ type: 'shutdown' })
    finish()
  })
  child.on('error', (error) => finish(error))
  child.on('exit', (code) => {
    if (!finished) finish(new Error(`utilityProcess exited before handshake with code ${code}`))
  })

  function finish(error) {
    if (finished) return
    finished = true
    clearTimeout(timeout)
    if (error) {
      process.stderr.write(`${error.stack ?? error.message}\n`)
      child.kill()
      app.exit(1)
      return
    }
    app.exit(0)
  }
}).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  app.exit(1)
})
