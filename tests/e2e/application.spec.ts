import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('首次启动显示可用的服务器配置窗口', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'cws-electron-e2e-'))
  const application = await launch(userData)
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: '连接服务器' })).toBeVisible()
    await expect(page.getByLabel('服务器地址')).toBeFocused()

    await page.getByLabel('服务器地址').fill('https://voice.example.com/subpath')
    await page.getByRole('button', { name: '验证并进入' }).click()
    await expect(page.getByRole('status')).toContainText('服务器必须部署在 Origin 根路径')

    await page.getByLabel('服务器地址').fill('http://127.0.0.1:1')
    await page.getByRole('button', { name: '验证并进入' }).click()
    await expect(page.getByRole('status')).toContainText('无法连接服务器')
    await expect(page.getByRole('button', { name: '仍然进入' })).toBeVisible()

    await page.screenshot({ path: 'test-results/setup-window.png' })
  } finally {
    await application.close()
  }
})

test('当前 HTTP Origin 是安全上下文并自动取得麦克风', async () => {
  const server = await startMediaServer()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind to TCP')
  const serverUrl = `http://127.0.0.1:${address.port}`
  const userData = await mkdtemp(path.join(tmpdir(), 'cws-electron-e2e-'))
  await mkdir(userData, { recursive: true })
  await writeFile(path.join(userData, 'config.json'), JSON.stringify({
    version: 1,
    serverUrl,
    window: { width: 1280, height: 800, x: null, y: null, maximized: false },
  }))

  const application = await launch(userData, { CWS_E2E_FAKE_MEDIA: '1' })
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: 'HTTP voice test' })).toBeVisible()
    await page.getByRole('button', { name: 'Open microphone' }).click()
    await expect(page.getByTestId('result')).toHaveText('secure:true;audio:true')
  } finally {
    await application.close()
    await closeServer(server)
  }
})

async function launch(userData: string, extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  return electron.launch({
    args: [root],
    env: {
      ...environment,
      CWS_USER_DATA_DIR: userData,
      ...extraEnv,
    },
  })
}

async function startMediaServer(): Promise<Server> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Permissions-Policy': 'microphone=(self)',
    })
    response.end(`<!doctype html>
      <html lang="en">
        <body>
          <h1>HTTP voice test</h1>
          <button id="open">Open microphone</button>
          <output data-testid="result"></output>
          <script>
            document.querySelector('#open').addEventListener('click', async () => {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                document.querySelector('output').textContent = 'secure:' + window.isSecureContext + ';audio:' + (stream.getAudioTracks().length > 0)
                stream.getTracks().forEach((track) => track.stop())
              } catch (error) {
                document.querySelector('output').textContent = error.name + ':' + error.message
              }
            })
          </script>
        </body>
      </html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
