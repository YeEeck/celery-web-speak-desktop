import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('首次启动显示可用的服务器配置窗口', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'cws-electron-e2e-'))
  const application = await launch(userData)
  try {
    const page = await localWindow(application, 'setup.html')
    await expect(page.getByRole('heading', { name: '连接服务器' })).toBeVisible()
    await expect(page.getByLabel('服务器地址')).toBeFocused()
    await expect(page.getByRole('button', { name: '最小化窗口' })).toBeVisible()
    await expect(page.getByRole('button', { name: '最大化窗口' })).toBeVisible()
    await expect(page.getByRole('button', { name: '关闭窗口' })).toBeVisible()
    const controlIconSizes = await page.locator('.window-titlebar-controls .window-control-icon').evaluateAll((icons) => (
      icons.map((icon) => ({ width: icon.clientWidth, height: icon.clientHeight }))
    ))
    expect(controlIconSizes).toEqual([
      { width: 10, height: 10 },
      { width: 10, height: 10 },
      { width: 10, height: 10 },
    ])
    expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull()
    await expect(page.getByText('使用完整的 HTTP 或 HTTPS 地址')).toHaveCount(0)
    await expect(page.getByText('桌面客户端将忽略服务器证书错误')).toHaveCount(0)

    const inputAlignment = await page.getByLabel('服务器地址').evaluate((element) => {
      const inputBounds = element.getBoundingClientRect()
      const wrapperBounds = element.parentElement?.getBoundingClientRect()
      return {
        inputCenter: inputBounds.top + inputBounds.height / 2,
        wrapperCenter: wrapperBounds ? wrapperBounds.top + wrapperBounds.height / 2 : 0,
      }
    })
    expect(Math.abs(inputAlignment.inputCenter - inputAlignment.wrapperCenter)).toBeLessThanOrEqual(1)

    await expect(page.locator('.window-titlebar')).toHaveCSS('height', '32px')
    expect(await page.evaluate(() => window.innerHeight)).toBe(420)

    await page.getByRole('button', { name: '打开应用菜单' }).click()
    const menuPage = await localWindow(application, 'menu.html')
    await expect(menuPage.getByRole('menuitem', { name: '关于 Celery Web Speak' })).toBeVisible()
    await expect(menuPage.getByRole('menuitem', { name: '切换服务器' })).toHaveCount(0)
    await expect(menuPage.locator('body')).toHaveCSS('background-color', 'rgb(17, 18, 20)')
    expect(await menuPage.locator('.menu-item').first().evaluate((element) => element === document.activeElement)).toBe(false)
    await expect(menuPage.locator('.menu-item').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

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
    const page = await localWindow(application, 'shell.html')
    await expect(page.getByRole('button', { name: '打开应用菜单' })).toBeVisible()
    const updateButton = page.getByRole('button', { name: '新版本' })
    await expect(updateButton).toBeHidden()

    await application.evaluate(({ dialog, net }) => {
      const updateTestState = { dialogTitles: [] as string[], fetchCalls: 0 }
      Object.assign(globalThis, { updateTestState })
      net.fetch = async () => {
        updateTestState.fetchCalls += 1
        return new Response(JSON.stringify({
          tag_name: 'v9.9.9',
          html_url: 'https://github.com/YeEeck/celery-web-speak-desktop/releases/tag/v9.9.9',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      dialog.showMessageBox = async (...args) => {
        const options = args.length === 2 ? args[1] : args[0]
        updateTestState.dialogTitles.push(options?.title ?? '')
        return { response: 2, checkboxChecked: false }
      }
    })
    expect(await page.evaluate(() => typeof (window as unknown as {
      desktopApplicationAudio?: unknown
    }).desktopApplicationAudio)).toBe('undefined')

    await page.getByRole('button', { name: '打开应用菜单' }).click()
    const menuPage = await localWindow(application, 'menu.html')
    await expect(menuPage.getByRole('menuitem', { name: '切换服务器' })).toBeVisible()
    await expect(menuPage.getByRole('menuitem', { name: '重新加载 Ctrl+R' })).toBeVisible()
    await expect(menuPage.locator('body')).toHaveCSS('background-color', 'rgb(17, 18, 20)')
    expect(await menuPage.locator('.menu-item').first().evaluate((element) => element === document.activeElement)).toBe(false)
    await expect(menuPage.locator('.menu-item').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await menuPage.getByRole('menuitem', { name: '检查更新', exact: true }).click()

    await expect(updateButton).toBeVisible()
    await expect(updateButton).toHaveAttribute('title', 'v9.9.9 可用')
    await expect.poll(() => application.evaluate(() => (
      (globalThis as unknown as { updateTestState: { dialogTitles: string[] } }).updateTestState.dialogTitles
    ))).toEqual(['发现新版本'])

    await updateButton.click()
    await expect.poll(() => application.evaluate(() => (
      (globalThis as unknown as { updateTestState: { dialogTitles: string[]; fetchCalls: number } }).updateTestState
    ))).toEqual({ dialogTitles: ['发现新版本', '发现新版本'], fetchCalls: 1 })

    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = (...args) => {
        const options = args.length === 2 ? args[1] : args[0]
        const state = (globalThis as unknown as {
          updateTestState: { dialogTitles: string[] }
        }).updateTestState
        state.dialogTitles.push(options?.title ?? '')
        return new Promise(() => undefined)
      }
    })
    await updateButton.dblclick()
    await expect.poll(() => application.evaluate(() => (
      (globalThis as unknown as { updateTestState: { dialogTitles: string[]; fetchCalls: number } }).updateTestState
    ))).toEqual({ dialogTitles: ['发现新版本', '发现新版本', '发现新版本'], fetchCalls: 1 })
    expect(await application.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.isMaximized()
    ))).toBe(false)

    await expect.poll(() => remoteText(application, serverUrl, 'h1')).toBe('HTTP voice test')
    const remoteState = await application.evaluate(async ({ webContents }, targetUrl) => {
      const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(targetUrl) && !contents.getURL().endsWith('/overlay.html'))
      if (!remote) throw new Error('remote WebContentsView was not found')
      const windowBridge = await remote.executeJavaScript('typeof window.desktopWindow')
      const applicationAudio = await remote.executeJavaScript(`(async () => {
        const hello = await window.desktopApplicationAudio.hello({ minProtocol: 1, maxProtocol: 1 })
        const snapshot = await window.desktopApplicationAudio.getSnapshot()
        return { hello, snapshot }
      })()`)
      const childBridge = await remote.executeJavaScript(`(() => {
        const frame = document.querySelector('iframe')
        return frame?.contentWindow ? typeof frame.contentWindow.desktopApplicationAudio : null
      })()`)
      const microphone = await remote.executeJavaScript(`(() => {
        const output = document.querySelector('[data-testid="result"]')
        document.querySelector('#open').click()
        return new Promise((resolve, reject) => {
          if (output.textContent) return resolve(output.textContent)
          const observer = new MutationObserver(() => {
            if (!output.textContent) return
            observer.disconnect()
            resolve(output.textContent)
          })
          observer.observe(output, { childList: true, characterData: true, subtree: true })
          setTimeout(() => {
            observer.disconnect()
            reject(new Error('microphone result timed out'))
          }, 8000)
        })
      })()`)
      return { windowBridge, applicationAudio, childBridge, microphone }
    }, serverUrl)
    expect(remoteState.windowBridge).toBe('undefined')
    expect(remoteState.applicationAudio.hello.protocol).toBe(1)
    if (process.platform === 'linux') {
      expect(remoteState.applicationAudio.hello.capabilities).toEqual([])
      expect(remoteState.applicationAudio.snapshot).toMatchObject({
        sessionId: null,
        state: 'idle',
        supported: false,
        error: { code: 'unsupported_platform' },
      })
    }
    expect(remoteState.childBridge).toBe('undefined')
    expect(remoteState.microphone).toBe('secure:true;audio:true')
  } finally {
    await application.close()
    await closeServer(server)
  }
})

test('语音浮层：握手、启停、状态渲染与销毁', async () => {
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

  const application = await launch(userData)
  try {
    const page = await localWindow(application, 'shell.html')
    await expect(page.getByRole('button', { name: '打开应用菜单' })).toBeVisible()
    await expect.poll(() => remoteText(application, serverUrl, 'h1')).toBe('HTTP voice test')

    const overlayBridgeState = await application.evaluate(async ({ webContents }, targetUrl) => {
      const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(targetUrl) && !contents.getURL().endsWith('/overlay.html'))
      if (!remote) throw new Error('remote WebContentsView was not found')
      const topBridge = await remote.executeJavaScript(`(async () => {
        const hello = await window.desktopVoiceOverlay.hello({ minProtocol: 1, maxProtocol: 2 })
        await window.desktopVoiceOverlay.setEnabled(true)
        window.desktopVoiceOverlay.pushState({
          channel: { name: '大厅' },
          participants: [
            { identity: 'u1', name: '张三', avatarUrl: null, isLocal: true, speaking: true, microphoneMuted: false, deafened: false },
            { identity: 'u2', name: '李四', avatarUrl: null, isLocal: false, speaking: false, microphoneMuted: true, deafened: false },
            { identity: 'u3', name: '王五', avatarUrl: null, isLocal: false, speaking: false, microphoneMuted: false, deafened: true },
          ],
        })
        return hello
      })()`)
      const childBridge = await remote.executeJavaScript(`(() => {
        const frame = document.querySelector('iframe')
        return frame?.contentWindow ? typeof frame.contentWindow.desktopVoiceOverlay : null
      })()`)
      return { topBridge, childBridge }
    }, serverUrl)
    expect(overlayBridgeState.topBridge).toEqual({ protocol: 2, capabilities: ['voice_overlay'] })
    expect(overlayBridgeState.childBridge).toBe('undefined')
    const overlayPage = await overlayWindow(application, serverUrl)
    await expect(overlayPage.locator('.participant')).toHaveCount(3)
    await expect(overlayPage.getByText('张三（你）')).toBeVisible()
    await expect(overlayPage.getByText('李四')).toBeVisible()
    await expect(overlayPage.getByText('王五')).toBeVisible()
    await expect(overlayPage.locator('.participant.speaking', { hasText: '张三' })).toHaveCount(1)
    await expect(overlayPage.locator('.participant:has-text("李四") .participant-icon:not(.deafened)')).toBeVisible()
    await expect(overlayPage.locator('.participant:has-text("王五") .participant-icon.deafened')).toBeVisible()
    await expect(overlayPage.locator('.participant.speaking', { hasText: '张三' })).toHaveCSS('opacity', '0.8')
    await expect(overlayPage.locator('.participant:has-text("李四")')).toHaveCSS('opacity', '0.4')
    await expect(overlayPage.locator('.participant').first()).toHaveCSS('background-color', 'rgba(17, 18, 20, 0.82)')

    const overlayWindowState = await application.evaluate(({ BrowserWindow, screen }) => {
      const overlay = BrowserWindow.getAllWindows().find((window) => (
        window.webContents.getURL().endsWith('/overlay.html')
      ))
      if (!overlay) return null
      const bounds = overlay.getBounds()
      const workArea = screen.getPrimaryDisplay().workArea
      return {
        alwaysOnTop: overlay.isAlwaysOnTop(),
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        expected: {
          x: workArea.x + Math.round(workArea.width * 0.09) - 140,
          y: workArea.y + Math.round(workArea.height * 0.5) - 54,
        },
      }
    })
    expect(overlayWindowState).toEqual({
      alwaysOnTop: true,
      bounds: { x: expect.any(Number), y: expect.any(Number), width: 280, height: 108 },
      expected: { x: expect.any(Number), y: expect.any(Number) },
    })
    expect(overlayWindowState.bounds.x).toBe(overlayWindowState.expected.x)
    expect(overlayWindowState.bounds.y).toBe(overlayWindowState.expected.y)

    await expect(overlayPage.locator('#config-output')).toContainText('100')

    await application.evaluate(({ webContents }, targetUrl) => {
      const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(targetUrl) && !contents.getURL().endsWith('/overlay.html'))
      if (!remote) throw new Error('remote WebContentsView was not found')
      return remote.executeJavaScript(`window.desktopVoiceOverlay.setConfig({
        scalePercent: 150,
        positionXPercent: 50,
        positionYPercent: 25,
        speakingOpacityPercent: 90,
        silentOpacityPercent: 20,
      })`)
    }, serverUrl)
    const overlayScaledState = await application.evaluate(({ BrowserWindow, screen }) => {
      const overlay = BrowserWindow.getAllWindows().find((window) => (
        window.webContents.getURL().endsWith('/overlay.html')
      ))
      if (!overlay) return null
      const bounds = overlay.getBounds()
      const workArea = screen.getPrimaryDisplay().workArea
      return {
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        expected: {
          x: workArea.x + Math.round(workArea.width * 0.5) - 210,
          y: workArea.y + Math.round(workArea.height * 0.25) - 81,
        },
      }
    })
    expect(overlayScaledState).toEqual({
      bounds: { x: expect.any(Number), y: expect.any(Number), width: 420, height: 162 },
      expected: { x: expect.any(Number), y: expect.any(Number) },
    })
    expect(overlayScaledState.bounds.x).toBe(overlayScaledState.expected.x)
    expect(overlayScaledState.bounds.y).toBe(overlayScaledState.expected.y)
    await expect(overlayPage.locator('#config-output')).toContainText('150')

    await application.evaluate(({ webContents }, targetUrl) => {
      const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(targetUrl) && !contents.getURL().endsWith('/overlay.html'))
      if (!remote) throw new Error('remote WebContentsView was not found')
      return remote.executeJavaScript(`window.desktopVoiceOverlay.pushState({
        channel: { name: '大厅' },
        participants: [
          { identity: 'u1', name: '张三', avatarUrl: null, isLocal: true, speaking: false, microphoneMuted: false, deafened: false },
          { identity: 'u2', name: 'alice', avatarUrl: null, isLocal: false, speaking: false, microphoneMuted: true, deafened: false },
        ],
      })`)
    }, serverUrl)
    await expect(overlayPage.locator('.participant.speaking')).toHaveCount(0)
    await expect(overlayPage.locator('.participant')).toHaveCount(2)
    await expect(overlayPage.locator('.participant:has-text("alice") .participant-avatar')).toHaveText('A')
    await expect.poll(async () => (
      application.evaluate(({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find((window) => (
          window.webContents.getURL().endsWith('/overlay.html')
        ))
        return overlay ? overlay.getBounds().height : null
      })
    )).toBe(108)

    const protocolOneHello = await application.evaluate(({ webContents }, targetUrl) => {
      const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(targetUrl) && !contents.getURL().endsWith('/overlay.html'))
      if (!remote) throw new Error('remote WebContentsView was not found')
      return remote.executeJavaScript(`(async () => {
        const hello = await window.desktopVoiceOverlay.hello({ minProtocol: 1, maxProtocol: 1 })
        return hello
      })()`)
    }, serverUrl)
    expect(protocolOneHello).toEqual({ protocol: 1, capabilities: ['voice_overlay'] })
    await expect(overlayPage.locator('.participant')).toHaveCount(0)
    await expect(overlayPage.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    await application.evaluate(({ webContents }, targetUrl) => {
      const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(targetUrl) && !contents.getURL().endsWith('/overlay.html'))
      if (!remote) throw new Error('remote WebContentsView was not found')
      return remote.executeJavaScript('window.desktopVoiceOverlay.setEnabled(true)')
    }, serverUrl)
    await expect.poll(() => (
      application.evaluate(({ BrowserWindow }) => (
        BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().endsWith('/overlay.html'))
      ))
    )).toBe(false)
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

async function localWindow(application: ElectronApplication, documentName: string): Promise<Page> {
  let matchedPage: Page | undefined
  await expect.poll(() => {
    matchedPage = application.windows().find((page) => isLocalDocument(page, documentName))
    return matchedPage !== undefined
  }, { message: `等待本地窗口 ${documentName}` }).toBe(true)
  return matchedPage as Page
}

function isLocalDocument(page: Page, documentName: string): boolean {
  try {
    const url = new URL(page.url())
    return url.protocol === 'file:' && path.basename(fileURLToPath(url)) === documentName
  } catch {
    return false
  }
}

async function overlayWindow(application: ElectronApplication, serverUrl: string): Promise<Page> {
  let matchedPage: Page | undefined
  await expect.poll(() => {
    matchedPage = application.windows().find((page) => {
      try {
        return page.url().startsWith(serverUrl) && new URL(page.url()).pathname.endsWith('/overlay.html')
      } catch {
        return false
      }
    })
    return matchedPage !== undefined
  }, { message: '等待浮层窗口' }).toBe(true)
  return matchedPage as Page
}

async function remoteText(application: ElectronApplication, url: string, selector: string): Promise<string | null> {
  return application.evaluate(async ({ webContents }, input) => {
    const remote = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(input.url))
    if (!remote) return null
    return remote.executeJavaScript(`document.querySelector(${JSON.stringify(input.selector)})?.textContent ?? null`)
  }, { url, selector })
}

async function startMediaServer(): Promise<Server> {
  const overlayPage = `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <style>
          .participant { min-height: 36px; padding: 4px 8px; border-radius: 6px; background: rgba(17, 18, 20, 0.82); }
          .participant.speaking { opacity: 0.8; }
          .participant:not(.speaking) { opacity: 0.4; }
          .participant-avatar { display: inline-block; width: 26px; height: 26px; background: #fff; }
          .participant-avatar img { width: 100%; height: 100%; }
        </style>
      </head>
      <body>
        <ul id="participants"></ul>
        <output id="config-output"></output>
        <script>
          const list = document.querySelector('#participants')
          const configOutput = document.querySelector('#config-output')
          function renderState(state) {
            const items = state.participants ?? []
            list.replaceChildren(...items.map((participant) => {
              const row = document.createElement('li')
              row.className = 'participant' + (participant.speaking ? ' speaking' : '')
              const avatar = document.createElement('span')
              avatar.className = 'participant-avatar'
              avatar.textContent = participant.avatarUrl
                ? 'img'
                : (Array.from(participant.name.trim())[0]?.toUpperCase() || '?')
              const name = document.createElement('span')
              name.className = 'participant-name'
              name.textContent = participant.name + (participant.isLocal ? '（你）' : '')
              row.append(avatar, name)
              if (participant.deafened) {
                const icon = document.createElement('span')
                icon.className = 'participant-icon deafened'
                icon.textContent = 'D'
                row.append(icon)
              } else if (participant.microphoneMuted) {
                const icon = document.createElement('span')
                icon.className = 'participant-icon'
                icon.textContent = 'M'
                row.append(icon)
              }
              return row
            }))
          }
          function renderConfig(config) {
            configOutput.textContent = JSON.stringify(config)
          }
          window.overlayHost.getState().then((result) => {
            renderState(result.state)
            renderConfig(result.config)
          })
          window.overlayHost.onState(renderState)
          window.overlayHost.onConfig(renderConfig)
        </script>
      </body>
    </html>`
  const server = createServer((request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Permissions-Policy': 'microphone=(self)',
    })
    if (request.url === '/frame') {
      response.end('<!doctype html><html><body><p>child frame</p></body></html>')
      return
    }
    if (request.url === '/overlay.html') {
      response.end(overlayPage)
      return
    }
    response.end(`<!doctype html>
      <html lang="en">
        <body>
          <h1>HTTP voice test</h1>
          <button id="open">Open microphone</button>
          <output data-testid="result"></output>
          <iframe src="/frame" title="child frame"></iframe>
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
